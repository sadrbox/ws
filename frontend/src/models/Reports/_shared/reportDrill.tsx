// Единая drill-навигация отчётов. ВАЖНО: переход по ссылке — по ДВОЙНОМУ клику
// (одиночный клик не навигирует, чтобы не уводить случайно при выделении/чтении).
import { FC, ReactNode } from "react";
import { useAppContext } from "src/app/context";
import { translate } from "src/i18";
import { openReport } from "src/utils/openReport";
import { openDocumentByType } from "src/utils/accountingDocTypes";
import { openFormByEndpoint } from "src/registry/formRegistry";
import styles from "../report.module.scss";

export interface ReportDrillContext {
	/** Применённые фильтры отчёта-источника (для переноса периода/орг в целевой отчёт). */
	applied?: { dateFrom?: string; dateTo?: string; orgUuid?: string } | null;
	orgName?: string;
}

/**
 * Хук drill-навигации: переносит период/организацию источника в целевой отчёт.
 *   const drill = useReportDrill({ applied, orgName });
 *   drill.toReport("account-card", { accountCode, accountName });
 */
export function useReportDrill(ctx: ReportDrillContext) {
	const { windows: { addPane } } = useAppContext();
	const carry = () => ({
		initialDateFrom: ctx.applied?.dateFrom,
		initialDateTo: ctx.applied?.dateTo,
		initialOrgUuid: ctx.applied?.orgUuid,
		initialOrgName: ctx.orgName,
	});
	return {
		/** → исходный документ (проводка/движение → документ). */
		toDocument: (type?: string | null, uuid?: string | null) => {
			if (type && uuid) void openDocumentByType(type, uuid, addPane);
		},
		/** → другой отчёт (с переносом периода/орг + параметрами сущности). */
		toReport: (key: string, params?: Record<string, unknown>) =>
			void openReport(key, addPane, undefined, { ...carry(), ...params } as never),
		/** → карточка справочника. */
		toEntity: (endpoint: string, uuid?: string | null) => {
			if (uuid) void openFormByEndpoint(endpoint, uuid, addPane);
		},
	};
}

// Ссылка-детализация в ячейке: переход по ДВОЙНОМУ клику.
export const DrillLink: FC<{ onOpen: () => void; title?: string; children: ReactNode }> = ({ onOpen, title, children }) => (
	<span
		className={styles.ClickableLink}
		title={title ?? translate("reportDblClickOpen")}
		onDoubleClick={onOpen}
	>{children}</span>
);

// Кликабельная строка: переход по ДВОЙНОМУ клику.
export const DrillRow: FC<{ onOpen: () => void; title?: string; children: ReactNode }> = ({ onOpen, title, children }) => (
	<tr
		className={styles.ClickableRow}
		title={title ?? translate("reportDblClickOpen")}
		onDoubleClick={onOpen}
	>{children}</tr>
);
