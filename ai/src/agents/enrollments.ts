// Заявки на подключение агента по коду (СВ5, docs/CONTRACT_AGENT_ENROLLMENT_2026-09-19.md).
//
// Путь: агент шлёт заявку без токена → получает код и секрет опроса → администратор BuhProf одобряет её в панели
// (организация ERP) → при первом опросе после одобрения агент получает идентификатор и токен. Токен выпускается в
// момент выдачи (rotate-token) и выдаётся ОДИН раз; секрет опроса хранится только хэшем.

import { randomUUID } from "node:crypto";
import type { Db } from "../db/pool.ts";
import { sha256 } from "../auth/index.ts";
import { newPollSecret, newRegistrationCode, normalizeCode } from "../bases/registrations.ts";

export type EnrollmentState = "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED";

export type EnrollmentInput = {
	name: string; role: "business" | "admin"; serverName?: string | null; serviceName: string; computer: string; version?: string | null;
};

export type EnrollmentRow = {
	id: string; code: string; computer: string; serviceName: string; name: string; role: "business" | "admin";
	serverName: string | null; version: string | null; ip: string | null; repeats: number; state: EnrollmentState;
	note: string | null; decidedBy: string | null; decidedAt: Date | null; organizationUuid: string | null;
	agentId: string | null; tokenDeliveredAt: Date | null; createdAt: Date; updatedAt: Date; expiresAt: Date;
};

type Raw = {
	id: string; code: string; computer: string; service_name: string; name: string; role: "business" | "admin";
	server_name: string | null; version: string | null; ip: string | null; repeats: number; state: EnrollmentState;
	note: string | null; decided_by: string | null; decided_at: Date | null; organization_uuid: string | null;
	agent_id: string | null; token_delivered_at: Date | null; created_at: Date; updated_at: Date; expires_at: Date;
};

const COLS = `id, code, computer, service_name, name, role, server_name, version, ip, repeats, state, note, decided_by,
	decided_at, organization_uuid, agent_id, token_delivered_at, created_at, updated_at, expires_at`;

const toRow = (r: Raw): EnrollmentRow => ({
	id: r.id, code: r.code, computer: r.computer, serviceName: r.service_name, name: r.name, role: r.role,
	serverName: r.server_name, version: r.version, ip: r.ip, repeats: r.repeats, state: r.state, note: r.note,
	decidedBy: r.decided_by, decidedAt: r.decided_at, organizationUuid: r.organization_uuid, agentId: r.agent_id,
	tokenDeliveredAt: r.token_delivered_at, createdAt: r.created_at, updatedAt: r.updated_at, expiresAt: r.expires_at,
});

/** Заявку агента одобряют при установке, пока человек у компьютера: суток хватает с запасом. */
export const ENROLLMENT_TTL_HOURS = 24;

const isUniqueViolation = (e: unknown): boolean => (e as { code?: string } | null)?.code === "23505";

export class EnrollmentStore {
	private readonly db: Db;
	constructor(db: Db) {
		this.db = db;
	}

	async expire(): Promise<void> {
		await this.db.query(`UPDATE agent_enrollments SET state = 'EXPIRED', updated_at = now() WHERE state = 'PENDING' AND expires_at < now()`);
	}

	/**
	 * Новая заявка или повтор нерешённой с того же компьютера и службы — та же заявка и тот же код. Секрет опроса
	 * выдаётся новый, прежний перестаёт действовать (как у заявки базы: два действующих секрета — два получателя).
	 */
	async submit(input: EnrollmentInput, ip: string | null): Promise<{ row: EnrollmentRow; secret: string; repeated: boolean }> {
		await this.expire();
		const secret = newPollSecret();
		const again = await this.db.query<Raw>(
			`UPDATE agent_enrollments
			    SET secret_hash = $3, name = $4, role = $5, server_name = $6, version = $7, ip = $8, repeats = repeats + 1, updated_at = now()
			  WHERE lower(computer) = lower($1) AND lower(service_name) = lower($2) AND state = 'PENDING'
			  RETURNING ${COLS}`,
			[input.computer, input.serviceName, sha256(secret), input.name, input.role, input.serverName ?? null, input.version ?? null, ip],
		);
		if (again.rows[0]) return { row: toRow(again.rows[0]), secret, repeated: true };
		for (let attempt = 0; attempt < 8; attempt++) {
			try {
				const r = await this.db.query<Raw>(
					`INSERT INTO agent_enrollments (id, code, secret_hash, computer, service_name, name, role, server_name, version, ip, expires_at)
					 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now() + make_interval(hours => $11::int))
					 RETURNING ${COLS}`,
					[randomUUID(), newRegistrationCode(), sha256(secret), input.computer, input.serviceName, input.name, input.role,
						input.serverName ?? null, input.version ?? null, ip, ENROLLMENT_TTL_HOURS],
				);
				return { row: toRow(r.rows[0]), secret, repeated: false };
			} catch (e) {
				if (!isUniqueViolation(e)) throw e;
				const raced = await this.db.query<Raw>(
					`UPDATE agent_enrollments SET secret_hash = $3, repeats = repeats + 1, updated_at = now()
					  WHERE lower(computer) = lower($1) AND lower(service_name) = lower($2) AND state = 'PENDING' RETURNING ${COLS}`,
					[input.computer, input.serviceName, sha256(secret)],
				);
				if (raced.rows[0]) return { row: toRow(raced.rows[0]), secret, repeated: true };
			}
		}
		throw new Error("не удалось подобрать свободный код заявки");
	}

