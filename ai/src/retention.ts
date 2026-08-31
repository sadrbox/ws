// Срок хранения данных диалогов: старые диалоги (с сообщениями и файлами — каскадом), выписки
// без диалога и завершённые команды удаляются по расписанию.
//
// Диалог — рабочий контекст бухгалтера на дни, не на годы: через полгода он никому не нужен, а
// хранит тексты документов и суммы. Журнал аудита и агенты не трогаются: аудит — доказательная
// база, у него свой срок; агенты — конфигурация.

import type { Db } from "./db/pool.ts";

export type RetentionReport = { conversations: number; statements: number; commands: number };

export async function purgeOldData(db: Db, days: number): Promise<RetentionReport> {
	const d = Math.max(1, Math.floor(days));
	const interval = `${d} days`;
	const conv = await db.query(`DELETE FROM conversations WHERE updated_at < now() - $1::interval`, [interval]);
	// Выписки, чей диалог уже удалён (FK → NULL) или которые старше срока сами по себе.
	const st = await db.query(`DELETE FROM bank_statements WHERE created_at < now() - $1::interval`, [interval]);
	const cmd = await db.query(`DELETE FROM commands WHERE state NOT IN ('queued', 'dispatched') AND created_at < now() - $1::interval`, [interval]);
	return { conversations: conv.rowCount ?? 0, statements: st.rowCount ?? 0, commands: cmd.rowCount ?? 0 };
}
