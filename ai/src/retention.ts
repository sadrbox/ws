// Срок хранения данных диалогов: старые диалоги (с сообщениями и файлами — каскадом), выписки
// без диалога и завершённые команды удаляются по расписанию.
//
// Диалог — рабочий контекст бухгалтера на дни, не на годы: через полгода он никому не нужен, а
// хранит тексты документов и суммы. Журнал аудита и агенты не трогаются: аудит — доказательная
// база, у него свой срок; агенты — конфигурация.

import type { Db } from "./db/pool.ts";
import { CHECK_COMMAND_TYPES } from "./onec/accountingChecks.ts";

/**
 * КОМАНДЫ НОЧНЫХ ПРОВЕРОК УЧЁТА (E17) ХРАНЯТСЯ КОРОЧЕ. Их ответы — до тысячи находок на проверку, двадцать проверок
 * на организацию каждую ночь, — и под общим сроком (полгода) таблица команд росла бы на порядки быстрее всего
 * остального. Результаты уже переданы в ERP и хранятся там; здесь они нужны только для разбора «что 1С ответила
 * той ночью».
 *
 * ПРОВЕРИТЬ ПОТОМ: 14 дней — оценка. Если разбор жалоб на находки потребует истории дольше, срок поднять.
 */
const CHECK_COMMANDS_KEEP_DAYS = 14;

export type RetentionReport = { conversations: number; statements: number; purchases: number; commands: number; audit: number };

export async function purgeOldData(db: Db, days: number): Promise<RetentionReport> {
	const d = Math.max(1, Math.floor(days));
	const interval = `${d} days`;
	const conv = await db.query(`DELETE FROM conversations WHERE updated_at < now() - $1::interval`, [interval]);
	// Выписки, чей диалог уже удалён (FK → NULL) или которые старше срока сами по себе.
	const st = await db.query(`DELETE FROM bank_statements WHERE created_at < now() - $1::interval`, [interval]);
	// Первичка поставщиков (И2) — тем же правилом: тексты чужих документов дольше диалога не нужны.
	const pd = await db.query(`DELETE FROM purchase_documents WHERE created_at < now() - $1::interval`, [interval]);
	const cmd = await db.query(`DELETE FROM commands WHERE state NOT IN ('queued', 'dispatched') AND created_at < now() - $1::interval`, [interval]);
	const checks = await db.query(
		`DELETE FROM commands WHERE type = ANY($1::text[]) AND state NOT IN ('queued', 'dispatched') AND created_at < now() - $2::interval`,
		[CHECK_COMMAND_TYPES, `${Math.min(d, CHECK_COMMANDS_KEEP_DAYS)} days`],
	);
	// Журнал административных действий чистится тем же сроком, что и всё остальное: он
	// пишется на КАЖДУЮ команду, включая чтения, и растёт быстрее любой другой таблицы.
	const audit = await db.query(`DELETE FROM audit_log WHERE at < now() - $1::interval`, [interval]);
	return {
		conversations: conv.rowCount ?? 0, statements: st.rowCount ?? 0, purchases: pd.rowCount ?? 0,
		commands: (cmd.rowCount ?? 0) + (checks.rowCount ?? 0), audit: audit.rowCount ?? 0,
	};
}
