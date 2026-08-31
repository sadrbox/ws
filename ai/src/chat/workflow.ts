// Диалоговый workflow (§14–§17 ТЗ).
//
// Состояния (§16) хранятся в conversations.state, контекст (виденные id, ожидающий
// подтверждения вызов) — в conversations.context. Процесс между ходами ничего не помнит:
// подтверждение может прийти через час и из другого инстанса сервиса.
//
//   IDLE / COMPLETED / FAILED ──(сообщение)──► UNDERSTANDING ──► цикл с моделью:
//       tool_use READ            → EXECUTING: команда агенту, результат обратно модели
//       tool_use WRITE/CRITICAL  → WAITING_CONFIRMATION: карточка пользователю, стоп
//       текст без tool_use       → ответ пользователю; если вопрос — WAITING_CLARIFICATION
//   WAITING_CONFIRMATION ──(«да»)──► EXECUTING отложенного вызова ──► снова цикл с моделью
//                        ──(«нет»)─► отмена, модель получает tool_result «пользователь отказал»
//
// Модель не участвует в подтверждении: решение принимает только человек, а сервис сверяет,
// что исполняется ровно тот вызов, который был показан.

import { randomUUID } from "node:crypto";
import type { Db } from "../db/pool.ts";
import type { Logger } from "../logger.ts";
import type { LLMProvider, ChatMessage, ToolCall, ToolResult } from "../llm/provider.ts";
import { LLMError } from "../llm/provider.ts";
import { TOOLS_BY_NAME, toolDefinitions, collectIds, ToolInputError, type ToolSpec } from "../tools/registry.ts";
import { SYSTEM_PROMPT } from "./prompt.ts";
import type { AgentService } from "../agents/service.ts";
import type { CommandQueue, CommandRow } from "../commands/queue.ts";
import type { Audit } from "../audit/index.ts";
import { BankExtractor, ExtractError } from "../bank/extract.ts";
import type { StatementStore } from "../bank/store.ts";
import { summarize, fmt, type Statement } from "../bank/schema.ts";
import type { FileStore, FileRef } from "../files/store.ts";

export type Attachment = { fileName: string; mimeType: string; content: Buffer };

/** Сводка выписки в контексте диалога — для карточки подтверждения (без похода в базу). */
type StatementCard = { fileName: string; summary: string; reconciled: boolean; lines: number; ownerBin: string | null };

export type WorkflowState = "IDLE" | "UNDERSTANDING" | "RESOLVING_ENTITIES" | "WAITING_CLARIFICATION" | "WAITING_CONFIRMATION" | "EXECUTING" | "COMPLETED" | "FAILED";

type PendingCall = { toolCallId: string; tool: string; payload: Record<string, unknown>; requestId: string; card: string; priorResults: ToolResult[] };

type Context = {
	seenIds: string[];
	pending?: PendingCall | null;
	lastResult?: unknown;
	statements?: Record<string, StatementCard>;
};

export type ChatReply = {
	conversationId: string;
	state: WorkflowState;
	/** Текст для пользователя. */
	text: string;
	/** Требуется ли подтверждение и что именно подтверждается. */
	confirmation?: { tool: string; card: string } | null;
	/** Файлы для пользователя (печатные формы, отчёты) — ссылки на хранилище сервиса. */
	attachments?: FileRef[];
	usage?: { inputTokens: number; outputTokens: number; cacheRead?: number };
};

export type WorkflowDeps = {
	db: Db;
	log: Logger;
	llm: LLMProvider;
	agents: AgentService;
	queue: CommandQueue;
	audit: Audit;
	confirmWrite: boolean;
	commandTimeoutMs: number;
	maxToolRounds: number;
	/** Распознавание и хранение выписок; null — вложения в чате не поддерживаются. */
	bank?: { extractor: BankExtractor; store: StatementStore } | null;
	/** Хранилище файлов диалога (печатные формы, отчёты). */
	files: FileStore;
};

// Границу слова  здесь использовать нельзя: в JS она знает только латиницу, и «да» не
// совпадало бы. Слово должно стоять в начале и заканчиваться концом строки или знаком.
const YES = /^(?:да|ок|окей|давай|подтверждаю|подтвердить|создавай|создай|верно|согласен|yes|ok|\+)(?=$|[\s.,!)])/i;
const NO = /^(?:нет|отмена|отмени|отменить|не надо|стоп|no|cancel|-)(?=$|[\s.,!)])/i;

export class ChatWorkflow {
	private readonly d: WorkflowDeps;
	constructor(deps: WorkflowDeps) {
		this.d = deps;
	}

	/**
	 * Готовит диалог к долгому ходу (вложения): создаёт/находит его, переводит в UNDERSTANDING и
	 * возвращает id — клиент тут же получает ответ и дальше опрашивает состояние, а сам ход идёт
	 * в handle() фоном. Иначе три PDF по минуте держали бы HTTP-соединение дольше, чем живут
	 * прокси по дороге.
	 */
	async prepare(user: { uuid: string; organizationUuid: string }, conversationId: string | null): Promise<string> {
		const conv = conversationId ? await this.load(conversationId, user) : await this.create(user);
		if (!conv) throw new WorkflowError("NOT_FOUND", "Диалог не найден");
		// Ожидающее подтверждение не трогаем: решение «да/нет» принимается по context.pending,
		// а клиенту состояние WAITING_CONFIRMATION нужно, чтобы показывать карточку.
		if (conv.state !== "WAITING_CONFIRMATION") await this.setState(conv.id, "UNDERSTANDING", conv.context);
		return conv.id;
	}

