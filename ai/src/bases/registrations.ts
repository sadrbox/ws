// Заявки на подключение базы 1С (СВ4, docs/CONTRACT_BASE_REGISTRATION_2026-09-19.md, часть 1).
//
// Путь заявки: 1С шлёт её без токена → получает код и секрет опроса → администратор BuhProf одобряет её в панели
// (организация ERP, ключ базы в реестре) → при первом опросе после одобрения 1С получает токен базы. Токен
// выпускается в момент выдачи и выдаётся ОДИН раз; секрет опроса и токен хранятся только хэшем.

import { randomBytes, randomInt, randomUUID } from "node:crypto";
import type { Db } from "../db/pool.ts";
import { sha256 } from "../auth/index.ts";

export type RegistrationState = "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED";

/** Заявка, как её прислала 1С (разобрана схемой роутера). */
export type RegistrationBody = {
	base: {
		id: string; name: string; kind?: string; server?: string | null;
		configuration?: { name?: string; synonym?: string; version?: string } | null;
		platform?: string | null; extensionVersion?: string | null; computer?: string | null;
	};
	organizations: { id?: string | null; name?: string | null; bin?: string | null }[];
	user?: { id?: string | null; name?: string | null } | null;
	contact?: string | null;
	comment?: string | null;
};

export type RegistrationRow = {
	id: string; code: string; onecBaseId: string; baseName: string; body: RegistrationBody; ip: string | null;
	repeats: number; state: RegistrationState; note: string | null; decidedBy: string | null; decidedAt: Date | null;
	organizationUuid: string | null; baseId: string | null; baseKey: string | null; tokenId: string | null;
	tokenDeliveredAt: Date | null; createdAt: Date; updatedAt: Date; expiresAt: Date;
};

type Raw = {
	id: string; code: string; onec_base_id: string; base_name: string; body: RegistrationBody; ip: string | null;
	repeats: number; state: RegistrationState; note: string | null; decided_by: string | null; decided_at: Date | null;
	organization_uuid: string | null; base_id: string | null; base_key: string | null; token_id: string | null;
	token_delivered_at: Date | null; created_at: Date; updated_at: Date; expires_at: Date;
};

const COLS = `id, code, onec_base_id, base_name, body, ip, repeats, state, note, decided_by, decided_at, organization_uuid,
	base_id, base_key, token_id, token_delivered_at, created_at, updated_at, expires_at`;

const toRow = (r: Raw): RegistrationRow => ({
	id: r.id, code: r.code, onecBaseId: r.onec_base_id, baseName: r.base_name, body: r.body, ip: r.ip,
	repeats: r.repeats, state: r.state, note: r.note, decidedBy: r.decided_by, decidedAt: r.decided_at,
	organizationUuid: r.organization_uuid, baseId: r.base_id, baseKey: r.base_key, tokenId: r.token_id,
	tokenDeliveredAt: r.token_delivered_at, createdAt: r.created_at, updatedAt: r.updated_at, expiresAt: r.expires_at,
});

/** Заявка живёт неделю: дольше код, названный по телефону, никто не помнит. */
export const REGISTRATION_TTL_DAYS = 7;

/** Без похожих знаков (0/O, 1/I/L): код диктуют голосом и набирают в поиске. */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function newRegistrationCode(): string {
	const pick = () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
	return `${pick()}${pick()}${pick()}-${pick()}${pick()}${pick()}`;
}

/** Секрет опроса: только ASCII (заголовок), 32 байта. */
export const newPollSecret = (): string => randomBytes(32).toString("base64url");

/** Поиск по коду без учёта раскладки ввода: «k7m42q» и «K7M-42Q» — одна заявка. */
export const normalizeCode = (q: string): string => q.toUpperCase().replace(/[^A-Z0-9]/g, "");

const isUniqueViolation = (e: unknown): boolean => (e as { code?: string } | null)?.code === "23505";

export class RegistrationStore {
	private readonly db: Db;
	constructor(db: Db) {
		this.db = db;
	}

	/** Просроченные нерешённые — в EXPIRED: иначе уникальный индекс не дал бы базе подать новую заявку. */
	async expire(): Promise<void> {
		await this.db.query(`UPDATE base_registrations SET state = 'EXPIRED', updated_at = now() WHERE state = 'PENDING' AND expires_at < now()`);
	}

	/**
	 * Новая заявка или повтор нерешённой. Повтор той же базы (`base.id`) — ТА ЖЕ заявка и тот же код; секрет
	 * опроса выдаётся новый, прежний перестаёт действовать: 1С хранит последний, а два действующих секрета — два
	 * получателя одного токена. Число повторов и последний адрес видны в панели.
	 */
	async submit(body: RegistrationBody, ip: string | null): Promise<{ row: RegistrationRow; secret: string; repeated: boolean }> {
		await this.expire();
		const secret = newPollSecret();
		const again = await this.db.query<Raw>(
			`UPDATE base_registrations
			    SET secret_hash = $2, body = $3, base_name = $4, ip = $5, repeats = repeats + 1, updated_at = now()
			  WHERE onec_base_id = $1 AND state = 'PENDING'
			  RETURNING ${COLS}`,
			[body.base.id, sha256(secret), JSON.stringify(body), body.base.name, ip],
		);
		if (again.rows[0]) return { row: toRow(again.rows[0]), secret, repeated: true };

		// Код может совпасть с чужим нерешённым — тогда новый; база могла прислать повтор параллельно — тогда он.
		for (let attempt = 0; attempt < 8; attempt++) {
			try {
				const r = await this.db.query<Raw>(
					`INSERT INTO base_registrations (id, code, secret_hash, onec_base_id, base_name, body, ip, expires_at)
					 VALUES ($1, $2, $3, $4, $5, $6, $7, now() + make_interval(days => $8))
					 RETURNING ${COLS}`,
					[randomUUID(), newRegistrationCode(), sha256(secret), body.base.id, body.base.name, JSON.stringify(body), ip, REGISTRATION_TTL_DAYS],
				);
				return { row: toRow(r.rows[0]), secret, repeated: false };
			} catch (e) {
				if (!isUniqueViolation(e)) throw e;
				const raced = await this.db.query<Raw>(
					`UPDATE base_registrations SET secret_hash = $2, repeats = repeats + 1, updated_at = now()
					  WHERE onec_base_id = $1 AND state = 'PENDING' RETURNING ${COLS}`,
					[body.base.id, sha256(secret)],
				);
				if (raced.rows[0]) return { row: toRow(raced.rows[0]), secret, repeated: true };
			}
		}
		throw new Error("не удалось подобрать свободный код заявки");
	}

