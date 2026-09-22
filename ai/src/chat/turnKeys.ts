/**
 * Ключи ходов канала 1С: «тот же ключ — тот же ход» (§2 задачи TASK_SERVICE_ONEC_CHAT_CHANNEL_2026-09-21).
 *
 * ЗАЧЕМ. Оборванный ответ не говорит, дошёл ход или нет. Расширение показывает «нет связи», человек пишет
 * заново — и, если первый ход всё-таки дошёл, в диалоге два одинаковых сообщения, модель отвечает дважды и
 * дважды берёт деньги. Расширение шлёт `Idempotency-Key` (UUID на круг) и ровно один раз повторяет ход с тем
 * же ключом, когда ответа не было вовсе.
 *
 * КАК. Ключ занимается ДО работы: вставка с ON CONFLICT DO NOTHING — это и есть замок, второй запрос с тем же
 * ключом не начинает ход, а узнаёт судьбу первого. Ответ сохраняется целиком: повтор получает ровно то, что
 * получил бы первый запрос, а не «уже сделано» — форме 1С незачем знать про идемпотентность.
 *
 * ЧЕГО ЗДЕСЬ НЕТ. Сверки тел: ключ рождается в 1С один раз и не переиспользуется. Ключ живёт в пределах пары
 * «база + пользователь ИБ» — ключи разных клиентов не должны встречаться даже случайно.
 */
import type { Db } from "../db/pool.ts";

export type TurnKeyPair = { baseId: string; userId: string; key: string };

/** Что известно о ходе с этим ключом. */
export type TurnKeyState =
	/** Ключ занят нами: ход можно выполнять. */
	| { kind: "fresh" }
	/** Ход с этим ключом уже выполняется — отвечаем PROCESSING, а не начинаем заново. */
	| { kind: "running"; conversationId: string | null }
	/** Ход закончился: отдаём сохранённый ответ. */
	| { kind: "done"; status: number; response: unknown };

export class TurnKeyStore {
	private readonly db: Db;
	private readonly ttlHours: number;

	constructor(db: Db, ttlHours = 24) {
		this.db = db;
		this.ttlHours = ttlHours;
	}

	/** Занять ключ. Просроченные строки не мешают: тот же ключ спустя сутки — новый ход. */
	async claim(p: TurnKeyPair): Promise<TurnKeyState> {
		const ins = await this.db.query(
			`INSERT INTO onec_chat_turn_keys (base_id, user_id, key, expires_at)
			 VALUES ($1, $2, $3, now() + ($4 || ' hours')::interval)
			 ON CONFLICT (base_id, user_id, key) DO UPDATE
			    SET state = 'running', conversation_id = NULL, status = NULL, response = NULL,
			        created_at = now(), expires_at = now() + ($4 || ' hours')::interval
			  WHERE onec_chat_turn_keys.expires_at <= now()`,
			[p.baseId, p.userId, p.key, this.ttlHours]);
		if ((ins.rowCount ?? 0) > 0) return { kind: "fresh" };
		const r = await this.db.query<{ state: string; conversation_id: string | null; status: number | null; response: unknown }>(
			`SELECT state, conversation_id, status, response FROM onec_chat_turn_keys
			  WHERE base_id = $1 AND user_id = $2 AND key = $3`, [p.baseId, p.userId, p.key]);
		const x = r.rows[0];
		if (!x) return { kind: "fresh" };
		if (x.state === "done" && x.status) return { kind: "done", status: x.status, response: x.response };
		return { kind: "running", conversationId: x.conversation_id };
	}

	/** Запомнить диалог сразу, как он стал известен: повтор во время работы назовёт его в ответе PROCESSING. */
	async note(p: TurnKeyPair, conversationId: string): Promise<void> {
		await this.db.query(
			`UPDATE onec_chat_turn_keys SET conversation_id = $4 WHERE base_id = $1 AND user_id = $2 AND key = $3`,
			[p.baseId, p.userId, p.key, conversationId]);
	}

	/** Записать итог хода: повтор с тем же ключом получит его дословно. */
	async finish(p: TurnKeyPair, status: number, response: unknown): Promise<void> {
		await this.db.query(
			`UPDATE onec_chat_turn_keys SET state = 'done', status = $4, response = $5::jsonb
			  WHERE base_id = $1 AND user_id = $2 AND key = $3`,
			[p.baseId, p.userId, p.key, status, JSON.stringify(response ?? null)]);
	}

	/**
	 * Освободить ключ. Зовётся, когда ход сорвался по вине сервиса (500): такой ответ не итог, а
	 * неудача, и повтор — именно то, что должно произойти.
	 */
	async release(p: TurnKeyPair): Promise<void> {
		await this.db.query(
			`DELETE FROM onec_chat_turn_keys WHERE base_id = $1 AND user_id = $2 AND key = $3 AND state = 'running'`,
			[p.baseId, p.userId, p.key]);
	}

	async purgeExpired(): Promise<number> {
		const r = await this.db.query(`DELETE FROM onec_chat_turn_keys WHERE expires_at <= now()`);
		return r.rowCount ?? 0;
	}
}
