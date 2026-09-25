/**
 * «Панель руководителя» (E17 СК4.2, п. 30 стандарта): группы и сотрудники за месяц —
 * подтверждённые нарушения (бонус), кандидаты на решение, повторяемость и меры.
 *
 * Главный сигнал — «нарушения повторяются, а мер нет»: систематичность без записанной меры
 * руководителя. Это п. 30 — нарушение уже самого руководителя, поэтому такие строки и группы
 * подсвечены и стоят первыми. Меры и решения по нарушениям ведутся в реестре нарушений.
 */
import { FC, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { TPane } from "src/app/types";
import type { TColumn, TDataItem } from "src/components/Table/types";
import Table from "src/components/Table";
import Toolbar from "src/components/Toolbar";
import Notice from "src/components/Notice";
import { FieldPeriod } from "src/components/Field";
import { getModelColumns } from "src/components/Table/services";
import { usePaneToolbar } from "src/hooks/usePaneToolbar";
import { useQualityMe } from "src/hooks/useQualityMe";
import { useStaticTableView } from "src/hooks/useStaticTableView";
import { fetchManagerDashboard } from "src/services/quality/api";
import { buildStaticTableProps } from "src/utils/staticTableProps";
import { getAppUtcOffset } from "src/utils/datetime";
import { cx } from "src/utils/cx";
import { translate } from "src/i18";
import QualityChip from "src/models/_quality/QualityChip";
import { currentMonth } from "src/models/_quality/month";
import { attentionTone, managerTotals, staffAttention, toStaffRows, violationsTitle, type StaffTableRow } from "./managerView";
import staffColumnsJson from "./staffColumns.json";
import main from "src/styles/main.module.scss";
import styles from "./QualityManagerDashboard.module.scss";

const STAFF = "QualityManagerStaff";

export const QualityManagerDashboard: FC<Partial<TPane>> = ({ uniqId }) => {
	const { isController, isLoading: meLoading } = useQualityMe();
	const [month, setMonth] = useState(() => currentMonth(getAppUtcOffset() * 60));

	const q = useQuery({
		queryKey: ["quality", "dashboard", "manager", month],
		queryFn: () => fetchManagerDashboard(month),
		enabled: isController,
	});
	const groups = useMemo(() => q.data?.groups ?? [], [q.data]);
	const totals = useMemo(() => managerTotals(groups), [groups]);
	// Сначала группы, где повторяются нарушения без мер: это п. 30 — к ним и надо идти первым делом.
	const orderedGroups = useMemo(() => [...groups].sort((a, b) => (b.totals?.noMeasure ?? 0) - (a.totals?.noMeasure ?? 0)), [groups]);

	const [cols, setCols] = useState<TColumn[]>(() => getModelColumns(staffColumnsJson as TColumn[], STAFF));
	const staff = useStaticTableView(useMemo(() => toStaffRows(groups), [groups]), { mgrAttention: "desc" });

	const renderCell = (row: TDataItem, col: TColumn) => {
		const src = (row as StaffTableRow).source;
		if (!src) return undefined;
		switch (col.identifier) {
			case "mgrBonus":
				return <QualityChip tone={src.bonus ? "ok" : "bad"}>{translate(src.bonus ? "mgrDashBonusYes" : "mgrDashBonusNo")}</QualityChip>;
			case "mgrConfirmed":
				return <span title={violationsTitle(src) || undefined}>{src.confirmedCount ?? 0}</span>;
			case "mgrSystematic":
				return src.systematic ? <QualityChip tone="warn">{translate("mgrDashSystematic")}</QualityChip> : <span />;
			case "mgrNoMeasure":
				return src.noMeasure ? <QualityChip tone="bad" title={translate("mgrDashNoMeasureHint")}>{translate("mgrDashNoMeasure")}</QualityChip> : <span />;
			case "mgrEmployee": {
				const a = staffAttention(src);
				return a === "ok" ? undefined : <QualityChip tone={attentionTone(a)}>{src.userName ?? ""}</QualityChip>;
			}
			default:
				return undefined;
		}
	};

	const paneToolbar = usePaneToolbar(uniqId, (
		<Toolbar className={main.PaneToolbarFill}>
			<FieldPeriod name="manager_dashboard_month" value={month} onChange={(e) => setMonth(e.target.value)} />
			<Toolbar.Divider />
			<Toolbar.ReloadButton onClick={() => void q.refetch()} disabled={q.isFetching || !isController} />
		</Toolbar>
	));

	if (!meLoading && !isController) {
		return (
			<>
				{paneToolbar}
				<div className={main.PaneFill}>
					<Notice inline items={[{ type: "info", text: translate("mgrDashOnlyControllers") }]} />
				</div>
			</>
		);
	}

	return (
		<>
			{paneToolbar}
			<Notice items={[
				{ type: "info", text: translate("mgrDashInfo") },
				...(totals.noMeasure ? [{ type: "warning" as const, text: translate("mgrDashNoMeasureAlert").replace("{n}", String(totals.noMeasure)) }] : []),
			]} />
			<div className={main.PaneFill}>
				<div className={styles.Body}>
					<div className={styles.Cards}>
						{!q.isLoading && !orderedGroups.length && <span className={styles.Empty}>{translate("mgrDashNoGroups")}</span>}
						{orderedGroups.map((g) => (
							<div key={g.uuid} className={cx(styles.Card, (g.totals?.noMeasure ?? 0) > 0 && styles.CardAlert)}>
								<h4 className={styles.CardTitle}>{g.name}</h4>
								<span className={styles.CardHead}>{`${translate("mgrDashHead")}: ${g.headName ?? "—"}`}</span>
								<div className={styles.CardChips}>
									<QualityChip tone={g.totals.withoutBonus ? "bad" : "ok"}>{`${translate("mgrDashWithoutBonus")}: ${g.totals.withoutBonus}`}</QualityChip>
									<QualityChip tone={g.totals.candidates ? "warn" : "muted"}>{`${translate("mgrDashCandidates")}: ${g.totals.candidates}`}</QualityChip>
									<QualityChip tone={g.totals.systematic ? "warn" : "muted"}>{`${translate("mgrDashSystematic")}: ${g.totals.systematic}`}</QualityChip>
									<QualityChip tone={g.totals.noMeasure ? "bad" : "muted"} title={translate("mgrDashNoMeasureHint")}>
										{`${translate("mgrDashNoMeasure")}: ${g.totals.noMeasure}`}
									</QualityChip>
								</div>
							</div>
						))}
					</div>
					<div className={styles.Staff}>
						<Table {...buildStaticTableProps({
							componentName: STAFF, rows: staff.rows, columns: cols, setColumns: setCols,
							sorting: staff.sorting, search: staff.search,
							isLoading: q.isLoading, reloading: q.isFetching && !q.isLoading, onReload: () => void q.refetch(),
							emptyText: translate("mgrDashNoStaff"), renderCell,
						})} />
					</div>
				</div>
			</div>
		</>
	);
};
QualityManagerDashboard.displayName = "QualityManagerDashboard";
