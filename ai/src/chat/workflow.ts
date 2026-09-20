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
//
// КЛИЕНТСКИЕ ИНСТРУМЕНТЫ (СВ2, docs/CONTRACT_1C_CHAT_2026-09-19.md). В канале «чат внутри 1С» (channel "1c")
// команды не ставятся в очередь агенту: вызовы сохраняются в context.client и уходят клиенту ответом
// TOOL_CALLS — форма BPAPI_Чат выполняет их в сеансе пользователя 1С и присылает toolResults следующим ходом.
// commandType и payload — ровно те же, что ушли бы агенту. Белый список, защита от выдуманных id и карточки
// подтверждения — прежние: изменяющий вызов попадает в calls только после decision.accepted.
//
//   runModel ──tool_use READ──► TOOL_CALLS (calls) ──toolResults──► модель ──► …
//            ──tool_use WRITE─► WAITING_CONFIRMATION ──accepted──► TOOL_CALLS (с requestId) ──► …
//
// Предел раундов модели (CHAT_MAX_TOOL_ROUNDS) в этом режиме считается через ходы (context.rounds):
// иначе клиент, присылающий результаты, крутил бы модель бесконечно.

import { randomUUID } from "node:crypto";
import type { Db } from "../db/pool.ts";
import type { Logger } from "../logger.ts";
import type { LLMProvider, ChatMessage, ToolCall, ToolResult } from "../llm/provider.ts";
import { LLMError } from "../llm/provider.ts";
import { TOOLS_BY_NAME, toolDefinitions, collectIds, hasOwnOrganization, ROUTING_ORGANIZATION, ToolInputError, type ToolSpec } from "../tools/registry.ts";
import { SYSTEM_PROMPT } from "./prompt.ts";
import type { AgentService } from "../agents/service.ts";
import type { CommandQueue, CommandRow } from "../commands/queue.ts";
import type { Audit, AuditEvent } from "../audit/index.ts";
import { ExtractError, type StatementExtractor } from "../bank/extract.ts";
import type { StatementStore } from "../bank/store.ts";
import { summarize, fmt, type Statement } from "../bank/schema.ts";
import type { FileStore, FileRef } from "../files/store.ts";
import { extractOrgBases, referencedBases, rememberIdBases } from "./orgBases.ts";

export type Attachment = { fileName: string; mimeType: string; content: Buffer };

/** Сводка выписки в контексте диалога — для карточки подтверждения (без похода в базу). */
type StatementCard = { fileName: string; summary: string; reconciled: boolean; lines: number; ownerBin: string | null };

export type WorkflowState = "IDLE" | "UNDERSTANDING" | "RESOLVING_ENTITIES" | "WAITING_CLARIFICATION" | "WAITING_CONFIRMATION" | "EXECUTING" | "TOOL_CALLS" | "COMPLETED" | "FAILED";

/** Организация 1С хода — контекст диалога, а не проверка прав: права проверяет 1С. */
export type OnecOrganization = { bin?: string | null; name?: string | null; id?: string | null };

/**
 * Субъект хода. Для ERP — пользователь и активная организация. Для канала 1С uuid — «1c:<база>:<пользователь ИБ>»,
 * organizationUuid — организация ERP базы: диалог принадлежит паре «база + пользователь 1С».
 */
export type ChatUser = {
	uuid: string;
	organizationUuid: string;
	channel?: "erp" | "1c";
	onec?: { baseId: string; userName: string; organization: OnecOrganization | null };
};

type PendingCall = { toolCallId: string; tool: string; payload: Record<string, unknown>; requestId: string; card: string; priorResults: ToolResult[] };

/** Вызов, отданный клиенту на выполнение. callId = id tool_use модели. */
type ClientCall = { callId: string; tool: string; commandType: string; payload: Record<string, unknown>; requestId: string | null; statementId?: string | null };

/**
 * Незакрытый ответ модели в клиентском режиме: результаты уже известных вызовов, ожидающие у клиента и
 * ещё не разобранные (идут после изменяющего — его карточка показывается, когда чтения выполнены).
 */
type ClientCycle = { results: ToolResult[]; outstanding: ClientCall[]; rest: ToolCall[] };

/** Результат вызова от клиента: как ответ шлюза расширения { success, data | error, status }. */
export type ClientToolResult = { callId: string; result: { success: boolean; data?: unknown; error?: { code?: string; message?: string; details?: unknown } | null; status?: number } };

/** Созданный или найденный документ — для ссылок в клиенте. */
export type DocumentRef = { type: string; id: string; number: string; title: string };

type Context = {
	seenIds: string[];
	pending?: PendingCall | null;
	lastResult?: unknown;
	statements?: Record<string, StatementCard>;
	client?: ClientCycle | null;
	/** Раунды модели с последнего сообщения пользователя (клиентский режим). */
	rounds?: number;
	/** id и БИН организации → `baseKey` её базы из ответа get_organizations (многобазовый агент, СВ3). */
	orgBases?: Record<string, string>;
	/** id объекта 1С → база, из которой он пришёл (C0): вызов идёт в базу своих объектов. */
	idBases?: Record<string, string>;
	/** База → агент, который её обслужил в этом диалоге (C3): одноимённая база у другого агента — другая база. */
	baseAgents?: Record<string, string>;
	/** БИН организации ERP, прочитанный в этом диалоге (C18): организация диалога не меняется, ERP спрашиваем раз. */
	erpBin?: { org: string; bin: string | null };
};

/** Куда идёт команда чата (СВ3, C0): база агента, отказ по лимиту, смешение баз или «решит прежний путь». */
type Target =
	| (Extract<Awaited<ReturnType<AgentService["resolveBusiness"]>>, { kind: "agent" }> & { viaErpBin: string | null })
	| Extract<Awaited<ReturnType<AgentService["resolveBusiness"]>>, { kind: "refused" }>
	| { kind: "mixed"; message: string; details: { baseKeys: string[] } }
	| { kind: "none" };

const OVERVIEW_COMMANDS = new Set(["GET_ORGANIZATIONS", "HEALTH"]);

