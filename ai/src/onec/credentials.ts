/**
 * Учётные записи администратора ОТДЕЛЬНЫХ баз.
 *
 * ЗАЧЕМ. У агента на сервере 1С один администратор баз на всех (у нас — support). К части
 * клиентских баз он не подходит: их заводили до нас, и такого пользователя там нет. Раньше
 * лечилось правкой настроек агента на сервере — то есть ради одной базы трогали все.
 * Здесь исключение заводится ровно для той базы, которой оно нужно.
 *
 * КАК ЭТО РАБОТАЕТ ДАЛЬШЕ. Учётные данные подставляются в команду В МОМЕНТ ВЫДАЧИ агенту
 * (см. CommandQueue.dispatchQueued) и в самой команде НЕ ХРАНЯТСЯ: иначе пароль осел бы в
 * таблице команд, в журнале и в панели, где показывается payload. Агент сначала пробует
 * своего администратора и берёт присланного, только если тот не прошёл, — порядок описан
 * в контракте агента.
 *
 * ШИФРОВАНИЕ. aes-256-gcm, ключ выводится scrypt'ом из секрета сервиса. Это защищает
 * выгрузку базы и резервные копии, но не сам сервис: ключ у него есть по долгу службы,
 * пароль нужно ОТДАТЬ агенту, а не сверить с ним, поэтому шифрование именно обратимое.
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import type { Db } from "../db/pool.ts";

const ALGO = "aes-256-gcm";
/** Соль постоянна: ключ должен получаться одинаковым при каждом запуске сервиса. */
const SALT = "onec-base-credentials";

export function deriveKey(secret: string): Buffer {
	return scryptSync(secret, SALT, 32);
}

/** Зашифровать пароль. Формат: v1:<iv>:<tag>:<data>, всё base64. */
export function seal(plain: string, key: Buffer): string {
	const iv = randomBytes(12);
	const c = createCipheriv(ALGO, key, iv);
	const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
	return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), data.toString("base64")].join(":");
}

/**
 * Расшифровать. Возвращает null на любом непонятном значении: сменили секрет сервиса —
 * старые пароли просто перестают подходить, и это должно выглядеть как «пароль не задан»,
 * а не как падение выдачи команд.
 */
export function unseal(sealed: string, key: Buffer): string | null {
	const parts = sealed.split(":");
	if (parts.length !== 4 || parts[0] !== "v1") return null;
	try {
		const d = createDecipheriv(ALGO, key, Buffer.from(parts[1], "base64"));
		d.setAuthTag(Buffer.from(parts[2], "base64"));
		return Buffer.concat([d.update(Buffer.from(parts[3], "base64")), d.final()]).toString("utf8");
	} catch {
		return null;
	}
}

/** Что можно показать человеку: имя — да, пароль — никогда. */
export type CredentialsView = {
	baseKey: string;
	user: string;
	hasPassword: boolean;
	updatedAt: string;
	updatedBy: string | null;
};

export type BaseAuth = { user: string; password: string };

export class CredentialsStore {
	private readonly db: Db;
	private readonly key: Buffer;

	constructor(db: Db, secret: string) {
		this.db = db;
		this.key = deriveKey(secret);
	}

	/**
	 * Задать учётную запись базы.
	 *
	 * `password === undefined` означает «не трогать»: имя правят чаще, чем пароль, и
	 * заставлять вводить пароль заново ради опечатки в имени — верный способ получить
	 * пустой пароль там, где он был.
	 */
	async set(baseId: string, user: string, password: string | undefined, actor: string | null): Promise<void> {
		const sealed = password === undefined ? null : (password ? seal(password, this.key) : "");
		await this.db.query(
			`INSERT INTO base_credentials (base_id, user_name, secret, updated_at, updated_by)
			      VALUES ($1, $2, COALESCE($3, ''), now(), $4)
			 ON CONFLICT (base_id) DO UPDATE
			    SET user_name = EXCLUDED.user_name,
			        secret = COALESCE($3, base_credentials.secret),
			        updated_at = now(),
			        updated_by = EXCLUDED.updated_by`,
			[baseId, user, sealed, actor],
		);
	}

	async clear(baseId: string): Promise<boolean> {
		const r = await this.db.query(`DELETE FROM base_credentials WHERE base_id = $1`, [baseId]);
		return (r.rowCount ?? 0) > 0;
	}

	async describe(baseId: string, baseKey: string): Promise<CredentialsView | null> {
		const r = await this.db.query<{ user_name: string; secret: string; updated_at: Date; updated_by: string | null }>(
			`SELECT user_name, secret, updated_at, updated_by FROM base_credentials WHERE base_id = $1`,
			[baseId],
		);
		const row = r.rows[0];
		if (!row) return null;
		return {
			baseKey,
			user: row.user_name,
			hasPassword: !!row.secret,
			updatedAt: row.updated_at.toISOString(),
			updatedBy: row.updated_by,
		};
	}

	/**
	 * Учётные данные для выдаваемых команд: ключ базы → пара.
	 *
	 * Ищем по ПАРЕ (сервер, ключ базы): ключ уникален внутри сервера, а не глобально, и
	 * одноимённая база другого сервера не должна получить чужой пароль.
	 */
	async forDispatch(serverIds: string[], baseKeys: string[]): Promise<Map<string, BaseAuth>> {
		const out = new Map<string, BaseAuth>();
		if (!serverIds.length || !baseKeys.length) return out;
		const r = await this.db.query<{ key: string; user_name: string; secret: string }>(
			`SELECT b.key, c.user_name, c.secret
			   FROM base_credentials c
			   JOIN bases b ON b.id = c.base_id
			  WHERE b.server_id = ANY($1::uuid[]) AND b.key = ANY($2::text[])`,
			[serverIds, baseKeys],
		);
		for (const row of r.rows) {
			if (!row.user_name) continue;
			const password = row.secret ? unseal(row.secret, this.key) : "";
			// Пароль не расшифровался (сменили секрет сервиса) — отдавать имя без пароля
			// бессмысленно: агент попробует пустой и получит тот же отказ.
			if (password === null) continue;
			out.set(row.key, { user: row.user_name, password });
		}
		return out;
	}
}
