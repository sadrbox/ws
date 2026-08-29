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
}
