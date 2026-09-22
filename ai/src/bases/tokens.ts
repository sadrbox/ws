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
import { deriveKey, seal, unseal } from "../onec/credentials.ts";

/** Кто стоит за токеном: база, её организация ERP и состояние. */
export type BaseTokenOwner = {
	tokenId: string;
	baseId: string;
	baseKey: string;
	baseName: string;
	organizationUuid: string;
	revoked: boolean;
	baseDisabled: boolean;
	/** Пора сменить (§3): срок вышел, преемника ещё нет. */
	rotateDue: boolean;
	/** Преемник уже выпущен, но база им ни разу не воспользовалась — ответ с ним не дошёл. */
	pending: boolean;
	/** Прежний токен принимается до этого мига (перекрытие); null — токен не сменялся. */
	acceptedUntil: Date | null;
	/** Этим токеном ещё не пользовались: первый успешный запрос подтверждает доставку. */
	firstUse: boolean;
};

export type BaseTokenRow = { id: string; baseId: string; baseKey: string; organizationUuid: string; createdAt: Date; createdBy: string; revokedAt: Date | null; revokedBy: string | null; rotateAfter: Date | null; acceptedUntil: Date | null; replacedBy: string | null };

/** Токен базы: префикс отличает его от токена агента (bpa_) в журналах и настройках. Только ASCII. */
export function newBaseToken(): string {
	return "bpb_" + randomBytes(32).toString("base64url");
}

export class BaseTokenStore {
	private readonly db: Db;
	/** Ключ для преемника, ждущего доставки (§3). Своя соль: назначение другое, чем у паролей баз. */
	private readonly key: Buffer;
	/** Через сколько дней токену пора смениться. 0 — смена только по кнопке в панели. */
	private readonly rotateDays: number;
	/** Сколько прежний токен принимается после смены. */
	private readonly overlapHours: number;