	/** Заявка по id и секрету опроса; неверный секрет — null (как «нет такой»). */
	async bySecret(id: string, secret: string): Promise<RegistrationRow | null> {
		await this.expire();
		const r = await this.db.query<Raw>(`SELECT ${COLS} FROM base_registrations WHERE id = $1 AND secret_hash = $2`, [id, sha256(secret)]);
		return r.rows[0] ? toRow(r.rows[0]) : null;
	}

	async get(id: string): Promise<RegistrationRow | null> {
		const r = await this.db.query<Raw>(`SELECT ${COLS} FROM base_registrations WHERE id = $1`, [id]);
		return r.rows[0] ? toRow(r.rows[0]) : null;
	}

	/** Список для панели: нерешённые — первыми, дальше свежие. Поиск — по коду, имени базы, БИН, контакту. */
	async list(opts: { state?: RegistrationState | null; q?: string | null; limit?: number } = {}): Promise<RegistrationRow[]> {
		await this.expire();
		const q = (opts.q ?? "").trim();
		const code = normalizeCode(q);
		const r = await this.db.query<Raw>(
			`SELECT ${COLS} FROM base_registrations
			  WHERE ($1::text IS NULL OR state = $1)
			    AND ($2::text = '' OR replace(code, '-', '') = $3 OR base_name ILIKE '%' || $2 || '%'
			         OR body::text ILIKE '%' || $2 || '%')
			  ORDER BY (state = 'PENDING') DESC, created_at DESC
			  LIMIT $4`,
			[opts.state ?? null, q, code, Math.min(Math.max(opts.limit ?? 200, 1), 500)],
		);
		return r.rows.map(toRow);
	}

	/** Одобрить нерешённую. false — заявки нет, она уже решена или просрочена. */
	async approve(id: string, d: { organizationUuid: string; baseId: string; baseKey: string; decidedBy: string; note?: string | null }): Promise<boolean> {
		await this.expire();
		const r = await this.db.query(
			`UPDATE base_registrations
			    SET state = 'APPROVED', organization_uuid = $2, base_id = $3, base_key = $4, decided_by = $5, note = $6,
			        decided_at = now(), updated_at = now()
			  WHERE id = $1 AND state = 'PENDING'`,
			[id, d.organizationUuid, d.baseId, d.baseKey, d.decidedBy, d.note ?? null],
		);
		return (r.rowCount ?? 0) > 0;
	}

	async reject(id: string, d: { decidedBy: string; note: string }): Promise<boolean> {
		await this.expire();
		const r = await this.db.query(
			`UPDATE base_registrations SET state = 'REJECTED', decided_by = $2, note = $3, decided_at = now(), updated_at = now()
			  WHERE id = $1 AND state = 'PENDING'`,
			[id, d.decidedBy, d.note],
		);
		return (r.rowCount ?? 0) > 0;
	}

	/**
	 * Занять выдачу токена: ровно один опрос после одобрения получает право выпустить токен. Два одновременных
	 * опроса иначе выпустили бы два токена, и один из них остался бы действующим и никому не известным.
	 */
	async claimDelivery(id: string): Promise<boolean> {
		const r = await this.db.query(
			`UPDATE base_registrations SET token_delivered_at = now(), updated_at = now()
			  WHERE id = $1 AND state = 'APPROVED' AND token_delivered_at IS NULL`,
			[id],
		);
		return (r.rowCount ?? 0) > 0;
	}

	async setToken(id: string, tokenId: string): Promise<void> {
		await this.db.query(`UPDATE base_registrations SET token_id = $2, updated_at = now() WHERE id = $1`, [id, tokenId]);
	}

	/** Выдача сорвалась до ответа (токен не выпущен) — вернуть право следующему опросу. */
	async releaseDelivery(id: string): Promise<void> {
		await this.db.query(`UPDATE base_registrations SET token_delivered_at = NULL WHERE id = $1 AND token_id IS NULL`, [id]);
	}

	/**
	 * Токены прежних заявок той же базы 1С — к отзыву при выдаче нового: база подаёт заявку заново, когда своего
	 * токена у неё нет (не забрала ответ, «Отключить базу» стёрла его). Прежний токен иначе остался бы действующим.
	 */
	async previousTokens(onecBaseId: string, exceptId: string): Promise<string[]> {
		const r = await this.db.query<{ token_id: string }>(
			`SELECT token_id FROM base_registrations WHERE onec_base_id = $1 AND id <> $2 AND token_id IS NOT NULL`,
			[onecBaseId, exceptId],
		);
		return r.rows.map((x) => x.token_id);
	}
}
