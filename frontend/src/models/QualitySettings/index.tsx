/**
 * Настройки учёта качества (E17): организация-фирма, сроки и пороги правил, Telegram.
 *
 * Раздел для всех: Telegram каждый подключает себе сам. Сроки и пороги меняют администратор и
 * руководитель (canManage), остальные видят их только для чтения; организацию-фирму назначает
 * только администратор. Сервер проверяет каждое действие ещё раз.
 *
 * ПРОВЕРИТЬ ПОТОМ: все значения по умолчанию — предложение разработчика, владелец их не
 * утверждал (план, «Решения владельца», пп. 3–6: SLA, сроки находок, порог систематичности,
 * отметка прихода). Поэтому рядом с каждым полем показано умолчание, а над экраном — сообщение
 * «Проверить потом».
 */
import { type FC, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { translate } from "src/i18";
import { Field, FieldDate, FieldNumber, FieldSelect } from "src/components/Field";
import FieldToggle from "src/components/Field/FieldToggle";
import { FIELD_WIDTH } from "src/components/Field/fieldWidths";
import { Button } from "src/components/Button";
import { FormArea, Group, GroupCol } from "src/components/UI";
import Notice, { type NoticeItem } from "src/components/Notice";
import { showToast } from "src/components/UIToast";
import { useAppContext } from "src/app/context";
import { usePaneToolbar } from "src/hooks/usePaneToolbar";
import { useQualityMe } from "src/hooks/useQualityMe";
import { routeError } from "src/services/errors/route";
import { fetchQualitySettings, saveQualitySettings } from "src/services/quality/api";
import { fillTemplate } from "src/models/_quality/text";
import { ISO_DAYS, dayLabel, formatWorkDays, parseWorkDays, workDaysText } from "src/models/_quality/workWeek";
import { WorkCalendarView } from "src/registry/viewRegistry";
import { cx } from "src/utils/cx";
import FirmSection from "./FirmSection";
import TelegramSection from "./TelegramSection";
import {
	ATTENDANCE_SOURCES, SETTING_SECTIONS, fieldValue, formToSettings, isSettingsDirty, rebaseForm, settingsToForm,
	type SettingField, type SettingsFormValues, type SettingsWithEffective,
} from "./settingsForm";
import main from "src/styles/main.module.scss";
import styles from "./QualitySettings.module.scss";

const COMPONENT = "QualitySettingsView";
const SETTINGS_KEY = ["quality", "settings"] as const;

const ATTENDANCE_KEYS: Record<string, string> = {
	button: "qualitySettingsAttendanceButton",
	login: "qualitySettingsAttendanceLogin",
	both: "qualitySettingsAttendanceBoth",
};

export const QualitySettingsView: FC<{ uniqId?: string }> = ({ uniqId }) => {
	const queryClient = useQueryClient();
	const { addPane } = useAppContext().windows;
	const { me, canManage } = useQualityMe();
	const q = useQuery({ queryKey: SETTINGS_KEY, queryFn: fetchQualitySettings, staleTime: 30_000 });
	const saved = q.data?.settings as SettingsWithEffective | undefined;
	const defaults = q.data?.defaults as SettingsWithEffective | undefined;
	const [form, setForm] = useState<SettingsFormValues>(() => settingsToForm(saved));
	const [busy, setBusy] = useState(false);
	const [notices, setNotices] = useState<NoticeItem[]>([]);

	// Пришли свежие настройки (после записи, назначения фирмы, «Обновить»): нетронутые поля берут
	// новые значения, несохранённые правки человека остаются (rebaseForm).
	const prevSaved = useRef<SettingsWithEffective | undefined>(undefined);
	useEffect(() => {
		if (!saved) return;
		setForm((f) => rebaseForm(f, prevSaved.current, saved));
		prevSaved.current = saved;
	}, [saved]);

	const dirty = useMemo(() => !!saved && isSettingsDirty(form, saved), [form, saved]);
	const off = !canManage || busy || !saved;

	const setValue = useCallback((key: string, value: string) => {
		setForm((prev) => ({ ...prev, values: { ...prev.values, [key]: value } }));
	}, []);

	const save = useCallback(async () => {
		const r = formToSettings(form, saved);
		if ("error" in r) {
			const e = r.error;
			const text = "field" in e
				? fillTemplate(translate("qualitySettingsBadValue"), {
					field: translate(e.field.labelKey), min: e.field.min, max: e.field.max ?? "∞",
				})
				: "workHours" in e ? translate("qualitySettingsBadWorkHours")
				: "workDays" in e ? translate("qualitySettingsBadWorkDays")
				: translate("qualitySettingsBadDate");
			setNotices([{ type: "error", text }]);
			return;
		}
		setBusy(true);
		setNotices([]);
		try {
			await saveQualitySettings({ settings: r.settings });
			showToast(translate("qualitySettingsSaved"), "success");
			// Настройки читают все экраны качества (итоги месяца, реестр) — перечитываем раздел.
			await queryClient.invalidateQueries({ queryKey: ["quality"] });
		} catch (e) {
			setNotices(routeError(e, { source: translate(COMPONENT), fallback: translate("qualitySettingsSaveFailed") }));
		} finally {
			setBusy(false);
		}
	}, [form, saved, queryClient]);

	const reset = useCallback(() => {
		setForm(settingsToForm(saved));
		setNotices([]);
	}, [saved]);

	const toolbar = usePaneToolbar(uniqId, (
		<>
			{canManage && (
				<Button variant="primary" onClick={() => void save()} disabled={off || !dirty}>{translate("save")}</Button>
			)}
			{canManage && dirty && <Button onClick={reset} disabled={busy}>{translate("qualitySettingsReset")}</Button>}
			<Button onClick={() => void q.refetch()} disabled={q.isFetching}>{translate("refresh")}</Button>
		</>
	));

	const defaultHint = (field: SettingField) => {
		const d = fieldValue(defaults, field);
		return d ? fillTemplate(translate("qualitySettingsDefault"), { value: d }) : undefined;
	};

	const renderField = (field: SettingField) => (
		<FieldNumber key={field.key} label={translate(field.labelKey)} name={`quality_settings_${field.key}`}
			value={form.values[field.key] ?? ""} onChange={(e) => setValue(field.key, e.target.value)}
			disabled={off} width={FIELD_WIDTH.amount} decimals={field.percent ? 2 : 0}
			min={String(field.min)} max={field.max !== undefined ? String(field.max) : undefined}
			hint={defaultHint(field)} />
	);

	// «Проверить потом» — всегда: умолчания не утверждены владельцем.
	const info: NoticeItem[] = [{ type: "info", text: translate("qualitySettingsDefaultsUnapproved") }];
	const attendanceDefault = defaults?.attendance?.source;
	const weekFlags = parseWorkDays(form.workDays);
	const toggleDay = (i: number, on: boolean) =>
		setForm((p) => ({ ...p, workDays: formatWorkDays(parseWorkDays(p.workDays).map((v, k) => (k === i ? on : v))) }));
	const hoursDefault = defaults?.workHours ? `${defaults.workHours.start}–${defaults.workHours.end}` : "";

	return (
		<>
			{toolbar}
			<div className={main.PaneFill}>
				<div className={styles.Body}>
					<FirmSection firmName={me?.firmOrganizationName ?? null} firmExplicit={me?.firmExplicit ?? q.data?.firmExplicit ?? false}
						isAdmin={!!me?.isAdmin} />

					<FormArea title={translate("qualitySettingsEffectiveTitle")}>
						<GroupCol gap={6}>
							<FieldDate label={translate("qualitySettingsEffectiveFrom")} name="quality_settings_effectiveFrom" width={FIELD_WIDTH.date}
								value={form.effectiveFrom} disabled={off} onChange={(e) => setForm((p) => ({ ...p, effectiveFrom: e.target.value }))}
								hint={translate("qualitySettingsEffectiveHint")} />
						</GroupCol>
					</FormArea>

					{/* Рабочее время — раньше сроков: SLA, находки и проверка исправления считаются в нём. */}
					<FormArea title={translate("qualitySettingsWorkTime")}>
						<GroupCol gap={6}>
							<span className={main.SettingHint}>{translate("qualitySettingsWorkTimeHint")}</span>
							<Group className={styles.Fields}>
								<Field label={translate("qualitySettingsWorkStart")} name="quality_settings_workStart" value={form.workStart} placeholder="09:00"
									maxLength={5} width={FIELD_WIDTH.sm} disabled={off} onChange={(e) => setForm((p) => ({ ...p, workStart: e.target.value }))}
									hint={hoursDefault ? fillTemplate(translate("qualitySettingsDefault"), { value: hoursDefault }) : undefined} />
								<Field label={translate("qualitySettingsWorkEnd")} name="quality_settings_workEnd" value={form.workEnd} placeholder="18:00"
									maxLength={5} width={FIELD_WIDTH.sm} disabled={off} onChange={(e) => setForm((p) => ({ ...p, workEnd: e.target.value }))} />
							</Group>
							<div className={styles.Days} role="group" aria-label={translate("qualitySettingsWorkDays")}>
								<span className={styles.DaysLabel}>{translate("qualitySettingsWorkDays")}</span>
								{ISO_DAYS.map((day, i) => (
									<label key={day} className={cx(main.SettingChip, weekFlags[i] && main.SettingChipActive, off && main.SettingChipReadonly)}>
										<input type="checkbox" checked={weekFlags[i]} disabled={off} onChange={(e) => toggleDay(i, e.target.checked)} />
										{dayLabel(day)}
									</label>
								))}
								{defaults?.workDays && (
									<span className={main.SettingHint}>{fillTemplate(translate("qualitySettingsDefault"), { value: workDaysText(defaults.workDays) })}</span>
								)}
							</div>
							<FieldToggle label={translate("qualitySettingsSlaWorkingTime")} value={form.slaWorkingTime} disabled={off}
								onChange={(v) => setForm((p) => ({ ...p, slaWorkingTime: v }))} />
							<span className={main.SettingHint}>{translate("qualitySettingsSlaWorkingTimeHint")}</span>
							<div>
								<Button onClick={() => addPane({ component: WorkCalendarView, label: translate("WorkCalendarView") })}>
									{translate("qualitySettingsOpenCalendar")}
								</Button>
							</div>
						</GroupCol>
					</FormArea>

					{SETTING_SECTIONS.map((section) => (
						<FormArea key={section.key} title={translate(section.titleKey)}>
							<GroupCol gap={6}>
								{section.hintKey && <span className={main.SettingHint}>{translate(section.hintKey)}</span>}
								<Group className={styles.Fields}>
									{section.fields.map(renderField)}
									{section.key === "attendance" && (
										<FieldSelect label={translate("qualitySettingsAttendanceSource")} name="quality_settings_attendanceSource"
											value={form.attendanceSource} disabled={off}
											onChange={(e) => setForm((p) => ({ ...p, attendanceSource: e.target.value }))}
											options={ATTENDANCE_SOURCES.map((s) => ({ value: s, label: translate(ATTENDANCE_KEYS[s]) }))}
											hint={attendanceDefault
												? fillTemplate(translate("qualitySettingsDefault"), { value: translate(ATTENDANCE_KEYS[attendanceDefault] ?? attendanceDefault) })
												: undefined} />
									)}
								</Group>
								{/* Решено 25.09: «кнопка или первый вход» — забытая кнопка не делает работающего прогульщиком. СКУД — когда появится. */}
								{section.key === "attendance" && <span className={main.SettingHint}>{translate("qualitySettingsAttendanceBothHint")}</span>}
							</GroupCol>
						</FormArea>
					))}

					<TelegramSection />
				</div>
			</div>
			<Notice items={[...info, ...notices]} />
		</>
	);
};
QualitySettingsView.displayName = COMPONENT;

export default QualitySettingsView;