	/** Фоновый ход: ошибки не теряются — попадают в состояние диалога и его историю. */
	async handleInBackground(user: { uuid: string; organizationUuid: string }, conversationId: string, text: string, attachments: Attachment[]): Promise<void> {
		try {
			await this.handle(user, conversationId, text, attachments);
		} catch (e) {
			this.d.log.error({ err: e, conversationId }, "фоновый ход диалога завершился ошибкой");
			await this.appendMessage(conversationId, { role: "assistant", text: "Не удалось обработать вложения. Попробуйте ещё раз или отправьте файлы по одному.", toolCalls: [] });
			await this.d.db.query(`UPDATE conversations SET state = 'FAILED', updated_at = now() WHERE id = $1`, [conversationId]);
		}
	}

	/** Главная точка: сообщение пользователя → ответ. */
	async handle(user: { uuid: string; organizationUuid: string }, conversationId: string | null, text: string, attachments: Attachment[] = []): Promise<ChatReply> {
		const conv = conversationId ? await this.load(conversationId, user) : await this.create(user);
		if (!conv) throw new WorkflowError("NOT_FOUND", "Диалог не найден");

		await this.d.audit.write({ event: "chat.user_message", conversationId: conv.id, userUuid: user.uuid, organizationUuid: user.organizationUuid,
			details: { text: text.slice(0, 500), state: conv.state, attachments: attachments.map((a) => ({ fileName: a.fileName, size: a.content.length })) } });

		// Вложения распознаются ДО хода модели и попадают в её сообщение сводкой со statementId:
		// модель видит факты, а не байты PDF, и не может «подправить» строки — payload для 1С
		// сервис соберёт из сохранённой выписки. Оригиналы файлов сохраняются в chat_files и
		// их ссылки прокидываются в ответ (carryFiles), чтобы были доступны для скачивания.
		let carryFiles: FileRef[] = [];
		if (attachments.length) {
			const att = await this.attachStatements(conv, user, text, attachments);
			text = att.text;
			carryFiles = att.files;
		}

		// Ответ на подтверждение — без модели. Признак — ожидающий вызов в контексте, а не
		// состояние: состояние мог сменить prepare() или фоновый ход.
		if (conv.context.pending) {
			if (YES.test(text.trim())) return this.executePending(conv, user);
			if (NO.test(text.trim())) return this.cancelPending(conv, user);
			// Не «да» и не «нет» — считаем новым указанием: отменяем ожидание и идём к модели.
			const p = conv.context.pending;
			await this.appendMessage(conv.id, { role: "user", toolResults: [...p.priorResults, { toolCallId: p.toolCallId, content: { cancelled: true, reason: "пользователь дал новое указание вместо подтверждения" }, isError: true }] });
			conv.context.pending = null;
		}

		await this.appendMessage(conv.id, { role: "user", text });
		await this.setState(conv.id, "UNDERSTANDING", conv.context);
		return this.runModel(conv, user, carryFiles);
	}

	// ── цикл с моделью ────────────────────────────────────────────────────

	private async runModel(conv: Conversation, user: { uuid: string; organizationUuid: string }, carry: FileRef[] = []): Promise<ChatReply> {
		const attachments: FileRef[] = [...carry];
		let usage: ChatReply["usage"];

		for (let round = 0; round < this.d.maxToolRounds; round++) {
			const history = await this.history(conv.id);
			let res;
			try {
				// 16k: вызов инструмента со списком документов или длинный отчёт по выписке не должны
				// обрезаться по лимиту — обрезанный JSON инструмента превращается в пустой вызов.
				res = await this.d.llm.chat({ system: SYSTEM_PROMPT, messages: history, tools: toolDefinitions(), cacheable: true, maxTokens: 16_000 });
			} catch (e) {
				const err = e instanceof LLMError ? e : new LLMError("LLM_ERROR", String(e));
				this.d.log.error({ err, conversationId: conv.id }, "ошибка модели");
				await this.d.audit.write({ event: "chat.llm_error", conversationId: conv.id, userUuid: user.uuid, details: { code: err.code, message: err.message } });
				await this.setState(conv.id, "FAILED", conv.context);
				return { conversationId: conv.id, state: "FAILED", text: "Не удалось обратиться к модели. Попробуйте повторить через минуту." };
			}
			usage = res.usage ? { inputTokens: res.usage.inputTokens, outputTokens: res.usage.outputTokens, cacheRead: res.usage.cacheRead } : undefined;
			// Файлы этого хода закрепляются за итоговым сообщением ассистента — так они видны в истории.
			await this.appendMessage(conv.id, { role: "assistant", text: res.text, toolCalls: res.toolCalls, raw: res.raw, ...(res.toolCalls.length || !attachments.length ? {} : { files: attachments }) });
			await this.d.audit.write({ event: "chat.llm_turn", conversationId: conv.id, userUuid: user.uuid,
				details: { stopReason: res.stopReason, tools: res.toolCalls.map((c) => c.name), usage: res.usage ?? null, model: res.model } });

			if (res.stopReason === "refusal") {
				await this.setState(conv.id, "FAILED", conv.context);
				return { conversationId: conv.id, state: "FAILED", text: "Модель отказалась обрабатывать этот запрос. Переформулируйте, пожалуйста." };
			}

			if (!res.toolCalls.length) {
				// Текст: вопрос пользователю или итог.
				const asks = /\?\s*$/.test(res.text) || /выбер|уточн|какой|какую|сколько|назовите/i.test(res.text);
				const state: WorkflowState = asks ? "WAITING_CLARIFICATION" : "COMPLETED";
				await this.setState(conv.id, state, conv.context);
				return { conversationId: conv.id, state, text: res.text || "Готово.", attachments, usage };
			}

			// Инструменты: сначала проверяем все, потом исполняем READ; WRITE/CRITICAL — на подтверждение.
			const results: ToolResult[] = [];
			for (const call of res.toolCalls) {
				const spec = TOOLS_BY_NAME.get(call.name);
				if (!spec) {
					results.push({ toolCallId: call.id, content: { error: "UNKNOWN_TOOL", message: `Инструмента ${call.name} нет` }, isError: true });
					continue;
				}
				let payload: Record<string, unknown>;
				try {
					payload = spec.buildPayload(call.input, { seenIds: new Set(conv.context.seenIds) });
				} catch (e) {
					const msg = e instanceof ToolInputError ? e.message : String(e);
					await this.d.audit.write({ event: "chat.tool_rejected", conversationId: conv.id, userUuid: user.uuid, details: { tool: call.name, reason: msg } });
					results.push({ toolCallId: call.id, content: { error: "VALIDATION_ERROR", message: msg }, isError: true });
					continue;
				}

				const needsConfirmation = spec.operation === "CRITICAL" || (spec.operation === "WRITE" && this.d.confirmWrite);
				if (needsConfirmation) {
					// Остальные tool_use этого хода закрываем сразу: API модели требует tool_result на каждый.
					const others = res.toolCalls.filter((c) => c.id !== call.id && !results.some((r) => r.toolCallId === c.id));
					for (const o of others) results.push({ toolCallId: o.id, content: { error: "DEFERRED", message: "не выполнено: сначала нужно подтверждение предыдущей операции" }, isError: true });
					const pending: PendingCall = { toolCallId: call.id, tool: spec.name, payload, requestId: randomUUID(), card: this.card(spec, payload, conv.context), priorResults: results };
					conv.context.pending = pending;
					await this.setState(conv.id, "WAITING_CONFIRMATION", conv.context);
					await this.d.audit.write({ event: "chat.confirmation_requested", conversationId: conv.id, userUuid: user.uuid, requestId: pending.requestId, details: { tool: spec.name } });
					const question = this.question(spec.name, spec.operation);
					return { conversationId: conv.id, state: "WAITING_CONFIRMATION", text: `${res.text ? res.text + "\n\n" : ""}${pending.card}\n\n${question}`,
						confirmation: { tool: spec.name, card: pending.card }, attachments, usage };
				}

				const out = await this.execute(conv, user, spec, payload, call, spec.mutating ? randomUUID() : null);
				results.push(out.result);
				if (out.attachment) attachments.push(out.attachment);
			}
			await this.appendMessage(conv.id, { role: "user", toolResults: results });
		}

		await this.setState(conv.id, "FAILED", conv.context);
		return { conversationId: conv.id, state: "FAILED", text: "Слишком много шагов без результата. Уточните запрос.", attachments, usage };
	}

