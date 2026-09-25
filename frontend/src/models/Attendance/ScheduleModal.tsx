/**
 * График сотрудника (E17 СК6.1): начало и конец дня, рабочие дни, допуск опоздания.
 *
 * По графику сервер решает, было ли опоздание (п. 32) и отсутствие (п. 33). Задаёт график
 * главбух, руководитель или администратор; у сотрудника график один — запись по тому же
 * сотруднику заменяет прежний (POST /work-schedules — upsert).
 */
import { FC, useCallback, useState } from "react";
import Modal from "src/components/Modal";
import Notice, { type NoticeItem } from "src/components/Notice";
import { Field } from "src/components/Field";
import FieldToggle from "src/components/Field/FieldToggle";
import LookupField from "src/components/Field/LookupField";
import { FIELD_WIDTH } from "src/components/Field/fieldWidths";
import { Group, GroupCol } from "src/components/UI";
import { showToast } from "src/components/UIToast";
import { routeError } from "src/services/errors/route";
import { saveWorkSchedule, type WorkSchedule } from "src/services/quality/api";
import { cx } from "src/utils/cx";
import { translate } from "src/i18";
import { userDisplayName } from "src/models/_quality/people";
import { ISO_DAYS, dayLabel, formatWorkDays, normalizeHm, parseWorkDays, validateSchedule, type ScheduleDraft } from "./attendanceView";
import main from "src/styles/main.module.scss";
import styles from "./Attendance.module.scss";

interface Props {
	/** Редактируемый график; нет — новый. */
	schedule?: WorkSchedule | null;
	onClose: () => void;
	onDone: () => void;
}

export const ScheduleModal: FC<Props> = ({ schedule, onClose, onDone }) => {
	const [userName, setUserName] = useState(schedule?.userName ?? "");
	const [d, setD] = useState<ScheduleDraft>(() => ({
		userUuid: schedule?.userUuid ?? "",
		startTime: schedule?.startTime ?? "09:00",
		endTime: schedule?.endTime ?? "18:00",
		workDays: parseWorkDays(schedule?.workDays ?? "1,2,3,4,5"),
		graceMinutes: String(schedule?.graceMinutes ?? 10),
		isActive: schedule?.isActive ?? true,
	}));
	const [notices, setNotices] = useState<NoticeItem[]>([]);
	const [busy, setBusy] = useState(false);
	const patch = (p: Partial<ScheduleDraft>) => setD((prev) => ({ ...prev, ...p }));

	const apply = useCallback(async () => {
		if (busy) return;
		const errors = validateSchedule(d);
		setNotices(errors.map((k) => ({ type: "error" as const, text: translate(k) })));
		if (errors.length) return;
		setBusy(true);
		try {
			await saveWorkSchedule({
				userUuid: d.userUuid,
				startTime: normalizeHm(d.startTime),
				endTime: normalizeHm(d.endTime),
				workDays: formatWorkDays(d.workDays),
				graceMinutes: Number(d.graceMinutes),
				isActive: d.isActive,
			}, schedule?.uuid);
			showToast(translate("workScheduleSaved"), "success");
			onDone();
			onClose();
		} catch (e) {
			setNotices(routeError(e, { source: translate("AttendanceJournal") }));
		} finally {
			setBusy(false);
		}
	}, [busy, d, schedule?.uuid, onDone, onClose]);

	return (
		<Modal
			title={translate(schedule ? "workScheduleEditTitle" : "workScheduleNewTitle")}
			onClose={onClose}
			buttons={[
				{ label: translate("save"), onClick: () => void apply(), variant: "primary" },
				{ label: translate("cancel"), onClick: onClose, variant: "secondary" },
			]}
		>
			<div className={styles.ModalBody}>
				<GroupCol>
					{/* Сотрудника у существующего графика не меняют: график привязан к нему. */}
					<Group>
						<LookupField label={translate("employee")} name="work_schedule_user" endpoint="users" displayField="username" secondaryFields={["employee.fullName"]}
							value={d.userUuid} displayValue={userName} allowCreate={false} required minWidth={FIELD_WIDTH.lg}
							disabled={busy || !!schedule}
							onSelect={(uuid, display, item) => { patch({ userUuid: uuid }); setUserName(uuid ? userDisplayName(item, display) : ""); }} />
					</Group>
					<Group>
						<Field label={translate("workScheduleStart")} name="work_schedule_start" value={d.startTime} placeholder="09:00" maxLength={5}
							width={FIELD_WIDTH.sm} disabled={busy} onChange={(e) => patch({ startTime: e.target.value })} />
						<Field label={translate("workScheduleEnd")} name="work_schedule_end" value={d.endTime} placeholder="18:00" maxLength={5}
							width={FIELD_WIDTH.sm} disabled={busy} onChange={(e) => patch({ endTime: e.target.value })} />
						<Field label={translate("workScheduleGrace")} name="work_schedule_grace" value={d.graceMinutes} maxLength={3}
							width={FIELD_WIDTH.sm} disabled={busy} onChange={(e) => patch({ graceMinutes: e.target.value })}
							hint={translate("workScheduleGraceHint")} />
					</Group>
					<div className={styles.Days} role="group" aria-label={translate("workScheduleDays")}>
						<span className={styles.DaysLabel}>{translate("workScheduleDays")}</span>
						{ISO_DAYS.map((day, i) => (
							<label key={day} className={cx(main.SettingChip, d.workDays[i] && main.SettingChipActive)}>
								<input type="checkbox" checked={d.workDays[i]} disabled={busy}
									onChange={(e) => patch({ workDays: d.workDays.map((v, k) => (k === i ? e.target.checked : v)) })} />
								{dayLabel(day)}
							</label>
						))}
					</div>
					<Group>
						<FieldToggle label={translate("isActive")} value={d.isActive} disabled={busy} onChange={(v) => patch({ isActive: v })} />
					</Group>
				</GroupCol>
				<Notice inline items={notices} />
			</div>
		</Modal>
	);
};
ScheduleModal.displayName = "ScheduleModal";

export default ScheduleModal;
