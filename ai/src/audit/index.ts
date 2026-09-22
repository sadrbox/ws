// Аудит (§19 ТЗ). Одна функция, одна таблица. Никогда не бросает наружу: сбой записи
// аудита не должен ронять операцию — но должен попасть в лог сервиса.

import type { Db } from "../db/pool.ts";
import type { Logger } from "../logger.ts";

export type AuditEvent = {
	event: string;
	organizationUuid?: string | null;
	userUuid?: string | null;
	agentId?: string | null;
	conversationId?: string | null;
	commandId?: string | null;
	requestId?: string | null;
	details?: Record<string, unknown>;
};

export class Audit {
	private readonly db: Db;
	private readonly log: Logger;

	constructor(db: Db, log: Logger) {
		this.db = db;
		this.log = log;
	}

	async write(e: AuditEvent): Promise<void> {
		try {
			await this.db.query(
				`INSERT INTO audit_log (organization_uuid, user_uuid, agent_id, conversation_id, command_id, request_id, event, details)
				 VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
				[e.organizationUuid ?? null, e.userUuid ?? null, e.agentId ?? null, e.conversationId ?? null,
					e.commandId ?? null, e.requestId ?? null, e.event, JSON.stringify(e.details ?? {})],
			);
		} catch (err) {
			this.log.error({ err, event: e.event }, "аудит не записан");
		}
	}

	/**
	 * Журнал действий над агентом для его карточки (п. 3): кто переименовал, отключал, перевыпускал токен, менял
	 * лимиты, подключал по коду; регистрации службы и расхождения лимита. Команды сюда не входят — у них своя вкладка.
	 */
	async listForAgent(agentId: string, limit = 200): Promise<{ at: string; event: string; userUuid: string | null; details: Record<string, unknown> }[]> {
		const r = await this.db.query<{ at: Date; event: string; user_uuid: string | null; details: Record<string, unknown> }>(
			`SELECT at, event, user_uuid, details FROM audit_log
			  WHERE agent_id = $1 AND (event LIKE 'agent.%' OR event = 'command.limit_bypass')
			  ORDER BY at DESC LIMIT $2`,
			[agentId, Math.min(Math.max(limit, 1), 500)],
		);
		return r.rows.map((x) => ({ at: x.at.toISOString(), event: x.event, userUuid: x.user_uuid, details: x.details ?? {} }));
	}

	/**
	 * ЖУРНАЛ ВЫЗОВОВ ЧАТА (ПН8): какие инструменты вызывались из чата в 1С, по какой базе и чем кончилось.
	 *
	 * ЗАЧЕМ ОН НУЖЕН ОТДЕЛЬНО. События чата видны были только в логе службы, а события агента — в панели;
	 * разбор жалобы «попросил список реализаций, а ничего не пришло» упирался в то, что половина следа лежит
	 * в другом месте. Здесь — весь след одного канала: вызов, база, исход.
	 *
	 * Берём событий БОЛЬШЕ, чем строк: одно событие несёт несколько вызовов, а результаты приходят своим
	 * событием — без запаса свежие вызовы остались бы без исхода.
	 */
	async listChatCalls(opts: { baseId?: string | null; limit?: number } = {}): Promise<ChatCallRow[]> {
		const limit = Math.min(Math.max(opts.limit ?? 200, 1), 500);
		const r = await this.db.query<{ at: Date; event: string; conversation_id: string | null; organization_uuid: string | null; user_uuid: string | null; details: Record<string, unknown> }>(
			`SELECT at, event, conversation_id, organization_uuid, user_uuid, details FROM audit_log
			  WHERE event IN ('chat.tool_calls', 'chat.tool_results', 'chat.server_tool', 'chat.tool_rejected')
			    AND details->>'channel' = '1c'
			    AND ($1::text IS NULL OR details->>'baseId' = $1::text)
			  ORDER BY at DESC LIMIT $2`,
			[opts.baseId ?? null, limit * 3],
		);
		const events = r.rows.map((x) => ({
			at: x.at.toISOString(), event: x.event, conversationId: x.conversation_id,
			organizationUuid: x.organization_uuid, userUuid: x.user_uuid, details: x.details ?? {},
		}));
		return chatCallRows(events).slice(0, limit);
	}

	/**
	 * ОТКАЗЫ СЕРВЕРНЫХ ИНСТРУМЕНТОВ ЧАТА 1С (СВ8): задачи и заметки, которые ERP не приняла.
	 *
	 * ЗАЧЕМ ОТДЕЛЬНЫМ ЗАПРОСОМ. Эти события не привязаны ни к агенту, ни к базе — их порождает чат,
	 * и в журнале агента их нет. Видны они были только в логе службы, куда администратор панели не
	 * ходит; «у меня задача не создалась» разбиралось расспросами.
	 *
	 * Только неудачи: успешных вызовов сотни, и они ничего не объясняют.
	 */
	async listChatFailures(opts: { baseId?: string | null; limit?: number } = {}): Promise<{ at: string; tool: string; code: string; message: string | null; organizationUuid: string | null; details: Record<string, unknown> }[]> {
		const r = await this.db.query<{ at: Date; organization_uuid: string | null; details: Record<string, unknown> }>(
			`SELECT at, organization_uuid, details FROM audit_log
			  WHERE event = 'chat.server_tool' AND details->>'ok' = 'false'
			    AND ($1::text IS NULL OR details->>'baseId' = $1::text)
			  ORDER BY at DESC LIMIT $2`,
			[opts.baseId ?? null, Math.min(Math.max(opts.limit ?? 200, 1), 500)],
		);
		return r.rows.map((x) => {
			const d = x.details ?? {};
			return {
				at: x.at.toISOString(),
				tool: typeof d.tool === "string" ? d.tool : "",
				code: typeof d.code === "string" ? d.code : "ERROR",
				message: typeof d.message === "string" ? d.message : null,
				organizationUuid: x.organization_uuid,
				details: d,
			};
		});
	}
}

/** Строка журнала вызовов чата: один вызов инструмента с исходом, каким его увидел сервис. */
export type ChatCallRow = {
	at: string;
	conversationId: string | null;
	/** Куда шёл вызов: `1c` — в базу через форму, `erp` — в BuhProf (задачи и заметки). */
	target: "1c" | "erp";
	tool: string;
	commandType: string;
	callId: string | null;
	/** sent — ушёл в 1С и ответа ещё нет; ok — выполнен; failed — отказ; rejected — сервис не выпустил вызов. */
	state: "sent" | "ok" | "failed" | "rejected";
	code: string | null;
	message: string | null;
	baseId: string | null;
	organizationUuid: string | null;
	userUuid: string | null;
};

type RawEvent = {
	at: string; event: string; conversationId: string | null; organizationUuid: string | null; userUuid: string | null;
	details: Record<string, unknown>;
};

/**
 * СКЛЕЙКА ВЫЗОВА С ЕГО ИСХОДОМ (ПН8). В журнале это ДВА события: «вызовы ушли форме» и «форма принесла
 * результаты» — между ними минуты и, бывает, ничего. Разбор жалобы начинается с вопроса «чем кончилось»,
 * поэтому склеиваем здесь, по callId в пределах диалога, а не оставляем это глазам читающего.
 *
 * Вызов без результата — не ошибка журнала: ход мог идти в эту секунду или оборваться на стороне 1С.
 * Такой остаётся `sent`, и это видно — отличить «не ответили» от «ответили отказом» важнее всего.
 */
export function chatCallRows(events: readonly RawEvent[]): ChatCallRow[] {
	const outcome = new Map<string, { success: boolean; code: string | null }>();
	for (const e of events) {
		if (e.event !== "chat.tool_results") continue;
		const results = Array.isArray(e.details.results) ? e.details.results : [];
		for (const r of results as Record<string, unknown>[]) {
			const callId = typeof r.callId === "string" ? r.callId : null;
			if (!callId) continue;
			outcome.set(`${e.conversationId ?? ""}:${callId}`, { success: r.success !== false, code: typeof r.code === "string" ? r.code : null });
		}
	}
	const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
	const rows: ChatCallRow[] = [];
	for (const e of events) {
		const base = { at: e.at, conversationId: e.conversationId, baseId: str(e.details.baseId), organizationUuid: e.organizationUuid, userUuid: e.userUuid };
		if (e.event === "chat.tool_calls") {
			const calls = Array.isArray(e.details.calls) ? e.details.calls : [];
			for (const c of calls as Record<string, unknown>[]) {
				const callId = str(c.callId);
				const res = callId ? outcome.get(`${e.conversationId ?? ""}:${callId}`) : undefined;
				rows.push({
					...base, target: "1c", tool: str(c.tool) ?? "", commandType: str(c.type) ?? "", callId,
					state: !res ? "sent" : res.success ? "ok" : "failed",
					code: res?.code ?? null, message: null,
				});
			}
			continue;
		}
		if (e.event === "chat.server_tool") {
			const ok = e.details.ok !== false;
			rows.push({
				...base, target: "erp", tool: str(e.details.tool) ?? "", commandType: str(e.details.type) ?? "", callId: null,
				state: ok ? "ok" : "failed", code: ok ? null : str(e.details.code) ?? "ERROR", message: str(e.details.message),
			});
			continue;
		}
		if (e.event === "chat.tool_rejected") {
			rows.push({
				...base, target: "1c", tool: str(e.details.tool) ?? "", commandType: "", callId: null,
				state: "rejected", code: "VALIDATION_ERROR", message: str(e.details.reason),
			});
		}
	}
	return rows;
}