	// ── подтверждение ─────────────────────────────────────────────────────

	private async executePending(conv: Conversation, user: { uuid: string; organizationUuid: string }): Promise<ChatReply> {
		const p = conv.context.pending!;
		const spec = TOOLS_BY_NAME.get(p.tool)!;
		await this.d.audit.write({ event: "chat.confirmed", conversationId: conv.id, userUuid: user.uuid, requestId: p.requestId, details: { tool: p.tool } });
		conv.context.pending = null;
		const out = await this.execute(conv, user, spec, p.payload, { id: p.toolCallId, name: p.tool, input: p.payload }, p.requestId);
		await this.appendMessage(conv.id, { role: "user", toolResults: [...p.priorResults, out.result] });
		return this.runModel(conv, user, out.attachment ? [out.attachment] : []);
	}

	private async cancelPending(conv: Conversation, user: { uuid: string; organizationUuid: string }): Promise<ChatReply> {
		const p = conv.context.pending!;
		await this.d.audit.write({ event: "chat.cancelled", conversationId: conv.id, userUuid: user.uuid, requestId: p.requestId, details: { tool: p.tool } });
		conv.context.pending = null;
		await this.appendMessage(conv.id, { role: "user", toolResults: [...p.priorResults, { toolCallId: p.toolCallId, content: { cancelled: true, reason: "пользователь отказался" }, isError: true }] });
		await this.setState(conv.id, "COMPLETED", conv.context);
		const what = p.tool === "create_sale" ? "Документ не создан." : p.tool === "import_bank_statement" ? "Выписка не загружена." : "Операция не выполнена.";
		return { conversationId: conv.id, state: "COMPLETED", text: `Отменено. ${what}` };
	}

	// ── исполнение через агента ───────────────────────────────────────────

