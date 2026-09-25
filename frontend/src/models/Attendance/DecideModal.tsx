/**
 * Решение по заявке: согласовать или отклонить (главбух, руководитель, администратор).
 *
 * «Непредвиденная причина» — исключение п. 34: заявку подали уже после начала дня, но причина
 * объективная и заранее её знать было нельзя. Отметка ставится только при согласовании.
 */
import { FC, useCallback, useMemo, useState } from "react";
import Modal from "src/components/Modal";
import Notice, { type NoticeItem } from "src/components/Notice";
import { FieldTextarea } from "src/components/Field";
import { FIELD_WIDTH } from "src/components/Field/fieldWidths";
import { showToast } from "src/components/UIToast";
import { routeError } from "src/services/errors/route";
import { decideAbsenceRequest, type AbsenceRequest } from "src/services/quality/api";
import { getAppUtcOffset, getFormatDate } from "src/utils/datetime";
import { cx } from "src/utils/cx";
import { translate } from "src/i18";
import { absenceKindLabel, requestPeriodText, submittedAfterStart } from "./attendanceView";
import main from "src/styles/main.module.scss";
import styles from "./Attendance.module.scss";

interface Props {
	request: AbsenceRequest;
	decision: "approved" | "rejected";
	/** Начало дня по графику сотрудника — чтобы сказать, подана ли заявка вовремя. */
	startTime?: string | null;
	onClose: () => void;
	onDone: () => void;
}

export const DecideModal: FC<Props> = ({ request, decision, startTime, onClose, onDone }) => {
	const [unforeseen, setUnforeseen] = useState(false);
	const [note, setNote] = useState("");
	const [notices, setNotices] = useState<NoticeItem[]>([]);
	const [busy, setBusy] = useState(false);
	const approve = decision === "approved";

	const lateSubmitted = useMemo(
		() => !!startTime && submittedAfterStart(request.createdAt, request.dateFrom, startTime, getAppUtcOffset() * 60),
		[request.createdAt, request.dateFrom, startTime],
	);

	const apply = useCallback(async () => {
		if (busy) return;
		setBusy(true);
		setNotices([]);
		try {
			await decideAbsenceRequest(request.uuid, { status: decision, unforeseen: approve && unforeseen, note: note.trim() || undefined });
			showToast(translate(approve ? "attendanceApproved" : "attendanceRejected"), "success");
			onDone();
			onClose();
		} catch (e) {
			setNotices(routeError(e, { source: translate("AttendanceJournal") }));
		} finally {
			setBusy(false);
		}
	}, [busy, request.uuid, decision, approve, unforeseen, note, onDone, onClose]);

	return (
		<Modal
			title={translate(approve ? "attendanceApproveTitle" : "attendanceRejectTitle")}
			onClose={onClose}
			buttons={[
				{ label: translate(approve ? "attendanceApprove" : "attendanceReject"), onClick: () => void apply(), variant: approve ? "primary" : "danger" },
				{ label: translate("cancel"), onClick: onClose, variant: "secondary" },
			]}
		>
			<div className={styles.ModalBody}>
				<div className={styles.Facts}>
					<span><span className={styles.FactLabel}>{translate("employee")}:</span> {request.userName ?? ""}</span>
					<span><span className={styles.FactLabel}>{translate("attendanceKind")}:</span> {absenceKindLabel(request.kind)}</span>
					<span><span className={styles.FactLabel}>{translate("attendancePeriod")}:</span> {requestPeriodText(request)}</span>
					<span><span className={styles.FactLabel}>{translate("attendanceSubmittedAt")}:</span> {getFormatDate(request.createdAt)}</span>
				</div>
				<p className={styles.Reason}>{request.reason ?? ""}</p>
				{lateSubmitted && <Notice inline items={[{ type: "warning", text: translate("attendanceSubmittedLate") }]} />}
				{approve && (
					<label className={cx(main.SettingChip, unforeseen && main.SettingChipActive)}>
						<input type="checkbox" checked={unforeseen} disabled={busy} onChange={(e) => setUnforeseen(e.target.checked)} />
						{translate("attendanceUnforeseen")}
					</label>
				)}
				{approve && <p className={styles.Note}>{translate("attendanceUnforeseenHint")}</p>}
				<FieldTextarea label={translate("attendanceDecisionNote")} name="absence_decision_note" value={note} rows={2}
					disabled={busy} minWidth={FIELD_WIDTH.xl} onChange={(e) => setNote(e.target.value)} />
				<Notice inline items={notices} />
			</div>
		</Modal>
	);
};
DecideModal.displayName = "DecideModal";

export default DecideModal;