	constructor(db: Db, secret = "", opts: { rotateDays?: number; overlapHours?: number } = {}) {
		this.db = db;
		this.key = deriveKey(secret, "onec-base-token-rotation");
		this.rotateDays = opts.rotateDays ?? 0;
		this.overlapHours = opts.overlapHours ?? 24;
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
			`INSERT INTO base_tokens (id, base_id, organization_uuid, token_hash, created_by, rotate_after)
			 VALUES ($1, $2, $3, $4, $5, CASE WHEN $6::int > 0 THEN now() + ($6 || ' days')::interval END)`,
			[id, input.baseId, organizationUuid, sha256(token), input.createdBy, this.rotateDays]);
		return { id, token, organizationUuid };
	}

	/** Отозвать токен. false — такого нет или уже отозван. */
	async revoke(id: string, revokedBy: string): Promise<boolean> {
		const r = await this.db.query(`UPDATE base_tokens SET revoked_at = now(), revoked_by = $2 WHERE id = $1 AND revoked_at IS NULL`, [id, revokedBy]);
		return (r.rowCount ?? 0) > 0;
	}

	async list(baseId?: string | null): Promise<BaseTokenRow[]> {
		const r = await this.db.query<{ id: string; base_id: string; key: string; organization_uuid: string; created_at: Date; created_by: string; revoked_at: Date | null; revoked_by: string | null; rotate_after: Date | null; accepted_until: Date | null; replaced_by: string | null }>(
			`SELECT t.id, t.base_id, b.key, t.organization_uuid, t.created_at, t.created_by, t.revoked_at, t.revoked_by,
			        t.rotate_after, t.accepted_until, t.replaced_by
			   FROM base_tokens t JOIN bases b ON b.id = t.base_id
			  WHERE ($1::uuid IS NULL OR t.base_id = $1::uuid)
			  ORDER BY t.created_at DESC`, [baseId ?? null]);
		return r.rows.map((x) => ({ id: x.id, baseId: x.base_id, baseKey: x.key, organizationUuid: x.organization_uuid, createdAt: x.created_at, createdBy: x.created_by, revokedAt: x.revoked_at, revokedBy: x.revoked_by, rotateAfter: x.rotate_after, acceptedUntil: x.accepted_until, replacedBy: x.replaced_by }));
	}

	/**
	 * Владелец токена по его значению; null — такого токена нет.
	 *
	 * ПЕРЕКРЫТИЕ (§3). Сменённый токен остаётся годным до `accepted_until`: расширение сохраняет новый
	 * не мгновенно, а запрос, ушедший в этот миг, не должен получить отказ. По истечении перекрытия
	 * токен считается отозванным — как и revoked_at, это `revoked: true`, и обработчик один.
	 */
	async resolve(token: string): Promise<BaseTokenOwner | null> {
		const r = await this.db.query<{ id: string; base_id: string; key: string; name: string; organization_uuid: string; revoked_at: Date | null; disabled_at: Date | null; rotate_after: Date | null; replaced_by: string | null; accepted_until: Date | null; pending_secret: string | null; first_used_at: Date | null }>(
			`SELECT t.id, t.base_id, b.key, b.name, t.organization_uuid, t.revoked_at, b.disabled_at,
			        t.rotate_after, t.replaced_by, t.accepted_until, t.pending_secret, t.first_used_at
			   FROM base_tokens t JOIN bases b ON b.id = t.base_id
			  WHERE t.token_hash = $1`, [sha256(token)]);
		const x = r.rows[0];
		if (!x) return null;
		const overdue = !!x.accepted_until && x.accepted_until.getTime() <= Date.now();
		return {
			tokenId: x.id, baseId: x.base_id, baseKey: x.key, baseName: x.name || x.key, organizationUuid: x.organization_uuid,
			revoked: !!x.revoked_at || overdue, baseDisabled: !!x.disabled_at,
			rotateDue: !x.replaced_by && !!x.rotate_after && x.rotate_after.getTime() <= Date.now(),
			pending: !!x.replaced_by && !!x.pending_secret,
			acceptedUntil: x.accepted_until,
			firstUse: !x.first_used_at,
		};
	}

	/**
	 * Отметить, что токеном ВОСПОЛЬЗОВАЛИСЬ, и тем закрыть перекрытие.
	 *
	 * Первый успешный запрос новым токеном — единственное надёжное подтверждение того, что он дошёл и
	 * сохранён. С этого мига прежний больше не нужен: перекрытие закрывается, а закрытая копия
	 * преемника стирается — держать её дольше незачем.
	 */
	async markUsed(tokenId: string): Promise<void> {
		await this.db.query(`UPDATE base_tokens SET first_used_at = now() WHERE id = $1 AND first_used_at IS NULL`, [tokenId]);
		await this.db.query(
			`UPDATE base_tokens SET accepted_until = now(), pending_secret = NULL
			  WHERE replaced_by = $1 AND (accepted_until IS NULL OR accepted_until > now())`, [tokenId]);
	}

	/**
	 * Сменить токен базы: выпустить преемника и оставить прежний годным на время перекрытия.
	 *
	 * Возвращает новый токен в открытом виде — его нужно отдать базе в том же ответе. Копия остаётся
	 * закрытой в `pending_secret`, чтобы отдать ТОТ ЖЕ токен ещё раз, если ответ не дошёл: выпускать
	 * на каждый неудавшийся ответ по новому токену значило бы плодить годные ключи.
	 */
	async rotate(tokenId: string, createdBy: string): Promise<string | null> {
		const cur = await this.db.query<{ base_id: string; organization_uuid: string }>(
			`SELECT base_id, organization_uuid FROM base_tokens WHERE id = $1 AND revoked_at IS NULL AND replaced_by IS NULL`, [tokenId]);
		const row = cur.rows[0];
		if (!row) return null;
		const id = randomUUID();
		const token = newBaseToken();
		await this.db.query(
			`INSERT INTO base_tokens (id, base_id, organization_uuid, token_hash, created_by, rotate_after)
			 VALUES ($1, $2, $3, $4, $5, CASE WHEN $6::int > 0 THEN now() + ($6 || ' days')::interval END)`,
			[id, row.base_id, row.organization_uuid, sha256(token), createdBy, this.rotateDays]);
		await this.db.query(
			`UPDATE base_tokens SET replaced_by = $2, accepted_until = now() + ($3 || ' hours')::interval, pending_secret = $4
			  WHERE id = $1`, [tokenId, id, this.overlapHours, seal(token, this.key)]);
		return token;
	}

	/**
	 * Отдать преемника ещё раз и продлить перекрытие.
	 *
	 * ПОЧЕМУ ПРОДЛЕВАЕМ. База, не сохранившая новый токен (ответ оборвался, расширение старое),
	 * по истечении перекрытия осталась бы без связи вовсе — а это хуже несменённого токена.
	 * Пока преемник не подтверждён, прежний живёт; в журнале это видно, и «Сменить токен» в панели
	 * остаётся способом оборвать связь намеренно.
	 */
	async redeliver(tokenId: string): Promise<string | null> {
		const r = await this.db.query<{ pending_secret: string | null }>(
			`UPDATE base_tokens SET accepted_until = GREATEST(accepted_until, now() + ($2 || ' hours')::interval)
			  WHERE id = $1 AND pending_secret IS NOT NULL RETURNING pending_secret`, [tokenId, this.overlapHours]);
		const sealed = r.rows[0]?.pending_secret;
		return sealed ? unseal(sealed, this.key) : null;
	}
}