	private async execute(conv: Conversation, user: { uuid: string; organizationUuid: string }, spec: ToolSpec, payload: Record<string, unknown>, call: ToolCall, requestId: string | null): Promise<{ result: ToolResult; attachment?: FileRef }> {
		const agent = await this.d.agents.pickOnline(user.organizationUuid);
		if (!agent) {
			// «Не настроен» и «не на связи» — разные ситуации с разными действиями пользователя:
			// в первом случае бесполезно ждать, нужно переключить организацию или завести агента.
			const configured = (await this.d.agents.listByOrganization(user.organizationUuid)).filter((a) => !a.disabled);
			await this.d.audit.write({ event: "chat.agent_unavailable", conversationId: conv.id, userUuid: user.uuid, organizationUuid: user.organizationUuid, details: { configured: configured.length } });
			const message = configured.length
				? "Агент 1С этой организации сейчас не на связи (служба на компьютере с 1С не запущена или нет сети)"
				: "Для активной организации ERP агент 1С не настроен. Переключите организацию на ту, к которой подключена база 1С, или заведите агента для этой организации";
			return { result: { toolCallId: call.id, content: { error: configured.length ? "AGENT_OFFLINE" : "AGENT_NOT_CONFIGURED", message }, isError: true } };
		}
		if (!agent.onec.reachable) {
			return { result: { toolCallId: call.id, content: { error: "ONEC_UNAVAILABLE", message: "База 1С недоступна для агента" }, isError: true } };
		}

		await this.setState(conv.id, "EXECUTING", conv.context);

		// Выписка: модель передала только statementId, строки для 1С — из хранилища.
		// Сверка получает ту же выписку целиком (с периодом и остатками), но ничего не пишет.
		let statementId: string | null = null;
		if (spec.commandType === "IMPORT_BANK_STATEMENT" || spec.commandType === "RECONCILE_STATEMENT") {
			const sid = String(payload.statementId ?? "");
			const stored = this.d.bank ? await this.d.bank.store.get(sid, user.organizationUuid) : null;
			if (!stored) {
				return { result: { toolCallId: call.id, content: { error: "STATEMENT_NOT_FOUND", message: "Выписка с таким statementId не найдена в этой организации" }, isError: true } };
			}
			payload = { statementId: sid, ...statementPayload(stored.statement) };
			if (spec.commandType === "IMPORT_BANK_STATEMENT") statementId = sid;
		}

		// Проведение по выпискам: список документов — из сохранённого результата загрузки.
		if (spec.commandType === "POST_BANK_DOCUMENTS" && Array.isArray(payload.statementIds) && payload.statementIds.length) {
			const documents: { id: string; type: string }[] = [];
			for (const sid of payload.statementIds as string[]) {
				const stored = this.d.bank ? await this.d.bank.store.get(sid, user.organizationUuid) : null;
				if (!stored || !stored.importResult) {
					return { result: { toolCallId: call.id, content: { error: "STATEMENT_NOT_IMPORTED", message: `Выписка ${sid} ещё не загружена в 1С — проводить нечего` }, isError: true } };
				}
				documents.push(...documentsOfImport(stored.importResult));
			}
			if (!documents.length) {
				return { result: { toolCallId: call.id, content: { error: "NO_DOCUMENTS", message: "По этим выпискам в 1С не создано ни одного документа" }, isError: true } };
			}
			payload = { documents };
		}

		const cmd = await this.d.queue.enqueue({
			agentId: agent.id, organizationUuid: user.organizationUuid, type: spec.commandType, payload, requestId,
			userUuid: user.uuid, conversationId: conv.id, ttlSeconds: 600,
		});
		await this.d.audit.write({ event: "command.enqueue", conversationId: conv.id, userUuid: user.uuid, agentId: agent.id, commandId: cmd.id, requestId, details: { type: spec.commandType, tool: spec.name, source: "chat" } });

		const done: CommandRow | null = await this.d.queue.waitResult(cmd.id, this.d.commandTimeoutMs);
		if (!done || done.state === "queued" || done.state === "dispatched") {
			return { result: { toolCallId: call.id, content: { error: "TIMEOUT", message: "1С не ответила вовремя; команда осталась в очереди" }, isError: true } };
		}
		if (done.state === "expired") {
			return { result: { toolCallId: call.id, content: { error: "EXPIRED", message: "Команда не была исполнена агентом вовремя" }, isError: true } };
		}
		if (done.state === "failed") {
			// Кандидаты из CONTRACT_AMBIGUOUS и подобных ответов — тоже реальные объекты 1С:
			// модель должна иметь право сослаться на них после выбора пользователя.
			const seenErr = new Set(conv.context.seenIds);
			collectIds(done.error?.details, seenErr);
			conv.context.seenIds = [...seenErr];
			await this.setState(conv.id, "EXECUTING", conv.context);
			if (statementId && this.d.bank) await this.d.bank.store.markImported(statementId, "failed", done.error ?? null);
			return { result: { toolCallId: call.id, content: { error: done.error?.code ?? "ERROR", message: done.error?.message ?? "", details: done.error?.details ?? null }, isError: true } };
		}

		// Успех: запоминаем id для последующих вызовов; PDF не отдаём модели — только пользователю.
		const seen = new Set(conv.context.seenIds);
		collectIds(done.result, seen);
		conv.context.seenIds = [...seen];
		const isFile = spec.commandType === "PRINT_SALE" || spec.commandType === "PRINT_DOCUMENT" || spec.commandType === "RUN_REPORT";
		conv.context.lastResult = isFile ? { form: (done.result as { form?: string })?.form } : done.result;
		await this.setState(conv.id, "EXECUTING", conv.context);

		if (statementId && this.d.bank) {
			await this.d.bank.store.markImported(statementId, "imported", done.result ?? null);
			// Модели — компактный результат: сотня строк с вложенными описаниями документов
			// и контрагентов — это тысячи токенов ни о чём.
			return { result: { toolCallId: call.id, content: compactImportResult(done.result) } };
		}

		if (spec.commandType === "POST_BANK_DOCUMENTS") {
			return { result: { toolCallId: call.id, content: compactPostResult(done.result) } };
		}

		if (spec.commandType === "RECONCILE_STATEMENT") {
			return { result: { toolCallId: call.id, content: compactReconcileResult(done.result) } };
		}

		if (isFile && done.result && typeof done.result === "object") {
			// Файл — в хранилище сервиса; модели только имя и размер, пользователю — ссылка.
			const r = done.result as { fileName?: string; mimeType?: string; content?: string; size?: number; presentation?: string; format?: string; type?: string; document?: { id?: string } };
			if (!r.content) return { result: { toolCallId: call.id, content: { error: "EMPTY_FILE", message: "1С вернула пустой файл" }, isError: true } };
			const ref = await this.d.files.save({
				conversationId: conv.id, organizationUuid: user.organizationUuid, userUuid: user.uuid,
				fileName: r.fileName ?? "document.pdf", mimeType: r.mimeType ?? "application/pdf", content: Buffer.from(r.content, "base64"),
				source: { tool: spec.name, form: r.presentation, format: r.format, documentType: r.type ?? payload.documentType, documentId: r.document?.id ?? payload.documentId, report: payload.report, from: payload.from, to: payload.to, account: payload.account },
			});
			await this.d.audit.write({ event: "chat.file_created", conversationId: conv.id, userUuid: user.uuid, organizationUuid: user.organizationUuid, details: { fileId: ref.fileId, fileName: ref.fileName, size: ref.size } });
			return {
				result: { toolCallId: call.id, content: { ok: true, form: r.presentation, fileName: ref.fileName, size: ref.size, format: r.format ?? "pdf", rows: (r as { rows?: number }).rows, note: "файл передан пользователю вложением к ответу" } },
				attachment: ref,
			};
		}
		return { result: { toolCallId: call.id, content: done.result ?? { ok: true } } };
	}

