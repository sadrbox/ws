/**
 * День производственного календаря: праздник, перенесённый выходной или рабочий день-перенос.
 *
 * Вносит администратор — то, чего закон сам не даёт: переносы дней отдыха по постановлению
 * Правительства и дату Курбан айта. Запись по той же дате заменяет прежнюю (POST /work-calendar — upsert).
 */
import { FC, useCallback, useState } from "react";
import Modal from "src/components/Modal";
import Notice, { type NoticeItem } from "src/components/Notice";
import { Field, FieldDate, FieldSelect } from "src/components/Field";
import { FIELD_WIDTH } from "src/components/Field/fieldWidths";
import { Group, GroupCol } from "src/components/UI";
import { showToast } from "src/components/UIToast";
import { routeError } from "src/services/errors/route";
import { saveWorkCalendarDay, type CalendarKind } from "src/services/quality/api";
import { translate } from "src/i18";
import { CALENDAR_KINDS, kindLabel, validateDay } from "./calendarView";
import styles from "./WorkCalendar.module.scss";

export interface DayDraft {
	date: string;
	kind: CalendarKind;
	name: string;
}

interface Props {
	day: DayDraft;
	/** Дата уже есть в календаре — меняем её, а не выбираем другую. */
	existing: boolean;
	onClose: () => void;
	onDone: () => void;
}

export const DayModal: FC<Props> = ({ day, existing, onClose, onDone }) => {
	const [d, setD] = useState<DayDraft>(day);
	const [notices, setNotices] = useState<NoticeItem[]>([]);
	const [busy, setBusy] = useState(false);
	const patch = (p: Partial<DayDraft>) => setD((prev) => ({ ...prev, ...p }));

	const apply = useCallback(async () => {
		if (busy) return;
		const errors = validateDay(d);
		setNotices(errors.map((k) => ({ type: "error" as const, text: translate(k) })));
		if (errors.length) return;
		setBusy(true);
		try {
			await saveWorkCalendarDay({ date: d.date, kind: d.kind, name: d.name.trim() || undefined });
			showToast(translate("workCalendarSaved"), "success");
			onDone();
			onClose();
		} catch (e) {
			setNotices(routeError(e, { source: translate("WorkCalendarView") }));
		} finally {
			setBusy(false);
		}
	}, [busy, d, onDone, onClose]);

	return (
		<Modal
			title={translate(existing ? "workCalendarEditTitle" : "workCalendarNewTitle")}
			onClose={onClose}
			buttons={[
				{ label: translate("save"), onClick: () => void apply(), variant: "primary" },
				{ label: translate("cancel"), onClick: onClose, variant: "secondary" },
			]}
		>
			<div className={styles.ModalBody}>
				<GroupCol>
					<Group>
						<FieldDate label={translate("wcDate")} name="work_calendar_date" value={d.date} width={FIELD_WIDTH.date}
							disabled={busy || existing} onChange={(e) => patch({ date: e.target.value })} />
						<FieldSelect label={translate("wcKind")} name="work_calendar_kind" value={d.kind} disabled={busy}
							onChange={(e) => patch({ kind: e.target.value as CalendarKind })}
							options={CALENDAR_KINDS.map((k) => ({ value: k, label: kindLabel(k) }))} />
					</Group>
					<Field label={translate("wcName")} name="work_calendar_name" value={d.name} maxLength={200} minWidth={FIELD_WIDTH.lg}
						disabled={busy} onChange={(e) => patch({ name: e.target.value })} hint={translate("workCalendarKindHint")} />
				</GroupCol>
				<Notice inline items={notices} />
			</div>
		</Modal>
	);
};

export default DayModal;
