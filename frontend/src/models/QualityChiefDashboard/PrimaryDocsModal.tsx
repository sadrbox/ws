/**
 * «Первичка клиента» (E17 СК3.4, п. 19): отметки о получении первички за месяц и динамика её
 * ввода в 1С по ночным снимкам — равномерно или вся в последние дни перед отчётностью.
 *
 * Отметку ставит бухгалтер или главбух: «получена» (частично) или «получена полностью».
 * Срок отчётности и окно «поздно» — настройки качества (primaryDocs.reportDay/lateWindowDays);
 * сервер считает долю первички, внесённой в это окно, и поднимает сигнал выше порога.
 */
import { FC, useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Modal from "src/components/Modal";
import Notice, { type NoticeItem } from "src/components/Notice";
import { Button } from "src/components/Button";
import IconButton from "src/components/IconButton/IconButton";
import { Field, FieldPeriod } from "src/components/Field";
import { FIELD_WIDTH } from "src/components/Field/fieldWidths";
import { showToast } from "src/components/UIToast";
import { useAppContext } from "src/app/context";
import { routeError } from "src/services/errors/route";
import { createPrimaryDocsReceipt, deletePrimaryDocsReceipt, fetchPrimaryDocs } from "src/services/quality/api";
import { getAppUtcOffset, getFormatDate } from "src/utils/datetime";
import { cx } from "src/utils/cx";
import { translate } from "src/i18";
import QualityChip from "src/models/_quality/QualityChip";
import { addMonths, currentMonth } from "src/models/_quality/month";
import main from "src/styles/main.module.scss";
import styles from "./QualityChiefDashboard.module.scss";

interface Props {
	organizationUuid: string;
	organizationName: string;
	onClose: () => void;
}

export const PrimaryDocsModal: FC<Props> = ({ organizationUuid, organizationName, onClose }) => {
	const qc = useQueryClient();
	const { confirm } = useAppContext().actions;
	// Панель показывает прошлый месяц — с него и начинаем.
	const [month, setMonth] = useState(() => addMonths(currentMonth(getAppUtcOffset() * 60), -1));
	const [complete, setComplete] = useState(false);
	const [note, setNote] = useState("");
	const [notices, setNotices] = useState<NoticeItem[]>([]);
	const [busy, setBusy] = useState(false);

	const q = useQuery({
		queryKey: ["quality", "primary-docs", organizationUuid, month],
		queryFn: () => fetchPrimaryDocs(organizationUuid, month),
	});
	const d = q.data;

	const refresh = useCallback(() => {
		void qc.invalidateQueries({ queryKey: ["quality", "primary-docs", organizationUuid] });
		void qc.invalidateQueries({ queryKey: ["quality", "dashboard", "chief"] });
	}, [qc, organizationUuid]);

	const mark = useCallback(async () => {
		if (busy) return;
		setBusy(true);
		setNotices([]);
		try {
			await createPrimaryDocsReceipt({ organizationUuid, month, complete, note: note.trim() || undefined });
			showToast(translate("primaryDocsMarked"), "success");
			setNote("");
			setComplete(false);
			refresh();
		} catch (e) {
			setNotices(routeError(e, { source: translate("primaryDocsTitle") }));
		} finally {
			setBusy(false);
		}
	}, [busy, organizationUuid, month, complete, note, refresh]);

	const remove = useCallback(async (uuid: string) => {
		if (!(await confirm(translate("primaryDocsDeleteConfirm")))) return;
		try {
			await deletePrimaryDocsReceipt(uuid);
			refresh();
		} catch (e) {
			setNotices(routeError(e, { source: translate("primaryDocsTitle") }));
		}
	}, [confirm, refresh]);

	const lateShare = d?.lateShare;
	return (
		<Modal
			title={`${translate("primaryDocsTitle")}: ${organizationName}`}
			onClose={onClose}
			buttons={[{ label: translate("close"), onClick: onClose, variant: "secondary" }]}
		>
			<div className={styles.ModalBody}>
				<FieldPeriod label={translate("primaryDocsMonth")} name="primary_docs_month" value={month} onChange={(e) => setMonth(e.target.value)} />
				{q.error ? <Notice inline items={[{ type: "error", text: translate("primaryDocsLoadFailed") }]} /> : null}
				{d && (
					<div className={styles.Facts}>
						<span><span className={styles.FactLabel}>{translate("primaryDocsDeadline")}:</span> {getFormatDate(d.deadline)}</span>
						<span><span className={styles.FactLabel}>{translate("primaryDocsWindow")}:</span> {getFormatDate(d.windowStart)}</span>
						{lateShare === null || lateShare === undefined
							? <span className={styles.Muted}>{translate("primaryDocsNoSnapshots")}</span>
							: (
								<QualityChip tone={d.signal ? "bad" : "ok"} title={translate("primaryDocsLateShareHint")}>
									{`${translate("primaryDocsLateShare")}: ${Math.round(lateShare * 100)}%`}
								</QualityChip>
							)}
					</div>
				)}

				<h4 className={styles.SectionTitle}>{translate("primaryDocsSeries")}</h4>
				<div className={styles.List}>
					{!d?.series.length && <span className={styles.Muted}>{translate("primaryDocsNoSnapshots")}</span>}
					{d?.series.map((p) => (
						<div key={p.at} className={styles.ListRow}>
							<span className={styles.ListDate}>{getFormatDate(p.at)}</span>
							<span>{p.count}</span>
						</div>
					))}
				</div>

				<h4 className={styles.SectionTitle}>{translate("primaryDocsReceipts")}</h4>
				<div className={styles.List}>
					{!d?.receipts.length && <span className={styles.Muted}>{translate("primaryDocsNoReceipts")}</span>}
					{d?.receipts.map((r) => (
						<div key={r.uuid} className={styles.ListRow}>
							<span className={styles.ListDate}>{getFormatDate(r.receivedAt)}</span>
							<QualityChip tone={r.complete ? "ok" : "warn"}>{translate(r.complete ? "primaryDocsComplete" : "primaryDocsPartial")}</QualityChip>
							<span className={styles.ListGrow}>{r.note ?? ""}</span>
							<span className={styles.Muted}>{r.userName ?? ""}</span>
							<IconButton icon="trash" size="sm" onClick={() => void remove(r.uuid)}
								title={translate("primaryDocsDelete")} aria-label={translate("primaryDocsDelete")} />
						</div>
					))}
				</div>

				<div className={styles.MarkForm}>
					<label className={cx(main.SettingChip, complete && main.SettingChipActive)}>
						<input type="checkbox" checked={complete} onChange={(e) => setComplete(e.target.checked)} disabled={busy} />
						{translate("primaryDocsCompleteFlag")}
					</label>
					<Field label={translate("note")} name="primary_docs_note" value={note} onChange={(e) => setNote(e.target.value)} disabled={busy} minWidth={FIELD_WIDTH.wide} />
					<Button variant="primary" onClick={() => void mark()} disabled={busy}>{translate("primaryDocsMark")}</Button>
				</div>
				<Notice inline items={notices} />
			</div>
		</Modal>
	);
};
PrimaryDocsModal.displayName = "PrimaryDocsModal";

export default PrimaryDocsModal;