	/** Карточка подтверждения (§17) — из payload и уже виденных описаний объектов. */
	private card(spec: ToolSpec, payload: Record<string, unknown>, ctx: Context): string {
		const names = this.namesFromHistory(ctx);
		const nameOf = (id: unknown) => (typeof id === "string" && names.get(id)) || String(id ?? "");
		if (spec.name === "create_sale") {
			const items = (payload.items as { productId: string; quantity: number; price: number }[]) ?? [];
			const lines = items.map((it) => `• ${nameOf(it.productId)} — ${it.quantity} × ${it.price} ₸`);
			return [
				"Реализация товаров и услуг",
				`Контрагент: ${nameOf(payload.customerId)}`,
				payload.warehouseId ? `Склад: ${nameOf(payload.warehouseId)}` : null,
				payload.contractId ? `Договор: ${nameOf(payload.contractId)}` : null,
				...lines,
				"Итоговую сумму и НДС рассчитает 1С.",
			].filter(Boolean).join("\n");
		}
		if (spec.name === "import_bank_statement") {
			const s = ctx.statements?.[String(payload.statementId)];
			if (!s) return `Загрузка выписки ${String(payload.statementId)}`;
			return [
				`Загрузка банковской выписки «${s.fileName}»`,
				s.summary,
				"Будут созданы НЕ проведённые платёжные поручения; отсутствующие контрагенты будут созданы по БИН.",
				s.reconciled ? null : "⚠ Сверка не сошлась — проверьте суммы после загрузки.",
			].filter(Boolean).join("\n");
		}
		if (spec.name === "post_bank_documents" && Array.isArray(payload.statementIds) && (payload.statementIds as string[]).length) {
			const names = (payload.statementIds as string[]).map((id) => ctx.statements?.[id]?.fileName ?? id);
			return `Провести все документы, созданные по выпискам:\n${names.map((n) => `• ${n}`).join("\n")}`;
		}
		if (spec.name === "post_bank_documents") {
			const docs = (payload.documents as { id: string; type: string }[]) ?? [];
			const list = docs.slice(0, 15).map((d) => `• ${d.type === "incoming" ? "ПП входящее" : "ПП исходящее"} ${nameOf(d.id)}`);
			return [`Провести документы (${docs.length}):`, ...list, docs.length > 15 ? `… и ещё ${docs.length - 15}` : null].filter(Boolean).join("\n");
		}
		const verb = spec.name === "post_sale" ? "Провести" : spec.name === "unpost_sale" ? "Отменить проведение" : spec.name;
		return `${verb}: документ ${nameOf(payload.documentId)}`;
	}

	private question(tool: string, operation: string): string {
		if (operation === "CRITICAL") return "Подтвердите операцию.";
		if (tool === "import_bank_statement") return "Загрузить выписку в 1С?";
		return "Создать документ?";
	}

