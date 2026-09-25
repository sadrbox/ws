/**
 * Панель главбуха (E17 СК4.1, п. 29) — чистые помощники: цвет и подписи ячеек «клиент × участок»,
 * строки таблицы из ответа сервера, сортировка по тяжести.
 *
 * Состояние участка считает сервер (findingRules.areaState): red — ошибки или просрочки,
 * yellow — предупреждения или открытые задачи, green — чисто, none — проверки не приходили.
 * Здесь только показ: точка цвета + числа, а слово — в подсказке (цвет подсказывает, не решает).
 */
import { translate } from "src/i18";
import type { AreaCell, ChiefClientRow, RunStatus } from "src/services/quality/api";
import { AREA_LABEL_KEYS, QUALITY_AREAS, type QualityArea } from "src/services/quality/checkCatalog";
import { stableRowId } from "src/utils/stableRowId";

export type DotTone = "red" | "yellow" | "green" | "grey";

/** Цвет точки по состоянию сервера; неизвестное — серый («нет данных»), а не зелёный. */
export function areaTone(state: string | null | undefined): DotTone {
	if (state === "red") return "red";
	if (state === "yellow") return "yellow";
	if (state === "green") return "green";
	return "grey";
}

const STATE_RANK: Record<DotTone, number> = { red: 3, yellow: 2, green: 1, grey: 0 };

/**
 * Ключ сортировки ячейки: сначала цвет (красные выше), внутри цвета — просрочки, ошибки,
 * предупреждения. Числа ограничены, чтобы разряды не перетекали друг в друга.
 */
export function areaSortValue(cell: Partial<AreaCell> | null | undefined): number {
	if (!cell) return 0;
	const cap = (n: unknown) => Math.min(Math.max(Number(n) || 0, 0), 99);
	return STATE_RANK[areaTone(cell.state)] * 1_000_000 + cap(cell.overdue) * 10_000 + cap(cell.errors) * 100 + cap(cell.warnings);
}

/**
 * Числа в ячейке: «ошибки/предупреждения» и отдельно просрочки (их панель рисует красной меткой).
 * У чистого участка и участка без данных — пусто: точка уже всё сказала.
 */
export function areaCounts(cell: Partial<AreaCell> | null | undefined): { main: string; overdue: number } {
	if (!cell) return { main: "", overdue: 0 };
	const errors = Number(cell.errors) || 0;
	const warnings = Number(cell.warnings) || 0;
	return { main: errors || warnings ? `${errors}/${warnings}` : "", overdue: Number(cell.overdue) || 0 };
}

/** Слово к цвету — для подсказок и легенды. */
export const TONE_KEYS: Record<DotTone, string> = {
	red: "chiefDashToneRed",
	yellow: "chiefDashToneYellow",
	green: "chiefDashToneGreen",
	grey: "chiefDashToneGrey",
};

/** Подсказка ячейки: участок, состояние словом и все счётчики. */
export function areaTitle(area: QualityArea, cell: Partial<AreaCell> | null | undefined): string {
	const tone = areaTone(cell?.state);
	const lines = [
		`${translate(AREA_LABEL_KEYS[area])}: ${translate(TONE_KEYS[tone])}`,
		`${translate("chiefDashErrors")}: ${Number(cell?.errors) || 0}`,
		`${translate("chiefDashWarnings")}: ${Number(cell?.warnings) || 0}`,
		`${translate("chiefDashOverdue")}: ${Number(cell?.overdue) || 0}`,
		`${translate("chiefDashOpenTasks")}: ${Number(cell?.openTasks) || 0}`,
	];
	return lines.join("\n");
}

/** Идентификатор колонки участка = ключ перевода его подписи (заголовок = translate(identifier)). */
export const areaColumnId = (area: QualityArea): string => AREA_LABEL_KEYS[area];

/** Строка таблицы панели: плоские поля под колонки + исходная строка сервера для ячеек. */
export interface ChiefTableRow {
	id: number;
	uuid: string;
	chiefClient: string;
	chiefGroup: string;
	chiefResponsible: string;
	chiefLastRun: string;
	chiefRequests: number;
	chiefDeadlines: number;
	chiefPrimaryDocs: number;
	source: ChiefClientRow;
	[key: string]: unknown;
}

