/**
 * ВЕРСИЯ РАСШИРЕНИЯ И ПОСЛЕДНИЙ ОБМЕН — ИЗ КАНАЛА ЧАТА (С2 аудита 23.09 со стороны 1С).
 *
 * Расширение шлёт `X-Ext-Version` в каждом запросе, а сервис читал его только на месте: в журнал, на порог
 * `EXT_TOO_OLD` и на порог ротации токена. Про базу, работающую ТОЛЬКО чатом из 1С — без агента вовсе, — панель
 * поэтому не могла сказать ни какая там сборка, ни когда база отвечала в последний раз, хотя ответ приходил
 * сегодня двадцать раз. На вопрос «какая версия у клиента» отвечать было нечем.
 *
 * ЗАПИСЬ НЕ НА КАЖДЫЙ ЗАПРОС. Форма 1С опрашивает `GET /conversations/:id` раз в секунду, пока идёт ход:
 * UPDATE на каждый опрос — это запись в базу секунда в секунду на каждого работающего человека, ради поля,
 * которое читают глазами раз в день. Поэтому пишем не чаще, чем раз в `throttleMs`, но СМЕНУ ВЕРСИИ пишем
 * сразу: обновление расширения у клиента — ровно то событие, из-за которого в панель и смотрят.
 *
 * ПАМЯТЬ — НЕ ИСТОЧНИК ИСТИНЫ. Отметка «когда писали в последний раз» живёт в процессе: после перезапуска
 * первый же запрос запишется заново. Потерять здесь можно только лишний UPDATE.
 */
import type { Db } from "../db/pool.ts";

/** Что канал чата знает о базе: сборка расширения и время последнего запроса от неё. */
export type BaseChatExchange = { baseKey: string; extVersion: string | null; seenAt: Date | null };

export class BaseChatExchangeStore {
	private readonly db: Db;
	private readonly throttleMs: number;
	/** База → когда последний раз писали и какую версию: чтобы не писать одно и то же каждую секунду. */
	private readonly last = new Map<string, { at: number; ext: string }>();

	constructor(db: Db, opts: { throttleMs?: number } = {}) {
		this.db = db;
		this.throttleMs = opts.throttleMs ?? 60_000;
	}

	/**
	 * Отметить обмен с базой. `extVersion` пустой — запрос был, а версию не назвали: время обновляем, версию
	 * НЕ затираем. Пустое значение означает «не знаем», и затереть им известную сборку значило бы потерять ответ
	 * на вопрос, ради которого всё это и пишется.
	 *
	 * Возвращает `true`, если запись действительно ушла в базу — это нужно тестам, а не вызывающему коду.
	 */
	async note(baseId: string, extVersion: string | null | undefined): Promise<boolean> {
		const ext = (extVersion ?? "").trim().slice(0, 40);
		const prev = this.last.get(baseId);
		const now = Date.now();
		// Сменилась версия — пишем немедленно; иначе не чаще, чем раз в throttleMs.
		if (prev && prev.ext === ext && now - prev.at < this.throttleMs) return false;
		this.last.set(baseId, { at: now, ext });
		try {
			await this.db.query(
				`UPDATE bases SET chat_seen_at = now(), chat_ext_version = COALESCE(NULLIF($2, ''), chat_ext_version) WHERE id = $1`,
				[baseId, ext],
			);
		} catch (e) {
			// Не записалось — забываем отметку: иначе неудачная запись затыкала бы следующую минуту, и панель
			// молчала бы не потому, что база молчит.
			this.last.delete(baseId);
			throw e;
		}
		return true;
	}

	/** Что канал чата знает про все базы. Пустые (чатом не пользовались) не отдаются вовсе. */
	async list(): Promise<BaseChatExchange[]> {
		const r = await this.db.query<{ key: string; chat_ext_version: string | null; chat_seen_at: Date | null }>(
			`SELECT key, chat_ext_version, chat_seen_at FROM bases WHERE chat_seen_at IS NOT NULL`);
		return r.rows.map((x) => ({ baseKey: x.key, extVersion: x.chat_ext_version, seenAt: x.chat_seen_at }));
	}
}