	/** Распознаёт PDF-вложения (параллельно) и дописывает к сообщению пользователя сводку каждой выписки. */
	private async attachStatements(conv: Conversation, user: { uuid: string; organizationUuid: string }, text: string, attachments: Attachment[]): Promise<{ text: string; files: FileRef[] }> {
		// Сохранить ОРИГИНАЛ вложения в хранилище диалога (chat_files): доступен при
		// переоткрытии диалога и скачивается по /v1/files/:id (TTL = FILE_TTL_DAYS).
		// Сбой хранения не должен ронять распознавание — файл не критичен для ответа.
		const store = async (a: Attachment, source: Record<string, unknown>): Promise<FileRef | null> => {
			try {
				return await this.d.files.save({ conversationId: conv.id, organizationUuid: user.organizationUuid, userUuid: user.uuid,
					fileName: a.fileName, mimeType: a.mimeType || "application/octet-stream", content: a.content, source: { kind: "attachment", ...source } });
			} catch (e) {
				this.d.log.warn({ err: e, conversationId: conv.id, fileName: a.fileName }, "не удалось сохранить вложение диалога");
				return null;
			}
		};

		const one = async (a: Attachment): Promise<{ text: string; file: FileRef | null }> => {
			const isPdf = a.mimeType === "application/pdf" || a.fileName.toLowerCase().endsWith(".pdf");
			if (!this.d.bank || !isPdf) {
				const file = await store(a, {});
				return { text: `[Вложение «${a.fileName}» сохранено${file ? "" : ""}: ${isPdf ? "обработка PDF в этом сервисе отключена" : "поддерживаются только PDF банковских выписок"}]`, file };
			}
			const started = Date.now();
			try {
				const r = await this.d.bank.extractor.extract(a.content, a.fileName);
				const stored = await this.d.bank.store.save({ conversationId: conv.id, organizationUuid: user.organizationUuid, userUuid: user.uuid, fileName: a.fileName, sha256: r.sha256, statement: r.statement, reconciliation: r.reconciliation });
				// Оригинал PDF связываем с распознанной выпиской (source.statementId).
				const file = await store(a, { statementId: stored.id, sha256: r.sha256 });
				const summary = summarize(r.statement, r.reconciliation);
				conv.context.seenIds = [...new Set([...conv.context.seenIds, stored.id])];
				conv.context.statements = { ...(conv.context.statements ?? {}), [stored.id]: { fileName: a.fileName, summary, reconciled: r.reconciliation.ok, lines: r.statement.lines.length, ownerBin: r.statement.owner.bin ?? null } };
				await this.d.audit.write({ event: "chat.statement_extracted", conversationId: conv.id, userUuid: user.uuid, organizationUuid: user.organizationUuid,
					details: { statementId: stored.id, fileName: a.fileName, fileId: file?.fileId ?? null, lines: r.statement.lines.length, reconciled: r.reconciliation.ok, model: r.model, usage: r.usage, ms: Date.now() - started } });
				return { text: `[Вложение «${a.fileName}» — банковская выписка распознана. statementId=${stored.id}
${summary}
Первые операции:
${previewLines(r.statement)}]`, file };
			} catch (e) {
				const msg = e instanceof ExtractError ? e.message : e instanceof Error ? e.message : String(e);
				this.d.log.warn({ err: e, conversationId: conv.id, fileName: a.fileName }, "выписка не распознана");
				// Даже при неудаче распознавания оригинал сохраняем — пользователь его прикрепил.
				const file = await store(a, { extractError: msg });
				await this.d.audit.write({ event: "chat.statement_failed", conversationId: conv.id, userUuid: user.uuid, details: { fileName: a.fileName, fileId: file?.fileId ?? null, error: msg } });
				return { text: `[Вложение «${a.fileName}» сохранено, но не удалось распознать выписку — ${msg}]`, file };
			}
		};
		// Параллельно: три выписки по минуте каждая — это минута, а не три.
		const parts = await Promise.all(attachments.map(one));
		const files = parts.map((p) => p.file).filter((f): f is FileRef => f !== null);
		return { text: [text, ...parts.map((p) => p.text)].filter(Boolean).join("\n\n"), files };
	}

	private namesFromHistory(ctx: Context): Map<string, string> {
		const m = new Map<string, string>();
		const walk = (v: unknown) => {
			if (!v || typeof v !== "object") return;
			if (Array.isArray(v)) { v.forEach(walk); return; }
			const o = v as Record<string, unknown>;
			if (typeof o.id === "string" && (typeof o.name === "string" || typeof o.number === "string")) m.set(o.id, String(o.name ?? o.number));
			Object.values(o).forEach(walk);
		};
		walk(ctx.lastResult);
		for (const cached of this.nameCache.values()) walk(cached);
		return m;
	}
	// Результаты READ-инструментов последних ходов, чтобы карточка показывала имена, а не id.
	private readonly nameCache = new Map<string, unknown>();

	// ── хранение ──────────────────────────────────────────────────────────

	private async create(user: { uuid: string; organizationUuid: string }): Promise<Conversation> {
		const id = randomUUID();
		const agent = await this.d.agents.pickOnline(user.organizationUuid);
		await this.d.db.query(
			`INSERT INTO conversations (id, organization_uuid, user_uuid, agent_id, state, context) VALUES ($1, $2, $3, $4, 'IDLE', '{"seenIds":[]}')`,
			[id, user.organizationUuid, user.uuid, agent?.id ?? null],
		);
		return { id, state: "IDLE", context: { seenIds: [] } };
	}

	private async load(id: string, user: { uuid: string; organizationUuid: string }): Promise<Conversation | null> {
		const r = await this.d.db.query<{ id: string; state: WorkflowState; context: Context }>(
			`SELECT id, state, context FROM conversations WHERE id = $1 AND user_uuid = $2 AND organization_uuid = $3`,
			[id, user.uuid, user.organizationUuid],
		);
		const row = r.rows[0];
		return row ? { id: row.id, state: row.state, context: { ...row.context, seenIds: row.context.seenIds ?? [] } } : null;
	}

	private async setState(id: string, state: WorkflowState, context: Context): Promise<void> {
		await this.d.db.query(`UPDATE conversations SET state = $2, context = $3::jsonb, updated_at = now() WHERE id = $1`, [id, state, JSON.stringify(context)]);
	}

	private async appendMessage(conversationId: string, m: ChatMessage): Promise<void> {
		if (m.role === "user" && "toolResults" in m) {
			// И ошибки тоже: кандидаты договоров приходят в details ошибки CONTRACT_AMBIGUOUS.
			for (const r of m.toolResults) this.nameCache.set(r.toolCallId, r.content);
		}
		await this.d.db.query(`INSERT INTO messages (conversation_id, role, content) VALUES ($1, $2, $3::jsonb)`,
			[conversationId, m.role, JSON.stringify(m)]);
	}

