/**
 * «Итоги месяца» (E17 СК5.4–СК5.5) — чистые правила экрана: строки таблицы, сводка нарушений,
 * меры руководителя, разбор отказа «сначала решите кандидатов».
 *
 * Отдельно от index.tsx (там только компоненты — Fast Refresh); проверяется юнит-тестом
 * src/__tests__/qualityBonus.test.ts.
 */
import { translate } from "src/i18";
import { MEASURE_KINDS, type BonusMonthData, type BonusRow } from "src/services/quality/api";
import { getFormatDateOnly } from "src/utils/datetime";
import { withStableIds } from "src/utils/stableRowId";
import { asText } from "src/utils/asText";
import { endOfLocalDayIso } from "src/models/_quality/month";

/** Строка таблицы: сотрудник итога + номер строки из его uuid (стабилен между перечитываниями). */
export type BonusTableRow = BonusRow & { id: number; uuid: string };

export function bonusRows(items: BonusRow[] | null | undefined): BonusTableRow[] {
	return withStableIds((items ?? []).map((r) => ({ ...r, uuid: r.userUuid })), (r) => r.userUuid);
}

/** «п. 3, п. 12» — какие пункты нарушены (без повторов, по порядку номеров). */
export function violationsSummary(violations: BonusRow["violations"] | null | undefined): string {
	const nums = [...new Set((violations ?? []).map((v) => Number(v.itemNumber)).filter((n) => n > 0))].sort((a, b) => a - b);
	const short = translate("violationItemShort");
	return nums.map((n) => `${short} ${n}`).join(", ");
}

/** Роль сотрудника в группе: так же, как её пишет сервер (manager | chief | member). */
const ROLE_KEYS: Record<string, string> = { manager: "bonusRoleManager", chief: "bonusRoleChief", member: "bonusRoleMember" };

export function roleLabel(role: unknown): string {
	return typeof role === "string" && ROLE_KEYS[role] ? translate(ROLE_KEYS[role]) : "";
}

// ── Меры руководителя (п. 30) ────────────────────────────────────────────────

export type MeasureKind = (typeof MEASURE_KINDS)[number];

const MEASURE_KEYS: Record<MeasureKind, string> = {
	talk: "measureKindTalk",
	training: "measureKindTraining",
	warning: "measureKindWarning",
	other: "measureKindOther",
};

export function measureKindLabel(kind: unknown): string {
	return (MEASURE_KINDS as readonly unknown[]).includes(kind) ? translate(MEASURE_KEYS[kind as MeasureKind]) : asText(kind);
}

export const measureKindOptions = () => MEASURE_KINDS.map((k) => ({ value: k, label: measureKindLabel(k) }));

/**
 * Дата меры «ГГГГ-ММ-ДД» → момент для сервера: КОНЕЦ этого местного дня.
 *
 * Сервер снимает «мер нет», если мера не раньше первого нарушения окна, и сравнивает моменты:
 * голая дата становилась 00:00Z (05:00 по Алматы), и мера, записанная в день нарушения (выявлено
 * в 14:00), оказывалась «раньше» него — метка не снималась (И24 аудита 26.09). Конец местного дня
 * делает сравнение по сути дневным; показ даты (getFormatDateOnly в поясе приложения) тот же день.
 * `offsetHours` — смещение пояса приложения (getAppUtcOffset).
 */
export function measureDateIso(ymd: string, offsetHours: number): string | null {
	return endOfLocalDayIso(ymd, offsetHours * 60);
}

/** Мера — конкретное действие руководителя: без описания она не ответ на «мер нет» (сервер: ≥ 5 знаков). */
export function validateMeasure(note: string): string | null {
	return note.trim().length < 5 ? "measureNeedNote" : null;
}

// ── Закрытие месяца ─────────────────────────────────────────────────────────

/**
 * Закрыть можно только прошедший месяц (И23 аудита 26.09). Текущий (он выбран по умолчанию) и
 * будущие закрывать нельзя: правила продолжают заводить кандидатов в месяц выявления, и после
 * закрытия подтверждение и отклонение отвечали бы 409 «месяц закрыт», пока месяц не откроют.
 * `current` — текущий месяц по местному времени (currentMonth); «ГГГГ-ММ» сравниваются строкой.
 */
export function isMonthOver(month: string, current: string): boolean {
	return /^\d{4}-\d{2}$/.test(month) && /^\d{4}-\d{2}$/.test(current) && month < current;
}

/**
 * Сервер не закрывает месяц с нерешёнными кандидатами и возражениями без подтверждения:
 * 409 с кодом NEEDS_CONFIRMATION и их числом. Возвращает это число или null — другой отказ.
 */
export function needsConfirmation(e: unknown): number | null {
	const r = (e as { response?: { status?: unknown; data?: { code?: unknown; pending?: unknown } } } | null)?.response;
	if (r?.status !== 409 || r.data?.code !== "NEEDS_CONFIRMATION") return null;
	const n = Number(r.data?.pending);
	return Number.isFinite(n) && n > 0 ? n : 1;
}

// ── Выгрузка для расчёта зарплаты ────────────────────────────────────────────

/**
 * Итоги месяца → таблица для Excel: строка заголовков и по строке на сотрудника, в порядке сервера.
 * Числа — числами (их складывают в расчёте), «да/нет» — словами. Нарушения — пунктом, датой и сутью:
 * расчётчику и сотруднику нужно видеть, за что бонус снят, не открывая ERP.
 */
export function bonusExportAoa(data: Pick<BonusMonthData, "items"> | null | undefined): unknown[][] {
	const yes = translate("bonusYes");
	const no = translate("bonusNo");
	const header = [
		"userName", "groupName", "bonusExportRole", "bonus", "confirmedCount", "bonusExportViolations",
		"pendingCandidates", "disputed", "bonusExportWindow", "systematic", "noMeasure",
	].map((k) => translate(k));
	const rows = (data?.items ?? []).map((r) => [
		r.userName,
		r.groupName ?? "",
		roleLabel(r.role),
		r.bonus ? yes : no,
		r.confirmedCount,
		(r.violations ?? []).map((v) => `${translate("violationItemShort")} ${v.itemNumber} (${getFormatDateOnly(v.detectedAt)}): ${v.description}`).join("; "),
		r.pendingCandidates,
		r.disputed,
		r.windowCount,
		r.systematic ? yes : "",
		r.noMeasure ? yes : "",
	]);
	return [header, ...rows];
}

/** Имя файла: месяц и пометка «предварительно», пока месяц не закрыт (итоги ещё могут измениться). */
export function bonusExportFileName(month: string, closed: boolean): string {
	return `bonus_${month}${closed ? "" : "_preliminary"}.xlsx`;
}