/** Строки сервера → строки таблицы. Значения колонок-участков — ключи сортировки (areaSortValue). */
export function toChiefTableRows(rows: readonly ChiefClientRow[]): ChiefTableRow[] {
	const taken = new Set<number>();
	return rows.map((r) => {
		// Клиент может стоять в двух группах — ключ строки учитывает группу.
		let id = stableRowId(`${r.organizationUuid}:${r.groupUuid}`);
		while (taken.has(id)) id = (id % 0x7fffffff) + 1;
		taken.add(id);
		const out: ChiefTableRow = {
			id,
			uuid: `${r.organizationUuid}:${r.groupUuid}`,
			chiefClient: r.name,
			chiefGroup: r.groupName,
			chiefResponsible: r.responsibleName ?? "",
			chiefLastRun: r.lastRunAt ?? "",
			chiefRequests: areaSortValue({ state: r.requests?.state, overdue: r.requests?.overdueReaction, errors: r.requests?.unaccepted, warnings: r.requests?.open }),
			chiefDeadlines: areaSortValue({ state: r.deadlines?.state, overdue: r.deadlines?.overdue, warnings: r.deadlines?.open }),
			chiefPrimaryDocs: r.primaryDocs?.received ? (r.primaryDocs.complete ? 2 : 1) : 0,
			source: r,
		};
		for (const a of QUALITY_AREAS) out[areaColumnId(a)] = areaSortValue(r.areas?.[a]);
		return out;
	});
}

/** Первичка прошлого месяца: получена полностью, частично или отметки нет. */
export function primaryDocsTone(p: ChiefClientRow["primaryDocs"] | null | undefined): DotTone {
	if (!p?.received) return "grey";
	return p.complete ? "green" : "yellow";
}

/** Сводка по видимым клиентам: сколько клиентов с красным и жёлтым хоть где-то. */
export function chiefSummary(rows: readonly ChiefClientRow[]): { clients: number; red: number; yellow: number } {
	let red = 0;
	let yellow = 0;
	for (const r of rows) {
		const tones = [...QUALITY_AREAS.map((a) => areaTone(r.areas?.[a]?.state)), areaTone(r.requests?.state), areaTone(r.deadlines?.state)];
		if (tones.includes("red")) red++;
		else if (tones.includes("yellow")) yellow++;
	}
	return { clients: rows.length, red, yellow };
}

/**
 * Проверки базы клиента — словом и цветом. Главное — отличить «чисто» от «не проверено»: серый участок
 * при упавшем прогоне выглядел бы спокойно, а база на деле не проверялась. Дата — последнего успешного.
 */
export function runStatusView(rs: RunStatus | null | undefined, lastRunAt: string | null | undefined): { tone: DotTone; labelKey: string; detail: string } {
	const state = rs?.state ?? (lastRunAt ? "ok" : "never");
	const detail = [rs?.message, rs?.code ? `(${rs.code})` : null].filter(Boolean).join(" ");
	switch (state) {
		case "error": return { tone: "red", labelKey: "chiefDashRunError", detail };
		case "unavailable": return { tone: "grey", labelKey: "chiefDashRunUnavailable", detail: detail || translate("chiefDashRunUnavailableHint") };
		// Нет прав у пользователя API в базе: дело администратора базы, а не сбой. Красный — без прав
		// проверка не видит учёт, и база только выглядит чистой. Какого объекта не хватает — в тексте 1С.
		case "access": return { tone: "red", labelKey: "chiefDashRunAccess", detail: [detail, translate("chiefDashRunAccessHint")].filter(Boolean).join(" — ") };
		case "stale": return { tone: "yellow", labelKey: "chiefDashRunStale", detail };
		case "never": return { tone: "grey", labelKey: "chiefDashNoRuns", detail };
		default: return { tone: "green", labelKey: "chiefDashRunOk", detail };
	}
}

/** Сколько клиентов не проверено (прогон упал), у скольких проверки недоступны или нет прав — для сообщения над панелью. */
export function runStatusCounts(rows: readonly ChiefClientRow[]): { failed: number; unavailable: number; access: number; stale: number } {
	const out = { failed: 0, unavailable: 0, access: 0, stale: 0 };
	const seen = new Set<string>();
	for (const r of rows) {
		// Клиент в двух группах — одна база: считаем один раз.
		if (seen.has(r.organizationUuid)) continue;
		seen.add(r.organizationUuid);
		const st = r.runStatus?.state;
		if (st === "error") out.failed++;
		else if (st === "unavailable") out.unavailable++;
		else if (st === "access") out.access++;
		else if (st === "stale") out.stale++;
	}
	return out;
}