	private async history(conversationId: string): Promise<ChatMessage[]> {
		const r = await this.d.db.query<{ content: ChatMessage }>(`SELECT content FROM messages WHERE conversation_id = $1 ORDER BY id`, [conversationId]);
		const raw = r.rows.map((x) => x.content);
		// Самовосстановление: API модели требует tool_result на каждый tool_use в следующем же
		// сообщении. Если ход прервался (сбой, перезапуск) и результата нет — подставляем отказ,
		// иначе диалог навсегда остаётся неотправляемым.
		const msgs: ChatMessage[] = [];
		for (let i = 0; i < raw.length; i++) {
			const m = raw[i];
			msgs.push(m);
			if (m.role === "assistant" && m.toolCalls.length) {
				const next = raw[i + 1];
				const answered = new Set(next && next.role === "user" && "toolResults" in next ? next.toolResults.map((t) => t.toolCallId) : []);
				const missing = m.toolCalls.filter((c) => !answered.has(c.id));
				if (missing.length) {
					const filler: ChatMessage = { role: "user", toolResults: missing.map((c) => ({ toolCallId: c.id, content: { error: "INTERRUPTED", message: "ход был прерван, результат не получен" }, isError: true })) };
					if (next && next.role === "user" && "toolResults" in next) next.toolResults.push(...filler.toolResults);
					else msgs.push(filler);
				}
			}
		}
		for (const m of msgs) if (m.role === "user" && "toolResults" in m) for (const t of m.toolResults) this.nameCache.set(t.toolCallId, t.content);
		return msgs;
	}

	/** История диалога для интерфейса: только текстовые ходы + карточка, если ждём подтверждения. */
	async summary(conversationId: string, user: { uuid: string; organizationUuid: string }) {
		const conv = await this.load(conversationId, user);
		if (!conv) return null;
		const r = await this.d.db.query<{ role: string; content: ChatMessage; created_at: Date }>(`SELECT role, content, created_at FROM messages WHERE conversation_id = $1 ORDER BY id`, [conversationId]);
		const messages = r.rows
			.filter((m) => (m.role === "user" && "text" in m.content) || (m.role === "assistant" && m.content.role === "assistant" && (m.content.text || m.content.files?.length)))
			.map((m) => ({
				role: m.role, text: "text" in m.content ? m.content.text : "", at: m.created_at.toISOString(),
				...(m.content.role === "assistant" && m.content.files?.length ? { attachments: m.content.files } : {}),
			}));
		const pending = conv.state === "WAITING_CONFIRMATION" ? conv.context.pending : null;
		if (pending) messages.push({ role: "assistant", text: `${pending.card}\n\n${this.question(pending.tool, TOOLS_BY_NAME.get(pending.tool)?.operation ?? "WRITE")}`, at: new Date().toISOString() });
		return {
			id: conv.id, state: conv.state, messages,
			confirmation: pending ? { tool: pending.tool, card: pending.card } : null,
		};
	}

	/** Последние диалоги пользователя в организации — для списка в интерфейсе. */
	async list(user: { uuid: string; organizationUuid: string }, limit = 20) {
		const r = await this.d.db.query<{ id: string; state: WorkflowState; updated_at: Date; created_at: Date; preview: string | null }>(
			`SELECT c.id, c.state, c.updated_at, c.created_at,
			        (SELECT m.content->>'text' FROM messages m WHERE m.conversation_id = c.id AND m.role = 'user' AND m.content ? 'text' ORDER BY m.id LIMIT 1) AS preview
			   FROM conversations c
			  WHERE c.user_uuid = $1 AND c.organization_uuid = $2
			  ORDER BY c.updated_at DESC LIMIT $3`,
			[user.uuid, user.organizationUuid, limit]);
		return r.rows
			.filter((c) => c.preview)
			.map((c) => ({ id: c.id, state: c.state, preview: (c.preview ?? "").slice(0, 80), updatedAt: c.updated_at.toISOString(), createdAt: c.created_at.toISOString() }));
	}
}

type Conversation = { id: string; state: WorkflowState; context: Context };

/** Payload IMPORT_BANK_STATEMENT для 1С (контракт buhprof_api POST /v1/bank/statements). */
function statementPayload(s: Statement): Record<string, unknown> {
	return {
		...(s.owner.bin ? { organizationBin: s.owner.bin } : {}),
		account: { iik: s.account.iik, bik: s.account.bik ?? "", bankName: s.account.bankName ?? s.bank },
		period: s.period,
		openingBalance: s.openingBalance ?? null,
		closingBalance: s.closingBalance ?? null,
		totalIn: s.totalIn ?? null,
		totalOut: s.totalOut ?? null,
		lines: s.lines.map((l) => ({
			number: l.number ?? "", date: l.date, direction: l.direction, amount: l.amount, knp: l.knp ?? "", purpose: l.purpose ?? "",
			counterparty: { name: l.counterparty.name, bin: l.counterparty.bin ?? "", iik: l.counterparty.iik ?? "", bik: l.counterparty.bik ?? "", bankName: l.counterparty.bankName ?? "" },
		})),
	};
}

function previewLines(s: Statement): string {
	return s.lines.slice(0, 5).map((l) => `${l.date} ${l.direction === "in" ? "+" : "−"}${fmt(l.amount)} ${l.counterparty.name}${l.counterparty.bin ? ` (БИН ${l.counterparty.bin})` : ""}${l.knp ? `, КНП ${l.knp}` : ""}`).join("\n") + (s.lines.length > 5 ? `\n… всего ${s.lines.length}` : "");
}

/** Документы, созданные (или уже существовавшие) по результату загрузки выписки в 1С. */
function documentsOfImport(result: unknown): { id: string; type: string }[] {
	if (!result || typeof result !== "object") return [];
	const lines = Array.isArray((result as { lines?: unknown }).lines) ? ((result as { lines: Record<string, unknown>[] }).lines) : [];
	const out: { id: string; type: string }[] = [];
	for (const l of lines) {
		const d = l.document as { id?: string; type?: string } | null | undefined;
		if (d?.id && (d.type === "incoming" || d.type === "outgoing")) out.push({ id: d.id, type: d.type });
	}
	return out;
}

