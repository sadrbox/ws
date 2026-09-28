/**
 * Таблица итогов по шагам в «Обслуживании» базы (28.09): SubTableSheets вместо сырой таблицы StatsTable — тот же
 * вид ячеек, что у остальных таблиц панели. Отказ — тоном ошибки; «—» (итог неизвестен) не красится.
 */
import { FC } from "react";
import { translate } from "src/i18";
import SubTableSheets from "src/components/SubTableSheets";
import type { TColumn, TDataItem } from "src/components/Table/types";
import { asText } from "src/utils/asText";
import { STEP_RESULT_COLUMN, type StepRow } from "./stepResultsView";
import styles from "src/models/OneCAdmin/OneCAdmin.module.scss";

const renderStepCell = (row: TDataItem, col: TColumn) =>
	col.identifier === STEP_RESULT_COLUMN && (row as StepRow).__ok === false
		? <span className={styles.ReqBad}>{asText(row[col.identifier])}</span>
		: undefined;

export const StepResultsSheet: FC<{ columns: TColumn[]; rows: StepRow[] }> = ({ columns, rows }) => (
	<SubTableSheets columns={columns} rows={rows} renderCell={renderStepCell} emptyMessage={translate("noData")} />
);