export type ChatReply = {
	conversationId: string;
	state: WorkflowState;
	/** Текст для пользователя. */
	text: string;
	/** Требуется ли подтверждение и что именно подтверждается. */
	confirmation?: { tool: string; card: string } | null;
	/** Файлы для пользователя (печатные формы, отчёты) — ссылки на хранилище сервиса. */
	attachments?: FileRef[];
	/** Вызовы для клиента (state TOOL_CALLS). */
	calls?: { callId: string; commandType: string; payload: Record<string, unknown>; requestId?: string }[];
	/** Созданные и найденные документы этого хода. */
	documents?: DocumentRef[];
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
	bank?: { extractor: StatementExtractor; store: StatementStore } | null;
	/** Хранилище файлов диалога (печатные формы, отчёты). */
	files: FileStore;
	/** БИН организации ERP — по нему выбирается база многобазового агента (СВ3); нет — база только по диалогу. */
	orgBin?: (organizationUuid: string) => Promise<string | null>;
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
	async prepare(user: ChatUser, conversationId: string | null): Promise<string> {
		const conv = conversationId ? await this.load(conversationId, user) : await this.create(user);
		if (!conv) throw new WorkflowError("NOT_FOUND", "Диалог не найден");
		// Ожидающее подтверждение не трогаем: решение «да/нет» принимается по context.pending,
		// а клиенту состояние WAITING_CONFIRMATION нужно, чтобы показывать карточку.
		if (conv.state !== "WAITING_CONFIRMATION") await this.setState(conv.id, "UNDERSTANDING", conv.context);
		return conv.id;
	}

	/** Фоновый ход: ошибки не теряются — попадают в состояние диалога и его историю. */
	async handleInBackground(user: ChatUser, conversationId: string, text: string, attachments: Attachment[]): Promise<void> {
		try {
			await this.handle(user, conversationId, text, attachments);
		} catch (e) {
			this.d.log.error({ err: e, conversationId }, "фоновый ход диалога завершился ошибкой");
			await this.appendMessage(conversationId, { role: "assistant", text: "Не удалось обработать вложения. Попробуйте ещё раз или отправьте файлы по одному.", toolCalls: [] });
			await this.d.db.query(`UPDATE conversations SET state = 'FAILED', updated_at = now() WHERE id = $1`, [conversationId]);
		}
	}

	/** Главная точка: сообщение пользователя → ответ. */
	async handle(user: ChatUser, conversationId: string | null, text: string, attachments: Attachment[] = []): Promise<ChatReply> {
		const conv = conversationId ? await this.load(conversationId, user) : await this.create(user);
		if (!conv) throw new WorkflowError("NOT_FOUND", "Диалог не найден");

		await this.audit(user, { event: "chat.user_message", conversationId: conv.id, userUuid: user.uuid, organizationUuid: user.organizationUuid,
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

		// Новое сообщение посреди цикла TOOL_CALLS: клиент бросил вызовы — закрываем их отказом, иначе у
		// tool_use модели не будет результатов.
		if (conv.context.client) await this.closeClientCycle(conv, "пользователь дал новое указание, вызовы не выполнены");

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

		await this.appendMessage(conv.id, { role: "user", text: onecContextLine(user) + text });
		conv.context.rounds = 0;
		await this.setState(conv.id, "UNDERSTANDING", conv.context);
		return this.runModel(conv, user, carryFiles);
	}

	/** Ответ на карточку подтверждения полем decision (канал 1С) — вместо текста «да»/«нет». */
	async decide(user: ChatUser, conversationId: string, accepted: boolean): Promise<ChatReply> {
		const conv = await this.load(conversationId, user);
		if (!conv) throw new WorkflowError("NOT_FOUND", "Диалог не найден");
		if (!conv.context.pending) throw new WorkflowError("NOTHING_TO_CONFIRM", "Диалог не ждёт подтверждения");
		return accepted ? this.executePending(conv, user) : this.cancelPending(conv, user);
	}

	/**
	 * Результаты вызовов от клиента. Каждый callId обязан быть среди ожидающих ЭТОГО диалога — чужой или
	 * выдуманный отклоняется целиком (400), до каких-либо изменений. Пришли не все — ждём остальные.
	 */
	async submitToolResults(user: ChatUser, conversationId: string, results: ClientToolResult[]): Promise<ChatReply> {
		const conv = await this.load(conversationId, user);
		if (!conv) throw new WorkflowError("NOT_FOUND", "Диалог не найден");
		const cyc = conv.context.client;
		if (!cyc || !cyc.outstanding.length) throw new WorkflowError("UNKNOWN_CALL", "Диалог не ждёт результатов вызовов");
		const ids = new Set<string>();
		for (const r of results) {
			if (ids.has(r.callId)) throw new WorkflowError("UNKNOWN_CALL", `Результат вызова ${r.callId} прислан дважды`);
			ids.add(r.callId);
			if (!cyc.outstanding.some((c) => c.callId === r.callId)) throw new WorkflowError("UNKNOWN_CALL", `Вызов ${r.callId} в этом диалоге не ожидается`);
		}
		await this.audit(user, { event: "chat.tool_results", conversationId: conv.id, userUuid: user.uuid, organizationUuid: user.organizationUuid,
			details: { results: results.map((r) => ({ callId: r.callId, success: r.result.success, status: r.result.status ?? null, code: r.result.error?.code ?? null })) } });

		const documents: DocumentRef[] = [];
		for (const r of results) {
			const oc = cyc.outstanding.find((c) => c.callId === r.callId)!;
			cyc.outstanding = cyc.outstanding.filter((c) => c !== oc);
			const spec = TOOLS_BY_NAME.get(oc.tool)!;
			const outcome: Outcome = r.result.success
				? { ok: true, data: r.result.data }
				: { ok: false, error: { code: r.result.error?.code ?? "ERROR", message: r.result.error?.message ?? `1С вернула ошибку${r.result.status ? ` (${r.result.status})` : ""}`, details: r.result.error?.details ?? null } };
			const out = await this.interpret(conv, user, spec, oc.payload, oc.callId, oc.statementId ?? null, outcome);
			cyc.results.push(out.result);
			if (outcome.ok) documents.push(...documentsOf(spec.commandType, outcome.data));
		}
		conv.context.client = cyc;

		let reply: ChatReply;
		if (cyc.outstanding.length) {
			await this.setState(conv.id, "TOOL_CALLS", conv.context);
			reply = { conversationId: conv.id, state: "TOOL_CALLS", text: "", calls: wireCalls(cyc.outstanding) };
		} else {
			reply = (await this.continueClient(conv, user, cyc, "", [], undefined)) ?? (await this.runModel(conv, user));
		}
		return documents.length ? { ...reply, documents: [...documents, ...(reply.documents ?? [])] } : reply;
	}

	// ── цикл с моделью ────────────────────────────────────────────────────

	private async runModel(conv: Conversation, user: ChatUser, carry: FileRef[] = []): Promise<ChatReply> {
		const attachments: FileRef[] = [...carry];
		let usage: ChatReply["usage"];

		const client = isClient(user);
		for (let round = client ? (conv.context.rounds ?? 0) : 0; round < this.d.maxToolRounds; round++) {
			if (client) conv.context.rounds = round + 1;
			const history = await this.history(conv.id);
			let res;
			try {
				// 16k: вызов инструмента со списком документов или длинный отчёт по выписке не должны
				// обрезаться по лимиту — обрезанный JSON инструмента превращается в пустой вызов.
				res = await this.d.llm.chat({ system: SYSTEM_PROMPT, messages: history, tools: toolDefinitions(), cacheable: true, maxTokens: 16_000 });
			} catch (e) {
				const err = e instanceof LLMError ? e : new LLMError("LLM_ERROR", String(e));
				this.d.log.error({ err, conversationId: conv.id }, "ошибка модели");
				await this.audit(user, { event: "chat.llm_error", conversationId: conv.id, userUuid: user.uuid, details: { code: err.code, message: err.message } });
				await this.setState(conv.id, "FAILED", conv.context);
				return { conversationId: conv.id, state: "FAILED", text: "Не удалось обратиться к модели. Попробуйте повторить через минуту." };
			}
			usage = res.usage ? { inputTokens: res.usage.inputTokens, outputTokens: res.usage.outputTokens, cacheRead: res.usage.cacheRead } : undefined;
			// Файлы этого хода закрепляются за итоговым сообщением ассистента — так они видны в истории.
			await this.appendMessage(conv.id, { role: "assistant", text: res.text, toolCalls: res.toolCalls, raw: res.raw, ...(res.toolCalls.length || !attachments.length ? {} : { files: attachments }) });
			await this.audit(user, { event: "chat.llm_turn", conversationId: conv.id, userUuid: user.uuid,
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

			// Клиентский режим: вызовы уходят клиенту, результаты придут следующим ходом.
			if (client) {
				const out = await this.continueClient(conv, user, { results: [], outstanding: [], rest: [...res.toolCalls] }, res.text, attachments, usage);
				if (out) return out;
				continue;
			}

			// Инструменты: сначала проверяем все, потом исполняем READ; WRITE/CRITICAL — на подтверждение.
			const results: ToolResult[] = [];
			for (const call of res.toolCalls) {
				const spec = TOOLS_BY_NAME.get(call.name);
				if (!spec) {
					results.push({ toolCallId: call.id, content: { error: "UNKNOWN_TOOL", message: `Инструмента ${call.name} нет` }, isError: true });
					continue;
				}
				const payload = await this.build(conv, user, spec, call);
				if ("error" in payload) {
					results.push(payload.error);
					continue;
				}

				if (this.needsConfirmation(spec)) {
					// Остальные tool_use этого хода закрываем сразу: API модели требует tool_result на каждый.
					const others = res.toolCalls.filter((c) => c.id !== call.id && !results.some((r) => r.toolCallId === c.id));
					for (const o of others) results.push(deferred(o.id));
					return this.askConfirmation(conv, user, spec, payload.payload, call.id, results, res.text, attachments, usage);
				}

				const out = await this.execute(conv, user, spec, payload.payload, call, spec.mutating ? randomUUID() : null);
				results.push(out.result);
				if (out.attachment) attachments.push(out.attachment);
			}
			await this.appendMessage(conv.id, { role: "user", toolResults: results });
		}

		await this.setState(conv.id, "FAILED", conv.context);
		return { conversationId: conv.id, state: "FAILED", text: "Слишком много шагов без результата. Уточните запрос.", attachments, usage };
	}

	/** Проверка и нормализация входа инструмента; в канале 1С — организация хода в organizationBin. */
	private async build(conv: Conversation, user: ChatUser, spec: ToolSpec, call: ToolCall): Promise<{ payload: Record<string, unknown> } | { error: ToolResult }> {
		try {
			const payload = withOrganization(user, spec, spec.buildPayload(call.input, { seenIds: new Set(conv.context.seenIds) }));
			// Адрес вызова (C0): у инструмента нет своей организации в 1С — `organizationId` называет только базу.
			const routeOrg = call.input[ROUTING_ORGANIZATION];
			if (!hasOwnOrganization(spec) && typeof routeOrg === "string" && routeOrg.trim()) {
				const orgBases = conv.context.orgBases ?? {};
				const baseKey = orgBases[routeOrg.trim()];
				if (baseKey) return { payload: { ...payload, baseKey } };
				// Организации одной базы в памяти нет (агент без нескольких баз) — адрес не нужен, молча пропускаем.
				if (Object.keys(orgBases).length) throw new ToolInputError(ROUTING_ORGANIZATION, `${ROUTING_ORGANIZATION}: организации нет в ответе get_organizations этого диалога`);
			}
			return { payload };
		} catch (e) {
			const msg = e instanceof ToolInputError ? e.message : String(e);
			await this.audit(user, { event: "chat.tool_rejected", conversationId: conv.id, userUuid: user.uuid, details: { tool: call.name, reason: msg } });
			return { error: { toolCallId: call.id, content: { error: "VALIDATION_ERROR", message: msg }, isError: true } };
		}
	}

	private needsConfirmation(spec: ToolSpec): boolean {
		return spec.operation === "CRITICAL" || (spec.operation === "WRITE" && this.d.confirmWrite);
	}

	/** Карточка подтверждения: вызов откладывается в context.pending, ход останавливается. */
	private async askConfirmation(conv: Conversation, user: ChatUser, spec: ToolSpec, payload: Record<string, unknown>, toolCallId: string,
		priorResults: ToolResult[], lead: string, attachments: FileRef[], usage: ChatReply["usage"]): Promise<ChatReply> {
		const pending: PendingCall = { toolCallId, tool: spec.name, payload, requestId: randomUUID(), card: this.card(spec, payload, conv.context), priorResults };
		conv.context.pending = pending;
		await this.setState(conv.id, "WAITING_CONFIRMATION", conv.context);
		await this.audit(user, { event: "chat.confirmation_requested", conversationId: conv.id, userUuid: user.uuid, requestId: pending.requestId, details: { tool: spec.name } });
		const question = this.question(spec.name, spec.operation);
		return { conversationId: conv.id, state: "WAITING_CONFIRMATION", text: `${lead ? lead + "\n\n" : ""}${pending.card}\n\n${question}`,
			confirmation: { tool: spec.name, card: pending.card }, attachments, usage };
	}

	// ── клиентские инструменты (канал 1С) ─────────────────────────────────

	/**
	 * Разбирает вызовы модели по порядку: чтения копятся в outstanding, изменяющий — на карточку. Изменяющий
	 * после чтений ждёт их результатов (остаётся в rest): карточка показывается, когда чтения выполнены.
	 * Возвращает ответ клиенту (TOOL_CALLS или карточка) или null — все вызовы закрыты, результаты записаны
	 * в историю и можно звать модель.
	 */
	private async continueClient(conv: Conversation, user: ChatUser, cyc: ClientCycle, lead: string, carry: FileRef[], usage: ChatReply["usage"]): Promise<ChatReply | null> {
		while (cyc.rest.length) {
			const call = cyc.rest.shift()!;
			const spec = TOOLS_BY_NAME.get(call.name);
			if (!spec) {
				cyc.results.push({ toolCallId: call.id, content: { error: "UNKNOWN_TOOL", message: `Инструмента ${call.name} нет` }, isError: true });
				continue;
			}
			const built = await this.build(conv, user, spec, call);
			if ("error" in built) {
				cyc.results.push(built.error);
				continue;
			}
			if (this.needsConfirmation(spec)) {
				if (cyc.outstanding.length) {
					cyc.rest.unshift(call);
					break;
				}
				for (const o of cyc.rest) cyc.results.push(deferred(o.id));
				conv.context.client = null;
				return this.askConfirmation(conv, user, spec, built.payload, call.id, cyc.results, lead, carry, usage);
			}
			const prep = await this.preparePayload(user, spec, built.payload, call.id);
			if ("error" in prep) {
				cyc.results.push(prep.error);
				continue;
			}
			cyc.outstanding.push({ callId: call.id, tool: spec.name, commandType: spec.commandType, payload: prep.payload, requestId: spec.mutating ? randomUUID() : null, statementId: prep.statementId });
		}
		if (cyc.outstanding.length) {
			conv.context.client = cyc;
			await this.setState(conv.id, "TOOL_CALLS", conv.context);
			await this.audit(user, { event: "chat.tool_calls", conversationId: conv.id, userUuid: user.uuid, organizationUuid: user.organizationUuid,
				details: { calls: cyc.outstanding.map((c) => ({ callId: c.callId, type: c.commandType, tool: c.tool, requestId: c.requestId })) } });
			return { conversationId: conv.id, state: "TOOL_CALLS", text: lead, calls: wireCalls(cyc.outstanding), attachments: carry, usage };
		}
		conv.context.client = null;
		await this.appendMessage(conv.id, { role: "user", toolResults: cyc.results });
		return null;
	}

	/** Клиент бросил цикл (новое сообщение): все незакрытые вызовы — отказом, чтобы история оставалась валидной. */
	private async closeClientCycle(conv: Conversation, reason: string): Promise<void> {
		const cyc = conv.context.client;
		if (!cyc) return;
		const cancelled = (id: string): ToolResult => ({ toolCallId: id, content: { cancelled: true, reason }, isError: true });
		await this.appendMessage(conv.id, { role: "user", toolResults: [...cyc.results, ...cyc.outstanding.map((c) => cancelled(c.callId)), ...cyc.rest.map((c) => cancelled(c.id))] });
		conv.context.client = null;
	}

	// ── подтверждение ─────────────────────────────────────────────────────

	private async executePending(conv: Conversation, user: ChatUser): Promise<ChatReply> {
		const p = conv.context.pending!;
		const spec = TOOLS_BY_NAME.get(p.tool)!;
		await this.audit(user, { event: "chat.confirmed", conversationId: conv.id, userUuid: user.uuid, requestId: p.requestId, details: { tool: p.tool } });
		conv.context.pending = null;
		if (isClient(user)) {
			// Подтверждённый вызов уходит клиенту с тем requestId, что был выдан при карточке: повтор — тот же.
			conv.context.rounds = 0;
			const prep = await this.preparePayload(user, spec, p.payload, p.toolCallId);
			if ("error" in prep) {
				await this.appendMessage(conv.id, { role: "user", toolResults: [...p.priorResults, prep.error] });
				return this.runModel(conv, user);
			}
			const cyc: ClientCycle = { results: [...p.priorResults], outstanding: [{ callId: p.toolCallId, tool: spec.name, commandType: spec.commandType, payload: prep.payload, requestId: p.requestId, statementId: prep.statementId }], rest: [] };
			return (await this.continueClient(conv, user, cyc, "", [], undefined))!;
		}
		const out = await this.execute(conv, user, spec, p.payload, { id: p.toolCallId, name: p.tool, input: p.payload }, p.requestId);
		await this.appendMessage(conv.id, { role: "user", toolResults: [...p.priorResults, out.result] });
		return this.runModel(conv, user, out.attachment ? [out.attachment] : []);
	}

	private async cancelPending(conv: Conversation, user: ChatUser): Promise<ChatReply> {
		const p = conv.context.pending!;
		await this.audit(user, { event: "chat.cancelled", conversationId: conv.id, userUuid: user.uuid, requestId: p.requestId, details: { tool: p.tool } });
		conv.context.pending = null;
		await this.appendMessage(conv.id, { role: "user", toolResults: [...p.priorResults, { toolCallId: p.toolCallId, content: { cancelled: true, reason: "пользователь отказался" }, isError: true }] });
		await this.setState(conv.id, "COMPLETED", conv.context);
		const what = p.tool === "create_sale" ? "Документ не создан." : p.tool === "import_bank_statement" ? "Выписка не загружена." : "Операция не выполнена.";
		return { conversationId: conv.id, state: "COMPLETED", text: `Отменено. ${what}` };
	}

	// ── исполнение через агента ───────────────────────────────────────────

	private async execute(conv: Conversation, user: ChatUser, spec: ToolSpec, payload: Record<string, unknown>, call: ToolCall, requestId: string | null): Promise<{ result: ToolResult; attachment?: FileRef }> {
		const target = await this.targetBase(conv, user, spec, payload);
		if (target.kind === "mixed") {
			await this.audit(user, { event: "chat.mixed_bases", conversationId: conv.id, userUuid: user.uuid, organizationUuid: user.organizationUuid, details: { tool: spec.name, ...target.details } });
			return { result: { toolCallId: call.id, content: { error: "MIXED_BASES", message: target.message, details: target.details }, isError: true } };
		}
		if (target.kind === "refused") {
			// Сверх лимита тарифа — отказ здесь, в очередь не ставим: агент ответил бы тем же, но позже.
			await this.audit(user, { event: "chat.license_limit", conversationId: conv.id, userUuid: user.uuid, organizationUuid: user.organizationUuid, details: { tool: spec.name, ...target.details } });
			return { result: { toolCallId: call.id, content: { error: target.code, message: target.message, details: target.details }, isError: true } };
		}
		if (target.kind === "agent" && !target.agent.online) {
			return { result: { toolCallId: call.id, content: { error: "AGENT_OFFLINE", message: `Агент 1С, обслуживающий базу «${target.baseKey}», сейчас не на связи (служба на компьютере с 1С не запущена или нет сети)` }, isError: true } };
		}
		const agent = target.kind === "agent" ? target.agent : await this.d.agents.pickOnline(user.organizationUuid);
		if (!agent) {
			// «Не настроен» и «не на связи» — разные ситуации с разными действиями пользователя:
			// в первом случае бесполезно ждать, нужно переключить организацию или завести агента.
			// Считаются только бизнес-агенты (C13): админ-агент документы не проводит, и «не на связи» про него — неправда.
			const configured = (await this.d.agents.listByOrganization(user.organizationUuid)).filter((a) => !a.disabled && a.role === "business");
			await this.audit(user, { event: "chat.agent_unavailable", conversationId: conv.id, userUuid: user.uuid, organizationUuid: user.organizationUuid, details: { configured: configured.length } });
			const message = configured.length
				? "Агент 1С этой организации сейчас не на связи (служба на компьютере с 1С не запущена или нет сети)"
				: "Для активной организации ERP агент 1С не настроен. Переключите организацию на ту, к которой подключена база 1С, или заведите агента для этой организации";
			return { result: { toolCallId: call.id, content: { error: configured.length ? "AGENT_OFFLINE" : "AGENT_NOT_CONFIGURED", message }, isError: true } };
		}
		if (target.kind === "agent") {
			// Доступность — по базе, а не по агенту (C6): у многобазового агента одна база может лежать, другие — работать.
			if (target.baseStatus === "OFFLINE") {
				return { result: { toolCallId: call.id, content: { error: "ONEC_UNAVAILABLE", message: `База 1С «${target.baseKey}» сейчас недоступна для агента` }, isError: true } };
			}
		} else {
			if (!agent.onec.reachable) {
				return { result: { toolCallId: call.id, content: { error: "ONEC_UNAVAILABLE", message: "База 1С недоступна для агента" }, isError: true } };
			}
			// Адреса нет, а баз у агента несколько (C2): агент ответил бы BASE_REQUIRED — отвечаем сами, без очереди.
			if (!OVERVIEW_COMMANDS.has(spec.commandType)) {
				const keys = await this.d.agents.basesOf(agent.id);
				if (keys.length > 1) {
					return { result: { toolCallId: call.id, content: {
						error: "BASE_REQUIRED",
						message: `У агента несколько баз 1С (${keys.map((k) => `«${k}»`).join(", ")}), а из вызова не понять, в какую идти: `
							+ "у организации ERP нет БИН или его нет ни в одной базе. Вызовите get_organizations и передайте organizationId нужной организации.",
						details: { baseKeys: keys },
					}, isError: true } };
				}
			}
		}

		await this.setState(conv.id, "EXECUTING", conv.context);

		const prep = await this.preparePayload(user, spec, payload, call.id);
		if ("error" in prep) return { result: prep.error };
		// База — в каждой бизнес-команде многобазового агента; в 1С `baseKey` не уходит, агент его снимает.
		if (target.kind === "agent") {
			prep.payload = { ...prep.payload, baseKey: target.baseKey };
			// База выбрана по БИН организации ERP (C7) — он же говорит 1С, какая из организаций базы имеется в виду.
			const props = (spec.inputSchema as { properties?: Record<string, unknown> }).properties ?? {};
			if (target.viaErpBin && "organizationBin" in props && !prep.payload.organizationBin && !prep.payload.organizationId) {
				prep.payload = { ...prep.payload, organizationBin: target.viaErpBin };
			}
		}

		const cmd = await this.d.queue.enqueue({
			agentId: agent.id, organizationUuid: user.organizationUuid, type: spec.commandType, payload: prep.payload, requestId,
			// База — и в колонке очереди (C1): команды одной базы идут по очереди, повтор узнаётся в пределах базы.
			...(target.kind === "agent" ? { baseKey: target.baseKey } : {}),
			// Больше предела агента (600 с) с запасом на ожидание пропуска (С24): при равных сроках команда
			// объявлялась просроченной ровно тогда, когда агент ещё мог ответить.
			userUuid: user.uuid, conversationId: conv.id, ttlSeconds: 900,
		});
		await this.audit(user, { event: "command.enqueue", conversationId: conv.id, userUuid: user.uuid, agentId: agent.id, commandId: cmd.id, requestId, details: { type: spec.commandType, tool: spec.name, source: "chat" } });

		const done: CommandRow | null = await this.d.queue.waitResult(cmd.id, this.d.commandTimeoutMs);
		if (!done || done.state === "queued" || done.state === "dispatched") {
			return { result: { toolCallId: call.id, content: { error: "TIMEOUT", message: "1С не ответила вовремя; команда осталась в очереди" }, isError: true } };
		}
		if (done.state === "expired") {
			return { result: { toolCallId: call.id, content: { error: "EXPIRED", message: "Команда не была исполнена агентом вовремя" }, isError: true } };
		}
		const outcome: Outcome = done.state === "failed" ? { ok: false, error: done.error ?? null } : { ok: true, data: done.result };
		// Объекты ответа — из этой базы (C0): следующий вызов с ними уйдёт туда же. Сохраняется вместе с контекстом в interpret.
		if (target.kind === "agent") {
			conv.context.idBases ??= {};
			rememberIdBases(outcome.ok ? outcome.data : outcome.error?.details, target.baseKey, conv.context.idBases, collectIds);
			conv.context.baseAgents = { ...conv.context.baseAgents, [target.baseKey]: agent.id };
		} else if (outcome.ok && spec.commandType === "GET_ORGANIZATIONS") {
			// Организации всех баз этого агента: их базы — его (C3).
			const bases = Object.fromEntries(Object.values(extractOrgBases(outcome.data).map).map((k) => [k, agent.id]));
			if (Object.keys(bases).length) conv.context.baseAgents = { ...conv.context.baseAgents, ...bases };
		}
		return this.interpret(conv, user, spec, prep.payload, call.id, prep.statementId, outcome);
	}

	/**
	 * БАЗА МНОГОБАЗОВОГО АГЕНТА ДЛЯ КОМАНДЫ ЧАТА (СВ3, C0). Порядок — как у агента, плюс память диалога:
	 *   1) база, которую называет сам вызов: адрес `organizationId` у поиска и чтения, организация из ответа
	 *      get_organizations, объекты, пришедшие из базы раньше (C0). Несколько разных — отказ MIXED_BASES;
	 *   2) иначе база с организацией по БИН — из вызова, а без него по БИН организации ERP.
	 * Обзорные команды без адреса (список организаций, здоровье) базу не получают — агент отдаёт их по всем базам.
	 */
	private async targetBase(conv: Conversation, user: ChatUser, spec: ToolSpec, payload: Record<string, unknown>): Promise<Target> {
		const explicit = typeof payload.baseKey === "string" && payload.baseKey.trim() ? payload.baseKey.trim() : null;
		const named = [...new Set([...(explicit ? [explicit] : []), ...referencedBases(payload, conv.context.orgBases, conv.context.idBases)])];
		if (named.length > 1) {
			return {
				kind: "mixed",
				message: `В одном вызове объекты из разных баз 1С: ${named.map((k) => `«${k}»`).join(", ")}. Объект одной базы в другой `
					+ "не существует — найдите его заново в базе нужной организации (organizationId в поиске).",
				details: { baseKeys: named },
			};
		}
		const baseKey = named[0] ?? null;
		const callBin = typeof payload.organizationBin === "string" ? payload.organizationBin.trim() : "";
		let bin: string | null = callBin || null;
		let viaErpBin: string | null = null;
		// БИН организации ERP — только когда вызов сам базу и организацию не назвал: иначе он проверял бы чужую.
		if (!bin && !baseKey && !OVERVIEW_COMMANDS.has(spec.commandType) && this.d.orgBin) {
			const cached = conv.context.erpBin?.org === user.organizationUuid ? conv.context.erpBin : null;
			if (cached) bin = cached.bin;
			else {
				let failed = false;
				bin = await this.d.orgBin(user.organizationUuid).catch((e: unknown) => {
					failed = true;
					this.d.log.warn({ err: e instanceof Error ? e.message : String(e) }, "chat: БИН организации ERP не прочитан");
					return null;
				});
				// Сбой чтения не запоминаем: в следующем вызове ERP спросим снова.
				if (!failed) conv.context.erpBin = { org: user.organizationUuid, bin };
			}
			viaErpBin = bin;
		}
		if (!baseKey && !bin) return { kind: "none" };
		const preferAgentId = baseKey ? conv.context.baseAgents?.[baseKey] ?? null : null;
		const r = await this.d.agents.resolveBusiness(user.organizationUuid, { baseKey, bin, preferAgentId });
		return r.kind === "agent" ? { ...r, viaErpBin } : r;
	}

	/**
	 * Payload для 1С: выписка и проведение по выпискам собираются из хранилища сервиса, а не со слов модели.
	 * Общий для агента и клиента — клиент получает ровно тот payload, что ушёл бы агенту.
	 */
	private async preparePayload(user: ChatUser, spec: ToolSpec, payload: Record<string, unknown>, callId: string): Promise<{ payload: Record<string, unknown>; statementId: string | null } | { error: ToolResult }> {
		// Выписка: модель передала только statementId, строки для 1С — из хранилища.
		// Сверка получает ту же выписку целиком (с периодом и остатками), но ничего не пишет.
		let statementId: string | null = null;
		if (spec.commandType === "IMPORT_BANK_STATEMENT" || spec.commandType === "RECONCILE_STATEMENT") {
			const sid = String(payload.statementId ?? "");
			const stored = this.d.bank ? await this.d.bank.store.get(sid, user.organizationUuid) : null;
			if (!stored) {
				return { error: { toolCallId: callId, content: { error: "STATEMENT_NOT_FOUND", message: "Выписка с таким statementId не найдена в этой организации" }, isError: true } };
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
					return { error: { toolCallId: callId, content: { error: "STATEMENT_NOT_IMPORTED", message: `Выписка ${sid} ещё не загружена в 1С — проводить нечего` }, isError: true } };
				}
				documents.push(...documentsOfImport(stored.importResult));
			}
			if (!documents.length) {
				return { error: { toolCallId: callId, content: { error: "NO_DOCUMENTS", message: "По этим выпискам в 1С не создано ни одного документа" }, isError: true } };
			}
			payload = { documents };
		}
		return { payload, statementId };
	}

	/** Итог вызова (от агента или от клиента) → результат для модели. */
	private async interpret(conv: Conversation, user: ChatUser, spec: ToolSpec, payload: Record<string, unknown>, callId: string, statementId: string | null, outcome: Outcome): Promise<{ result: ToolResult; attachment?: FileRef }> {
		if (!outcome.ok) {
			const error = outcome.error;
			// Кандидаты из CONTRACT_AMBIGUOUS и подобных ответов — тоже реальные объекты 1С:
			// модель должна иметь право сослаться на них после выбора пользователя.
			const seenErr = new Set(conv.context.seenIds);
			collectIds(error?.details, seenErr);
			conv.context.seenIds = [...seenErr];
			await this.setState(conv.id, "EXECUTING", conv.context);
			if (statementId && this.d.bank) await this.d.bank.store.markImported(statementId, "failed", error ?? null);
			return { result: { toolCallId: callId, content: { error: error?.code ?? "ERROR", message: error?.message ?? "", details: error?.details ?? null }, isError: true } };
		}
		let data = outcome.data;

		// Организации многобазового агента: `baseKey` — сервису (адрес следующих вызовов), модели — без него.
		if (spec.commandType === "GET_ORGANIZATIONS") {
			const { visible, map } = extractOrgBases(data);
			if (Object.keys(map).length) {
				conv.context.orgBases = { ...conv.context.orgBases, ...map };
				data = visible;
			}
		}

		// Успех: запоминаем id для последующих вызовов; PDF не отдаём модели — только пользователю.
		const seen = new Set(conv.context.seenIds);
		collectIds(data, seen);
		conv.context.seenIds = [...seen];
		const isFile = spec.commandType === "PRINT_SALE" || spec.commandType === "PRINT_DOCUMENT" || spec.commandType === "RUN_REPORT";
		conv.context.lastResult = isFile ? { form: (data as { form?: string })?.form } : data;
		await this.setState(conv.id, "EXECUTING", conv.context);

		if (statementId && this.d.bank) {
			await this.d.bank.store.markImported(statementId, "imported", data ?? null);
			// Модели — компактный результат: сотня строк с вложенными описаниями документов
			// и контрагентов — это тысячи токенов ни о чём.
			return { result: { toolCallId: callId, content: compactImportResult(data) } };
		}

		if (spec.commandType === "POST_BANK_DOCUMENTS") {
			return { result: { toolCallId: callId, content: compactPostResult(data) } };
		}

		if (spec.commandType === "RECONCILE_STATEMENT") {
			return { result: { toolCallId: callId, content: compactReconcileResult(data) } };
		}

		if (isFile && data && typeof data === "object") {
			const r = data as { fileName?: string; mimeType?: string; content?: string; size?: number; presentation?: string; format?: string; type?: string; document?: { id?: string }; rows?: number; contentOmitted?: boolean; bytes?: number };
			if (isClient(user)) {
				// Канал 1С: файл остался у пользователя — форма сохранила и открыла его, в сервис пришёл только размер.
				if (!r.contentOmitted && !r.content) return { result: { toolCallId: callId, content: { error: "EMPTY_FILE", message: "1С вернула пустой файл" }, isError: true } };
				const size = typeof r.bytes === "number" ? r.bytes : r.content ? Buffer.byteLength(r.content, "base64") : undefined;
				await this.audit(user, { event: "chat.file_in_client", conversationId: conv.id, userUuid: user.uuid, organizationUuid: user.organizationUuid, details: { tool: spec.name, fileName: r.fileName ?? null, size: size ?? null } });
				return { result: { toolCallId: callId, content: { ok: true, form: r.presentation, fileName: r.fileName, size, format: r.format ?? payload.format ?? "pdf", rows: r.rows, note: "файл сформирован и открыт у пользователя в 1С" } } };
			}
			// Файл — в хранилище сервиса; модели только имя и размер, пользователю — ссылка.
			if (!r.content) return { result: { toolCallId: callId, content: { error: "EMPTY_FILE", message: "1С вернула пустой файл" }, isError: true } };
			const ref = await this.d.files.save({
				conversationId: conv.id, organizationUuid: user.organizationUuid, userUuid: user.uuid,
				fileName: r.fileName ?? "document.pdf", mimeType: r.mimeType ?? "application/pdf", content: Buffer.from(r.content, "base64"),
				source: { tool: spec.name, form: r.presentation, format: r.format, documentType: r.type ?? payload.documentType, documentId: r.document?.id ?? payload.documentId, report: payload.report, from: payload.from, to: payload.to, account: payload.account },
			});
			await this.audit(user, { event: "chat.file_created", conversationId: conv.id, userUuid: user.uuid, organizationUuid: user.organizationUuid, details: { fileId: ref.fileId, fileName: ref.fileName, size: ref.size } });
			return {
				result: { toolCallId: callId, content: { ok: true, form: r.presentation, fileName: ref.fileName, size: ref.size, format: r.format ?? "pdf", rows: r.rows, note: "файл передан пользователю вложением к ответу" } },
				attachment: ref,
			};
		}
		return { result: { toolCallId: callId, content: data ?? { ok: true } } };
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
		if (spec.name === "create_invoice") {
			const items = (payload.items as { productId: string; quantity: number; price: number }[]) ?? [];
			const lines = items.map((it) => `• ${nameOf(it.productId)} — ${it.quantity} × ${it.price} ₸`);
			return [
				"Счёт на оплату покупателю",
				`Покупатель: ${nameOf(payload.customerId)}`,
				payload.organizationBin ? `Организация: БИН ${String(payload.organizationBin)}` : null,
				payload.contractId ? `Договор: ${nameOf(payload.contractId)}` : null,
				...lines,
				"Итоговую сумму и НДС рассчитает 1С.",
			].filter(Boolean).join("\n");
		}
		if (spec.name === "create_purchase") {
			const items = (payload.items as { productId: string; quantity: number; price: number }[]) ?? [];
			const lines = items.map((it) => `• ${nameOf(it.productId)} — ${it.quantity} × ${it.price} ₸`);
			return [
				"Поступление товаров и услуг",
				`Поставщик: ${nameOf(payload.supplierId)}`,
				payload.warehouseId ? `Склад: ${nameOf(payload.warehouseId)}` : null,
				payload.organizationBin ? `Организация: БИН ${String(payload.organizationBin)}` : null,
				payload.contractId ? `Договор: ${nameOf(payload.contractId)}` : null,
				payload.incomingNumber ? `Документ поставщика: № ${String(payload.incomingNumber)}${payload.incomingDate ? ` от ${String(payload.incomingDate)}` : ""}` : null,
				...lines,
				"Итоговую сумму и НДС рассчитает 1С. Документ будет записан без проведения.",
			].filter(Boolean).join("\n");
		}
		if (spec.name === "create_reconciliation_act") {
			return [
				"Акт сверки взаиморасчётов",
				`Контрагент: ${nameOf(payload.counterpartyId)}`,
				`Период: ${String(payload.from)} — ${String(payload.to)}`,
				payload.organizationBin ? `Организация: БИН ${String(payload.organizationBin)}` : null,
				payload.contractId ? `Договор: ${nameOf(payload.contractId)}` : null,
				payload.post ? "Документ будет проведён." : "Документ будет записан без проведения.",
				"Заполняется по данным учёта 1С; данные контрагента — зеркально.",
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
	private async attachStatements(conv: Conversation, user: ChatUser, text: string, attachments: Attachment[]): Promise<{ text: string; files: FileRef[] }> {
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
				await this.audit(user, { event: "chat.statement_extracted", conversationId: conv.id, userUuid: user.uuid, organizationUuid: user.organizationUuid,
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
				await this.audit(user, { event: "chat.statement_failed", conversationId: conv.id, userUuid: user.uuid, details: { fileName: a.fileName, fileId: file?.fileId ?? null, error: msg } });
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

	private async create(user: ChatUser): Promise<Conversation> {
		const id = randomUUID();
		if (isClient(user)) {
			// Канал 1С: агента нет — вызовы выполняет сама форма.
			await this.d.db.query(
				`INSERT INTO conversations (id, organization_uuid, user_uuid, state, context, channel, base_id, onec_user_name)
				 VALUES ($1, $2, $3, 'IDLE', '{"seenIds":[]}', '1c', $4, $5)`,
				[id, user.organizationUuid, user.uuid, user.onec?.baseId ?? null, user.onec?.userName ?? null],
			);
			return { id, state: "IDLE", context: { seenIds: [] } };
		}
		// Агента в беседу не пишем (C5): исполнитель выбирается на каждый вызов по базе, и «агент беседы» был бы
		// неправдой при нескольких агентах. Кто выполнял команды — видно по очереди и аудиту (commands.conversation_id).
		await this.d.db.query(
			`INSERT INTO conversations (id, organization_uuid, user_uuid, state, context) VALUES ($1, $2, $3, 'IDLE', '{"seenIds":[]}')`,
			[id, user.organizationUuid, user.uuid],
		);
		return { id, state: "IDLE", context: { seenIds: [] } };
	}

	/** Аудит хода; в канале 1С — с пометкой канала и базы. */
	private async audit(user: ChatUser, e: AuditEvent): Promise<void> {
		if (!isClient(user)) return this.d.audit.write(e);
		return this.d.audit.write({ ...e, details: { ...(e.details ?? {}), channel: "1c", baseId: user.onec?.baseId ?? null } });
	}

	private async load(id: string, user: ChatUser): Promise<Conversation | null> {
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
	async summary(conversationId: string, user: ChatUser) {
		const conv = await this.load(conversationId, user);
		if (!conv) return null;
		const r = await this.d.db.query<{ role: string; content: ChatMessage; created_at: Date }>(`SELECT role, content, created_at FROM messages WHERE conversation_id = $1 ORDER BY id`, [conversationId]);
		const messages = r.rows
			.filter((m) => (m.role === "user" && "text" in m.content) || (m.role === "assistant" && m.content.role === "assistant" && (m.content.text || m.content.files?.length)))
			.map((m) => ({
				role: m.role, text: "text" in m.content ? stripOnecContext(m.content.text) : "", at: m.created_at.toISOString(),
				...(m.content.role === "assistant" && m.content.files?.length ? { attachments: m.content.files } : {}),
			}));
		const pending = conv.state === "WAITING_CONFIRMATION" ? conv.context.pending : null;
		if (pending) messages.push({ role: "assistant", text: `${pending.card}\n\n${this.question(pending.tool, TOOLS_BY_NAME.get(pending.tool)?.operation ?? "WRITE")}`, at: new Date().toISOString() });
		// Форма, закрытая посреди цикла TOOL_CALLS, продолжит его по этим вызовам (те же callId и requestId).
		const calls = conv.state === "TOOL_CALLS" && conv.context.client?.outstanding.length ? wireCalls(conv.context.client.outstanding) : null;
		return {
			id: conv.id, state: conv.state, messages,
			confirmation: pending ? { tool: pending.tool, card: pending.card } : null,
			...(calls ? { calls } : {}),
		};
	}

	/** Последние диалоги пользователя в организации — для списка в интерфейсе. */
	async list(user: ChatUser, limit = 20) {
		const r = await this.d.db.query<{ id: string; state: WorkflowState; updated_at: Date; created_at: Date; preview: string | null }>(
			`SELECT c.id, c.state, c.updated_at, c.created_at,
			        (SELECT m.content->>'text' FROM messages m WHERE m.conversation_id = c.id AND m.role = 'user' AND m.content ? 'text' ORDER BY m.id LIMIT 1) AS preview
			   FROM conversations c
			  WHERE c.user_uuid = $1 AND c.organization_uuid = $2
			  ORDER BY c.updated_at DESC LIMIT $3`,
			[user.uuid, user.organizationUuid, limit]);
		return r.rows
			.filter((c) => c.preview)
			.map((c) => ({ id: c.id, state: c.state, preview: stripOnecContext(c.preview ?? "").slice(0, 80), updatedAt: c.updated_at.toISOString(), createdAt: c.created_at.toISOString() }));
	}
}

type Conversation = { id: string; state: WorkflowState; context: Context };

/** Итог вызова: данные или ошибка 1С — от агента или от клиента, разбирается одинаково. */
type Outcome = { ok: true; data: unknown } | { ok: false; error: { code?: string; message?: string; details?: unknown } | null };

function isClient(user: ChatUser): boolean {
	return user.channel === "1c";
}

const deferred = (toolCallId: string): ToolResult => ({ toolCallId, content: { error: "DEFERRED", message: "не выполнено: сначала нужно подтверждение предыдущей операции" }, isError: true });

/** Вызовы в формате контракта: requestId — только у изменяющих. */
function wireCalls(calls: ClientCall[]): NonNullable<ChatReply["calls"]> {
	return calls.map((c) => ({ callId: c.callId, commandType: c.commandType, payload: c.payload, ...(c.requestId ? { requestId: c.requestId } : {}) }));
}

/**
 * КОНТЕКСТ 1С ДЛЯ МОДЕЛИ. Системный промпт кэшируется и изменчивого не содержит, поэтому организация и имя
 * пользователя идут первой строкой сообщения. Строка одна (переводы строк из имён убираются), чтобы история
 * интерфейса могла её снять (stripOnecContext).
 */
const ONEC_CONTEXT_PREFIX = "[Контекст 1С:";
function onecContextLine(user: ChatUser): string {
	if (!isClient(user) || !user.onec) return "";
	const one = (v: unknown) => String(v ?? "").replace(/[\r\n\]]+/g, " ").trim();
	const org = user.onec.organization;
	const orgText = org && (org.name || org.bin)
		? `организация «${one(org.name) || "без названия"}»${org.bin ? `, БИН ${one(org.bin)}` : ""} — все операции с ней, не спрашивай, какая организация`
		: "организация не выбрана";
	return `${ONEC_CONTEXT_PREFIX} пользователь «${one(user.onec.userName) || "без имени"}»; ${orgText}.]\n`;
}

export function stripOnecContext(text: string): string {
	if (!text.startsWith(ONEC_CONTEXT_PREFIX)) return text;
	const nl = text.indexOf("\n");
	return nl < 0 ? "" : text.slice(nl + 1);
}

/**
 * ОРГАНИЗАЦИЯ ХОДА — В ИНСТРУМЕНТЫ (канал 1С). Пользователь выбрал организацию в форме, поэтому её БИН
 * подставляется во все инструменты, которые принимают organizationBin, — поверх выбора модели. Инструментам без
 * этого поля payload не меняется: он обязан совпадать с тем, что ушло бы агенту.
 */
function withOrganization(user: ChatUser, spec: ToolSpec, payload: Record<string, unknown>): Record<string, unknown> {
	const bin = user.onec?.organization?.bin?.trim();
	if (!isClient(user) || !bin || !/^\d{12}$/.test(bin)) return payload;
	const props = (spec.inputSchema as { properties?: Record<string, unknown> }).properties ?? {};
	return "organizationBin" in props ? { ...payload, organizationBin: bin } : payload;
}

/** Документы 1С по командам: тип для ссылки и подпись. */
const DOCUMENT_COMMANDS: Record<string, { type: string; label: string }> = {
	CREATE_SALE: { type: "sale", label: "Реализация" }, GET_SALE: { type: "sale", label: "Реализация" },
	POST_SALE: { type: "sale", label: "Реализация" }, UNPOST_SALE: { type: "sale", label: "Реализация" },
	CREATE_PURCHASE: { type: "purchase", label: "Поступление" }, GET_PURCHASE: { type: "purchase", label: "Поступление" },
	POST_PURCHASE: { type: "purchase", label: "Поступление" }, UNPOST_PURCHASE: { type: "purchase", label: "Поступление" },
	CREATE_INVOICE: { type: "invoice", label: "Счёт на оплату" }, GET_INVOICE: { type: "invoice", label: "Счёт на оплату" },
	CREATE_RECONCILIATION_ACT: { type: "reconciliationAct", label: "Акт сверки" },
};

/** Созданные и найденные документы из результата 1С. Поле необязательное: форма строит ссылки и сама. */
export function documentsOf(commandType: string, data: unknown): DocumentRef[] {
	const kind = DOCUMENT_COMMANDS[commandType];
	if (!kind || !data || typeof data !== "object") return [];
	const d = data as { id?: unknown; number?: unknown; document?: { id?: unknown; number?: unknown } };
	const id = typeof d.id === "string" ? d.id : typeof d.document?.id === "string" ? d.document.id : null;
	if (!id) return [];
	const num = d.number ?? d.document?.number;
	const number = typeof num === "string" || typeof num === "number" ? String(num).trim() : "";
	return [{ type: kind.type, id, number, title: number ? `${kind.label} №${number}` : kind.label }];
}

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
