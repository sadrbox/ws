// Токены баз для канала «чат внутри 1С» (СВ1).
//
// Токен выдаётся базе, а не пользователю: пользователей ИБ сервис не знает и не заводит, их UUID приходит
// в каждом запросе заголовком X-1C-User-Id. Права пользователя на организацию и операции проверяет сама 1С —
// сервису токен говорит только «это наша база, и она принадлежит такой-то организации ERP».
//
// В базе сервиса — только SHA-256 токена. Отзыв не удаляет строку: кто выпускал и отзывал — это история.

import { randomBytes, randomUUID } from "node:crypto";
import type { Db } from "../db/pool.ts";
import { sha256 } from "../auth/index.ts";

/** Кто стоит за токеном: база, её организация ERP и состояние. */
export type BaseTokenOwner = {
	tokenId: string;
	baseId: string;
	baseKey: string;
	baseName: string;
	organizationUuid: string;
	revoked: boolean;
	baseDisabled: boolean;
};

export type BaseTokenRow = { id: string; baseId: string; baseKey: string; organizationUuid: string; createdAt: Date; createdBy: string; revokedAt: Date | null; revokedBy: string | null };

/** Токен базы: префикс отличает его от токена агента (bpa_) в журналах и настройках. Только ASCII. */
export function newBaseToken(): string {
	return "bpb_" + randomBytes(32).toString("base64url");
}

export class BaseTokenStore {
	private readonly db: Db;
	constructor(db: Db) {
		this.db = db;
	}

	/**
	 * Выпустить токен базе. Организация ERP по умолчанию — организация сервера базы. Возвращает токен в
	 * открытом виде — единственный раз; в журнал его не писать.
	 */
	async issue(input: { baseId: string; organizationUuid?: string | null; createdBy: string }): Promise<{ id: string; token: string; organizationUuid: string }> {
		const b = await this.db.query<{ organization_uuid: string }>(
			`SELECT s.organization_uuid FROM bases b JOIN servers s ON s.id = b.server_id WHERE b.id = $1`, [input.baseId]);
		if (!b.rows[0]) throw new Error("база не найдена");
		const organizationUuid = input.organizationUuid || b.rows[0].organization_uuid;
		const id = randomUUID();
		const token = newBaseToken();
		await this.db.query(
			`INSERT INTO base_tokens (id, base_id, organization_uuid, token_hash, created_by) VALUES ($1, $2, $3, $4, $5)`,
			[id, input.baseId, organizationUuid, sha256(token), input.createdBy]);
		return { id, token, organizationUuid };
	}

	/** Отозвать токен. false — такого нет или уже отозван. */
	async revoke(id: string, revokedBy: string): Promise<boolean> {
		const r = await this.db.query(`UPDATE base_tokens SET revoked_at = now(), revoked_by = $2 WHERE id = $1 AND revoked_at IS NULL`, [id, revokedBy]);
		return (r.rowCount ?? 0) > 0;
	}

	async list(baseId?: string | null): Promise<BaseTokenRow[]> {
		const r = await this.db.query<{ id: string; base_id: string; key: string; organization_uuid: string; created_at: Date; created_by: string; revoked_at: Date | null; revoked_by: string | null }>(
			`SELECT t.id, t.base_id, b.key, t.organization_uuid, t.created_at, t.created_by, t.revoked_at, t.revoked_by
			   FROM base_tokens t JOIN bases b ON b.id = t.base_id
			  WHERE ($1::uuid IS NULL OR t.base_id = $1::uuid)
			  ORDER BY t.created_at DESC`, [baseId ?? null]);
		return r.rows.map((x) => ({ id: x.id, baseId: x.base_id, baseKey: x.key, organizationUuid: x.organization_uuid, createdAt: x.created_at, createdBy: x.created_by, revokedAt: x.revoked_at, revokedBy: x.revoked_by }));
	}

	/** Владелец токена по его значению; null — такого токена нет. */
	async resolve(token: string): Promise<BaseTokenOwner | null> {
		const r = await this.db.query<{ id: string; base_id: string; key: string; name: string; organization_uuid: string; revoked_at: Date | null; disabled_at: Date | null }>(
			`SELECT t.id, t.base_id, b.key, b.name, t.organization_uuid, t.revoked_at, b.disabled_at
			   FROM base_tokens t JOIN bases b ON b.id = t.base_id
			  WHERE t.token_hash = $1`, [sha256(token)]);
		const x = r.rows[0];
		if (!x) return null;
		return { tokenId: x.id, baseId: x.base_id, baseKey: x.key, baseName: x.name || x.key, organizationUuid: x.organization_uuid, revoked: !!x.revoked_at, baseDisabled: !!x.disabled_at };
	}
}