/**
 * Результат проведения для модели: отказы сгруппированы по причине, чтобы ответ пользователю
 * объяснял, что делать, а не цитировал 1С. Ведомостные документы (зарплата, ОПВ/СО) без
 * подобранных документов 1С не проводит — это норма, а не ошибка загрузки.
 */
function compactPostResult(result: unknown): unknown {
	if (!result || typeof result !== "object") return result ?? { ok: true };
	const r = result as { documents?: Record<string, unknown>[]; posted?: number; failed?: number };
	const docs = Array.isArray(r.documents) ? r.documents : [];
	const brief = (d: Record<string, unknown>) => ({ number: d.number, type: d.type, amount: d.amount, counterparty: (d.counterparty as { name?: string })?.name, operation: d.operation });
	const posted = docs.filter((d) => d.posted === true).map(brief);
	const already = docs.filter((d) => d.alreadyPosted === true).map(brief);
	const failed = docs.filter((d) => typeof d.error === "string" && d.error);
	const needsSheet = failed.filter((d) => /списк\w* на перечисление|ведомост/i.test(String(d.error)));
	const other = failed.filter((d) => !needsSheet.includes(d));
	return {
		posted: posted.length, alreadyPosted: already.length, failed: failed.length,
		postedDocuments: posted,
		notPosted: {
			needsPayrollSheet: {
				count: needsSheet.length,
				reason: "вид операции (зарплата, пенсионные/социальные взносы, единый платёж) требует ведомость или документы перечисления из расчёта зарплаты; сумма ПП должна совпасть с суммой ведомости. Бухгалтер делает расчёт за период, подбирает ведомость в документе и проводит",
				documents: needsSheet.map(brief),
			},
			other: other.map((d) => ({ ...brief(d), error: String(d.error).slice(0, 300) })),
		},
	};
}

/** Результат загрузки из 1С в компактном виде для модели: строки без вложенных описаний. */
function compactImportResult(result: unknown): unknown {
	if (!result || typeof result !== "object") return result ?? { ok: true };
	const r = result as Record<string, unknown>;
	const lines = Array.isArray(r.lines) ? (r.lines as Record<string, unknown>[]) : [];
	const doc = (l: Record<string, unknown>) => (l.document && typeof l.document === "object" ? (l.document as Record<string, unknown>) : null);
	return {
		organization: (r.organization as { name?: string })?.name ?? null,
		account: (r.account as { iik?: string })?.iik ?? null,
		created: r.created, existing: r.existing, failed: r.failed,
		postedAlready: lines.filter((l) => doc(l)?.posted === true).length,
		createdCounterparties: Array.isArray(r.createdCounterparties) ? (r.createdCounterparties as { id?: string; name?: string; bin?: string }[]).map((c) => ({ id: c.id, name: c.name, bin: c.bin })) : [],
		warnings: r.warnings ?? [],
		messages: Array.isArray(r.messages) ? (r.messages as string[]).slice(0, 20) : [],
		lines: lines.map((l) => ({
			index: l.index, status: l.status, date: typeof l.date === "string" ? l.date.slice(0, 10) : l.date, direction: l.direction, amount: l.amount,
			counterparty: l.counterpartyName, counterpartyCreated: l.counterpartyCreated || undefined, knp: l.knp || undefined,
			operation: l.operation, cashFlowItem: l.cashFlowItem || undefined, needsReview: l.needsReview || undefined, hint: l.hint || undefined,
			postProcessError: l.postProcessError || undefined, accountNote: l.accountNote || undefined,
			documentId: doc(l)?.id, documentType: doc(l)?.type, documentNumber: doc(l)?.number, documentPosted: doc(l)?.posted === true ? true : undefined, error: l.error, remarks: l.remarks,
		})),
	};
}

/**
 * Результат сверки для модели: остатки и итоги целиком, а по строкам — только расхождения.
 * Совпавшие строки модели не нужны (их и так большинство), достаточно числа.
 */
function compactReconcileResult(result: unknown): unknown {
	if (!result || typeof result !== "object") return result ?? { ok: true };
	const r = result as Record<string, unknown>;
	const lines = Array.isArray(r.lines) ? (r.lines as Record<string, unknown>[]) : [];
	const extra = Array.isArray(r.onlyIn1C) ? (r.onlyIn1C as Record<string, unknown>[]) : [];
	const doc = (l: Record<string, unknown>) => (l.document && typeof l.document === "object" ? (l.document as { presentation?: string; posted?: boolean }) : null);
	return {
		organization: (r.organization as { name?: string })?.name ?? null,
		account: (r.account as { iik?: string })?.iik ?? null,
		ledgerAccount: r.ledgerAccount,
		period: r.period,
		balances: r.balances,
		summary: r.summary,
		discrepancies: lines.filter((l) => l.status !== "matched").slice(0, 100).map((l) => ({
			date: l.date, direction: l.direction, amount: l.amount, counterparty: l.counterpartyName, bin: l.counterpartyBin || undefined,
			status: l.status, note: l.note || undefined, document: doc(l)?.presentation,
		})),
		notes: lines.filter((l) => l.status === "matched" && l.note).slice(0, 30).map((l) => ({ date: l.date, amount: l.amount, counterparty: l.counterpartyName, note: l.note })),
		onlyIn1C: extra.slice(0, 100).map((x) => ({ date: x.date, direction: x.direction, amount: x.amount, counterparty: x.counterparty, corrAccount: x.corrAccount, posted: x.posted, document: doc(x)?.presentation })),
	};
}

export class WorkflowError extends Error {
	readonly code: string;
	constructor(code: string, message: string) {
		super(message);
		this.code = code;
	}
}
