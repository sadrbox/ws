// Ходы, оборванные перезапуском сервиса (Н9 аудита 26.09).
//
// Ход диалога живёт в памяти процесса: модель, очередь, ожидание 1С. Перезапуск (pm2 по памяти, выкладка) обрывает
// его на полуслове, а в базе остаётся состояние «идёт» (UNDERSTANDING / EXECUTING) и ключ хода 1С в `running`.
// Раньше это только писалось в журнал: веб-чат ждал до своего предела (10 мин), форма 1С видела PROCESSING, а
// повтор с тем же Idempotency-Key получал «ход уже выполняется» целые сутки. При старте закрываем их честно.
//
// ОДИН ПРОЦЕСС. Сервис работает одним экземпляром (pm2 fork): на старте чужих живых ходов нет. Вызывать только из
// main() — не из createApp: инструменты e2e поднимают приложение на общей базе рядом с работающим сервисом.

import type { Db } from "../db/pool.ts";
import type { Logger } from "../logger.ts";

/** Что значит «ход идёт»: состояния, в которые диалог попадает только внутри хода. */
export const RUNNING_STATES = ["UNDERSTANDING", "RESOLVING_ENTITIES", "EXECUTING"] as const;

export const INTERRUPTED_TEXT = "Ход прервался: сервис перезапускался. Повторите, пожалуйста, последнее сообщение.";

export async function recoverInterruptedTurns(db: Pick<Db, "query">, log: Pick<Logger, "info" | "warn">): Promise<{ conversations: number; turnKeys: number }> {
	const conv = await db.query<{ id: string }>(
		`UPDATE conversations SET state = 'FAILED', updated_at = now()
		  WHERE state = ANY($1::text[])
		  RETURNING id`,
		[[...RUNNING_STATES]],
	);
	for (const c of conv.rows) {
		// Сообщение — чтобы человек видел причину, а не пустоту; незакрытые вызовы инструментов история починит сама.
		await db.query(`INSERT INTO messages (conversation_id, role, content) VALUES ($1, 'assistant', $2::jsonb)`,
			[c.id, JSON.stringify({ role: "assistant", text: INTERRUPTED_TEXT, toolCalls: [] })]).catch((e: unknown) =>
			log.warn({ err: e instanceof Error ? e.message : String(e), conversationId: c.id }, "восстановление: сообщение не записано"));
	}
	// Ключ хода, чей ход умер вместе с процессом, — освобождаем: повтор должен выполнить ход, а не ждать сутки.
	const keys = await db.query(`DELETE FROM onec_chat_turn_keys WHERE state = 'running'`);
	const r = { conversations: conv.rowCount ?? 0, turnKeys: keys.rowCount ?? 0 };
	if (r.conversations || r.turnKeys) log.info(r, "ходы, оборванные перезапуском, закрыты");
	return r;
}
