/**
 * «Заявка»: опоздание, отсутствие или изменение графика (E17 СК6.3).
 *
 * Заявку подают ДО начала рабочего дня: поданная позже — несвоевременное уведомление (п. 34),
 * если согласующий не отметит объективную непредвиденную причину. Если день уже начался,
 * окно предупреждает об этом до отправки — отправить всё равно можно.
 */
import { FC, useCallback, useMemo, useState } from "react";
import Modal from "src/components/Modal";
import Notice, { type NoticeItem } from "src/components/Notice";
import { Field, FieldDate, FieldSelect, FieldTextarea } from "src/components/Field";
import { FIELD_WIDTH } from "src/components/Field/fieldWidths";
import { Group, GroupCol } from "src/components/UI";
import { showToast } from "src/components/UIToast";
import { routeError } from "src/services/errors/route";
import { createAbsenceRequest, type WorkSchedule } from "src/services/quality/api";
import { getAppUtcOffset, getFormatDateOnly } from "src/utils/datetime";
import { translate } from "src/i18";
import { ABSENCE_KINDS, absenceKindLabel, absencePayload, submittedAfterStart, validateAbsence, type AbsenceDraft } from "./attendanceView";
import styles from "./Attendance.module.scss";

interface Props {
	/** Мой график — чтобы предупредить о подаче после начала дня. */
	schedule: WorkSchedule | null;
	/** Сегодня «ГГГГ-ММ-ДД» по времени фирмы (с сервера). */
	today: string;
	onClose: () => void;
	onDone: () => void;
}

export const AbsenceRequestModal: FC<Props> = ({ schedule, today, onClose, onDone }) => {
	const [d, setD] = useState<AbsenceDraft>({ kind: "late", dateFrom: today, dateTo: "", timeFrom: "", timeTo: "", reason: "" });
	const [notices, setNotices] = useState<NoticeItem[]>([]);
	const [busy, setBusy] = useState(false);
	const patch = (p: Partial<AbsenceDraft>) => setD((prev) => ({ ...prev, ...p }));

	// День уже начался — заявка будет несвоевременной (п. 34). Считаем по графику и смещению приложения.
	const lateNotice = useMemo<NoticeItem[]>(() => {
		if (!schedule || !d.dateFrom) return [];
		const late = submittedAfterStart(new Date().toISOString(), d.dateFrom, schedule.startTime, getAppUtcOffset() * 60);
		return late ? [{ type: "warning", text: translate("attendanceRequestAfterStart").replace("{date}", getFormatDateOnly(d.dateFrom)) }] : [];
	}, [schedule, d.dateFrom]);

	const apply = useCallback(async () => {
		if (busy) return;
		const errors = validateAbsence(d);
		setNotices(errors.map((k) => ({ type: "error" as const, text: translate(k) })));
		if (errors.length) return;
		setBusy(true);
		try {
			await createAbsenceRequest(absencePayload(d));
			showToast(translate("attendanceRequestSent"), "success");
			onDone();
			onClose();
		} catch (e) {
			setNotices(routeError(e, { source: translate("AttendanceMyDay") }));
		} finally {
			setBusy(false);
		}
	}, [busy, d, onDone, onClose]);

	const isLate = d.kind === "late";
	const isChange = d.kind === "schedule_change";
	return (
		<Modal
			title={translate("attendanceRequestTitle")}
			onClose={onClose}
			buttons={[
				{ label: translate("attendanceRequestSend"), onClick: () => void apply(), variant: "primary" },
				{ label: translate("cancel"), onClick: onClose, variant: "secondary" },
			]}
		>
			<div className={styles.ModalBody}>
				<Notice inline items={[{ type: "info", text: translate("attendanceRequestRule") }]} />
				<GroupCol>
					<Group>
						<FieldSelect label={translate("attendanceKind")} name="absence_kind" value={d.kind} disabled={busy}
							options={ABSENCE_KINDS.map((k) => ({ value: k, label: absenceKindLabel(k) }))}
							onChange={(e) => patch({ kind: e.target.value })} />
					</Group>
					<Group>
						<FieldDate label={translate(isLate ? "attendanceDate" : "attendanceDateFrom")} name="absence_from" value={d.dateFrom}
							onChange={(e) => patch({ dateFrom: e.target.value })} disabled={busy} width={FIELD_WIDTH.date} required />
						{!isLate && (
							<FieldDate label={translate("attendanceDateTo")} name="absence_to" value={d.dateTo}
								onChange={(e) => patch({ dateTo: e.target.value })} disabled={busy} width={FIELD_WIDTH.date}
								hint={translate("attendanceDateToHint")} />
						)}
					</Group>
					<Group>
						<Field label={translate(isLate ? "attendanceArriveAt" : isChange ? "attendanceNewStart" : "attendanceTimeFrom")} name="absence_time_from"
							value={d.timeFrom} placeholder="09:00" maxLength={5} disabled={busy} width={FIELD_WIDTH.sm}
							onChange={(e) => patch({ timeFrom: e.target.value })} />
						{!isLate && (
							<Field label={translate(isChange ? "attendanceNewEnd" : "attendanceTimeTo")} name="absence_time_to"
								value={d.timeTo} placeholder="18:00" maxLength={5} disabled={busy} width={FIELD_WIDTH.sm}
								onChange={(e) => patch({ timeTo: e.target.value })} />
						)}
					</Group>
					<Group>
						<FieldTextarea label={translate("reason")} name="absence_reason" value={d.reason} rows={3} required disabled={busy}
							minWidth={FIELD_WIDTH.xl} onChange={(e) => patch({ reason: e.target.value })} />
					</Group>
				</GroupCol>
				<Notice inline items={[...lateNotice, ...notices]} />
			</div>
		</Modal>
	);
};
AbsenceRequestModal.displayName = "AbsenceRequestModal";

export default AbsenceRequestModal;
