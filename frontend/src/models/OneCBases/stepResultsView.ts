/**
 * Итоги по шагам в «Обслуживании» базы (28.09): проверка BuhProf в базе (ПН6) и самопроверка агента (R4) — строки и
 * колонки для SubTableSheets, без JSX (Fast Refresh, проверяются тестом).
 *
 * «Не сказали» — не отказ: у проверки BuhProf `ok === null` даёт «—», а не «не удалось». Красить незнание в поломку
 * значит гонять администратора чинить целое. Признак `__ok` едет рядом с текстом — по нему таблица красит отказ.
 */
import { translate } from "src/i18";
import type { TColumn, TDataItem } from "src/components/Table/types";
import type { SelfCheckResult, SelftestResult } from "src/services/onec/api";
import { withStableIds } from "src/utils/stableRowId";
import { selfCheckLines } from "./selfCheckView";

/** Колонка итога — общая у обеих таблиц: по ней таблица узнаёт, что красить. */
export const STEP_RESULT_COLUMN = "onecSelftestResult";

export type StepRow = TDataItem & { __ok: boolean | null };

// identifier — ключ перевода заголовка (getTranslateColumn).
const column = (identifier: string, width: string, minWidth: string): TColumn => ({
	identifier, type: "string", width, minWidth, alignment: "left", visible: true, inlist: true,
});

export const SELF_CHECK_COLUMNS: TColumn[] = [
	column("onecSelfCheckStep", "260px", "140px"),
	column(STEP_RESULT_COLUMN, "130px", "100px"),
	column("onecSelfCheckDetail", "320px", "160px"),
];

export const SELFTEST_COLUMNS: TColumn[] = [
	column("onecSelftestStep", "260px", "140px"),
	column(STEP_RESULT_COLUMN, "130px", "100px"),
	column("onecSelftestNote", "320px", "160px"),
];

/** Итог шага словом: null — «—», незнание не выдаётся ни за успех, ни за отказ. */
export function stepResultText(ok: boolean | null): string {
	return ok === null ? "—" : ok ? translate("onecSelftestOk") : translate("onecSelftestFail");
}

export function selfCheckRows(result: SelfCheckResult | null): StepRow[] {
	return withStableIds(selfCheckLines(result), (l, i) => `${i}-${l.title}`).map((l, i) => ({
		id: l.id,
		uuid: `${i}-${l.title}`,
		onecSelfCheckStep: l.title,
		[STEP_RESULT_COLUMN]: stepResultText(l.ok),
		onecSelfCheckDetail: [l.detail, l.hint].filter(Boolean).join(" · "),
		__ok: l.ok,
	}));
}

/** Шаг самопроверки агента всегда отвечает да или нет: без признака он считается неудачным, как и в тосте. */
export function selftestRows(result: SelftestResult | null): StepRow[] {
	return withStableIds(result?.steps ?? [], (s, i) => `${i}-${s.name}`).map((s, i) => ({
		id: s.id,
		uuid: `${i}-${s.name}`,
		onecSelftestStep: s.name,
		[STEP_RESULT_COLUMN]: stepResultText(!!s.ok),
		onecSelftestNote: s.note ?? "",
		__ok: !!s.ok,
	}));
}