	async bySecret(id: string, secret: string): Promise<EnrollmentRow | null> {
		await this.expire();
		const r = await this.db.query<Raw>(`SELECT ${COLS} FROM agent_enrollments WHERE id = $1 AND secret_hash = $2`, [id, sha256(secret)]);
		return r.rows[0] ? toRow(r.rows[0]) : null;
	}

	async get(id: string): Promise<EnrollmentRow | null> {
		const r = await this.db.query<Raw>(`SELECT ${COLS} FROM agent_enrollments WHERE id = $1`, [id]);
		return r.rows[0] ? toRow(r.rows[0]) : null;
	}

	async list(opts: { state?: EnrollmentState | null; q?: string | null } = {}): Promise<EnrollmentRow[]> {
		await this.expire();
		const q = (opts.q ?? "").trim();
		const r = await this.db.query<Raw>(
			`SELECT ${COLS} FROM agent_enrollments
			  WHERE ($1::text IS NULL OR state = $1)
			    AND ($2::text = '' OR replace(code, '-', '') = $3 OR name ILIKE '%' || $2 || '%' OR computer ILIKE '%' || $2 || '%'
			         OR coalesce(server_name, '') ILIKE '%' || $2 || '%')
			  ORDER BY (state = 'PENDING') DESC, created_at DESC LIMIT 300`,
			[opts.state ?? null, q, normalizeCode(q)],
		);
		return r.rows.map(toRow);
	}

	/**
	 * Агент прежней одобренной заявки того же компьютера и службы — повторное подключение той же службы (переустановка,
	 * потерянный токен) получает того же агента с новым токеном, а не второго агента с той же очередью.
	 */
	async previousAgent(computer: string, serviceName: string, exceptId: string): Promise<string | null> {
		const r = await this.db.query<{ agent_id: string }>(
			`SELECT agent_id FROM agent_enrollments
			  WHERE lower(computer) = lower($1) AND lower(service_name) = lower($2) AND id <> $3 AND agent_id IS NOT NULL
			  ORDER BY decided_at DESC NULLS LAST LIMIT 1`,
			[computer, serviceName, exceptId],
		);
		return r.rows[0]?.agent_id ?? null;
	}

	async approve(id: string, d: { organizationUuid: string; agentId: string; decidedBy: string; note?: string | null }): Promise<boolean> {
		await this.expire();
		const r = await this.db.query(
			`UPDATE agent_enrollments SET state = 'APPROVED', organization_uuid = $2, agent_id = $3, decided_by = $4, note = $5,
			        decided_at = now(), updated_at = now()
			  WHERE id = $1 AND state = 'PENDING'`,
			[id, d.organizationUuid, d.agentId, d.decidedBy, d.note ?? null],
		);
		return (r.rowCount ?? 0) > 0;
	}

	async reject(id: string, d: { decidedBy: string; note: string }): Promise<boolean> {
		await this.expire();
		const r = await this.db.query(
			`UPDATE agent_enrollments SET state = 'REJECTED', decided_by = $2, note = $3, decided_at = now(), updated_at = now()
			  WHERE id = $1 AND state = 'PENDING'`,
			[id, d.decidedBy, d.note],
		);
		return (r.rowCount ?? 0) > 0;
	}

	/** Ровно один опрос после одобрения получает право выпустить токен. */
	async claimDelivery(id: string): Promise<boolean> {
		const r = await this.db.query(
			`UPDATE agent_enrollments SET token_delivered_at = now(), updated_at = now()
			  WHERE id = $1 AND state = 'APPROVED' AND token_delivered_at IS NULL AND agent_id IS NOT NULL`,
			[id],
		);
		return (r.rowCount ?? 0) > 0;
	}

	async releaseDelivery(id: string): Promise<void> {
		await this.db.query(`UPDATE agent_enrollments SET token_delivered_at = NULL WHERE id = $1`, [id]);
	}
}
