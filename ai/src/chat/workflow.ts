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

export type WorkflowState = "IDLE" | "UNDERSTANDING" | "RESOLVING_ENTITIES" | "WAITING_CLARIFICATION" | "WAITING_CONFIRMATION" | "EXECUTING" | "COMPLETED" | "FAILED";

type PendingCall = { toolCallId: string; tool: string; payload: Record<string, unknown>; requestId: string; card: string; priorResults: ToolResult[] };

type Context = {
	seenIds: string[];
	pending?: PendingCall | null;
	lastResult?: unknown;
};

export type ChatReply = {
	conversationId: string;
	state: WorkflowState;
	/** Текст для пользователя. */
	text: string;
	/** Требуется ли подтверждение и что именно подтверждается. */
	confirmation?: { tool: string; card: string } | null;
	/** Вложения (PDF печатной формы) — base64 из 1С. */
	attachments?: { fileName: string; mimeType: string; content: string }[];
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

	/** Главная точка: сообщение пользователя → ответ. */
	async handle(user: { uuid: string; organizationUuid: string }, conversationId: string | null, text: string): Promise<ChatReply> {
		const conv = conversationId ? await this.load(conversationId, user) : await this.create(user);
		if (!conv) throw new WorkflowError("NOT_FOUND", "Диалог не найден");

		await this.d.audit.write({ event: "chat.user_message", conversationId: conv.id, userUuid: user.uuid, organizationUuid: user.organizationUuid, details: { text: text.slice(0, 500), state: conv.state } });

		// Ответ на подтверждение — без модели.
		if (conv.state === "WAITING_CONFIRMATION" && conv.context.pending) {
			if (YES.test(text.trim())) return this.executePending(conv, user);
			if (NO.test(text.trim())) return this.cancelPending(conv, user);
			// Не «да» и не «нет» — считаем новым указанием: отменяем ожидание и идём к модели.
			const p = conv.context.pending;
			await this.appendMessage(conv.id, { role: "user", toolResults: [...p.priorResults, { toolCallId: p.toolCallId, content: { cancelled: true, reason: "пользователь дал новое указание вместо подтверждения" }, isError: true }] });
			conv.context.pending = null;
		}

		await this.appendMessage(conv.id, { role: "user", text });
		await this.setState(conv.id, "UNDERSTANDING", conv.context);
		return this.runModel(conv, user);
	}

	// ── цикл с моделью ────────────────────────────────────────────────────

	private async runModel(conv: Conversation, user: { uuid: string; organizationUuid: string }): Promise<ChatReply> {
		const attachments: ChatReply["attachments"] = [];
		let usage: ChatReply["usage"];

		for (let round = 0; round < this.d.maxToolRounds; round++) {
			const history = await this.history(conv.id);
			let res;
			try {
				res = await this.d.llm.chat({ system: SYSTEM_PROMPT, messages: history, tools: toolDefinitions(), cacheable: true });
			} catch (e) {
				const err = e instanceof LLMError ? e : new LLMError("LLM_ERROR", String(e));
				this.d.log.error({ err, conversationId: conv.id }, "ошибка модели");
				await this.d.audit.write({ event: "chat.llm_error", conversationId: conv.id, userUuid: user.uuid, details: { code: err.code, message: err.message } });
				await this.setState(conv.id, "FAILED", conv.context);
				return { conversationId: conv.id, state: "FAILED", text: "Не удалось обратиться к модели. Попробуйте повторить через минуту." };
			}
			usage = res.usage ? { inputTokens: res.usage.inputTokens, outputTokens: res.usage.outputTokens, cacheRead: res.usage.cacheRead } : undefined;
			await this.appendMessage(conv.id, { role: "assistant", text: res.text, toolCalls: res.toolCalls, raw: res.raw });
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
					const question = spec.operation === "CRITICAL" ? "Подтвердите операцию." : "Создать документ?";
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
		const reply = await this.runModel(conv, user);
		if (out.attachment) reply.attachments = [...(reply.attachments ?? []), out.attachment];
		return reply;
	}

	private async cancelPending(conv: Conversation, user: { uuid: string; organizationUuid: string }): Promise<ChatReply> {
		const p = conv.context.pending!;
		await this.d.audit.write({ event: "chat.cancelled", conversationId: conv.id, userUuid: user.uuid, requestId: p.requestId, details: { tool: p.tool } });
		conv.context.pending = null;
		await this.appendMessage(conv.id, { role: "user", toolResults: [...p.priorResults, { toolCallId: p.toolCallId, content: { cancelled: true, reason: "пользователь отказался" }, isError: true }] });
		await this.setState(conv.id, "COMPLETED", conv.context);
		const what = p.tool === "create_sale" ? "Документ не создан." : "Операция не выполнена.";
		return { conversationId: conv.id, state: "COMPLETED", text: `Отменено. ${what}` };
	}

	// ── исполнение через агента ───────────────────────────────────────────

	private async execute(conv: Conversation, user: { uuid: string; organizationUuid: string }, spec: ToolSpec, payload: Record<string, unknown>, call: ToolCall, requestId: string | null): Promise<{ result: ToolResult; attachment?: { fileName: string; mimeType: string; content: string } }> {
		const agent = await this.d.agents.pickOnline(user.organizationUuid);
		if (!agent) {
			await this.d.audit.write({ event: "chat.agent_unavailable", conversationId: conv.id, userUuid: user.uuid, organizationUuid: user.organizationUuid });
			return { result: { toolCallId: call.id, content: { error: "AGENT_OFFLINE", message: "Агент 1С этой организации сейчас не на связи" }, isError: true } };
		}
		if (!agent.onec.reachable) {
			return { result: { toolCallId: call.id, content: { error: "ONEC_UNAVAILABLE", message: "База 1С недоступна для агента" }, isError: true } };
		}

		await this.setState(conv.id, "EXECUTING", conv.context);
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
			return { result: { toolCallId: call.id, content: { error: done.error?.code ?? "ERROR", message: done.error?.message ?? "", details: done.error?.details ?? null }, isError: true } };
		}

		// Успех: запоминаем id для последующих вызовов; PDF не отдаём модели — только пользователю.
		const seen = new Set(conv.context.seenIds);
		collectIds(done.result, seen);
		conv.context.seenIds = [...seen];
		conv.context.lastResult = spec.commandType === "PRINT_SALE" ? { form: (done.result as { form?: string })?.form } : done.result;
		await this.setState(conv.id, "EXECUTING", conv.context);

		if (spec.commandType === "PRINT_SALE" && done.result && typeof done.result === "object") {
			const r = done.result as { fileName?: string; mimeType?: string; content?: string; size?: number; presentation?: string };
			return {
				result: { toolCallId: call.id, content: { ok: true, form: r.presentation, fileName: r.fileName, size: r.size, note: "PDF передан пользователю как вложение" } },
				attachment: r.content ? { fileName: r.fileName ?? "document.pdf", mimeType: r.mimeType ?? "application/pdf", content: r.content } : undefined,
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
		const verb = spec.name === "post_sale" ? "Провести" : spec.name === "unpost_sale" ? "Отменить проведение" : spec.name;
		return `${verb}: документ ${nameOf(payload.documentId)}`;
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
		const msgs = r.rows.map((x) => x.content);
		for (const m of msgs) if (m.role === "user" && "toolResults" in m) for (const t of m.toolResults) this.nameCache.set(t.toolCallId, t.content);
		return msgs;
	}

	async summary(conversationId: string, user: { uuid: string; organizationUuid: string }) {
		const conv = await this.load(conversationId, user);
		if (!conv) return null;
		const r = await this.d.db.query<{ role: string; content: ChatMessage; created_at: Date }>(`SELECT role, content, created_at FROM messages WHERE conversation_id = $1 ORDER BY id`, [conversationId]);
		return {
			id: conv.id, state: conv.state,
			messages: r.rows
				.filter((m) => (m.role === "user" && "text" in m.content) || (m.role === "assistant" && m.content.role === "assistant" && m.content.text))
				.map((m) => ({ role: m.role, text: "text" in m.content ? m.content.text : "", at: m.created_at.toISOString() })),
		};
	}
}

type Conversation = { id: string; state: WorkflowState; context: Context };

export class WorkflowError extends Error {
	readonly code: string;
	constructor(code: string, message: string) {
		super(message);
		this.code = code;
	}
}
