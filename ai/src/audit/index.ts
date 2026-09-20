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
}
