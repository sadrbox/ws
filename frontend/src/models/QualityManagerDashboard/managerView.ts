/**
 * Панель руководителя (E17 СК4.2, п. 30) — чистые помощники: строки таблицы сотрудников,
 * признак «нарушения повторяются, а мер нет» и подписи.
 *
 * Флаги считает сервер (bonusRules.computeBonusResults): систематичность — N подтверждённых
 * нарушений за скользящее окно месяцев; «мер нет» — систематично, а записанной меры руководителя
 * нет. Это и есть сигнал п. 30: нарушение повторяется, руководителю известно, мер не принято.
 */
import { translate } from "src/i18";
import type { QualityTone } from "src/models/_quality/QualityChip";
import type { BonusRow, ManagerDashboardData } from "src/services/quality/api";
import { getFormatDateOnly } from "src/utils/datetime";
import { stableRowId } from "src/utils/stableRowId";

const ROLE_KEYS: Record<string, string> = {
	chief: "mgrDashRoleChief",
	member: "mgrDashRoleMember",
	manager: "mgrDashRoleManager",
};

export const roleLabel = (role: string | null | undefined): string => (role && ROLE_KEYS[role] ? translate(ROLE_KEYS[role]) : role ?? "");

/** Насколько строка требует внимания руководителя — для подсветки и сортировки. */
export type StaffAttention = "noMeasure" | "systematic" | "noBonus" | "candidates" | "ok";

export function staffAttention(r: Pick<BonusRow, "noMeasure" | "systematic" | "bonus" | "pendingCandidates">): StaffAttention {
	if (r.noMeasure) return "noMeasure";
	if (r.systematic) return "systematic";
	if (!r.bonus) return "noBonus";
	if ((r.pendingCandidates ?? 0) > 0) return "candidates";
	return "ok";
}

const ATTENTION_RANK: Record<StaffAttention, number> = { noMeasure: 4, systematic: 3, noBonus: 2, candidates: 1, ok: 0 };

export const attentionTone = (a: StaffAttention): QualityTone =>
	a === "noMeasure" || a === "noBonus" ? "bad" : a === "systematic" || a === "candidates" ? "warn" : "ok";

export interface StaffTableRow {
	id: number;
	uuid: string;
	mgrGroup: string;
	mgrEmployee: string;
	mgrRole: string;
	/** 1 — бонус начисляется, 0 — нет (для сортировки; показ — меткой). */
	mgrBonus: number;
	mgrConfirmed: number;
	mgrCandidates: number;
	mgrWindow: number;
	mgrSystematic: number;
	mgrNoMeasure: number;
	/** Ранг внимания — сортировка «сначала проблемные». */
	mgrAttention: number;
	source: BonusRow & { role: string };
	[key: string]: unknown;
}

/** Группы панели → одна таблица сотрудников (сотрудник в двух группах — две строки). */
export function toStaffRows(groups: ManagerDashboardData["groups"]): StaffTableRow[] {
	const taken = new Set<number>();
	const out: StaffTableRow[] = [];
	for (const g of groups ?? []) {
		for (const s of g.staff ?? []) {
			let id = stableRowId(`${g.uuid}:${s.userUuid}`);
			while (taken.has(id)) id = (id % 0x7fffffff) + 1;
			taken.add(id);
			out.push({
				id,
				uuid: `${g.uuid}:${s.userUuid}`,
				mgrGroup: g.name,
				mgrEmployee: s.userName ?? "",
				mgrRole: roleLabel(s.role),
				mgrBonus: s.bonus ? 1 : 0,
				mgrConfirmed: s.confirmedCount ?? 0,
				mgrCandidates: s.pendingCandidates ?? 0,
				mgrWindow: s.windowCount ?? 0,
				mgrSystematic: s.systematic ? 1 : 0,
				mgrNoMeasure: s.noMeasure ? 1 : 0,
				mgrAttention: ATTENTION_RANK[staffAttention(s)],
				source: s,
			});
		}
	}
	return out;
}

/** Подсказка к числу подтверждённых: пункты и суть нарушений месяца. */
export function violationsTitle(r: Pick<BonusRow, "violations">): string {
	return (r.violations ?? [])
		.map((v) => `${translate("mgrDashItem")} ${v.itemNumber} · ${getFormatDateOnly(v.detectedAt)} — ${v.description}`)
		.join("\n");
}

/** Итоги по всем группам — для строки сводки. */
export function managerTotals(groups: ManagerDashboardData["groups"]): { withoutBonus: number; candidates: number; systematic: number; noMeasure: number } {
	const t = { withoutBonus: 0, candidates: 0, systematic: 0, noMeasure: 0 };
	for (const g of groups ?? []) {
		t.withoutBonus += g.totals?.withoutBonus ?? 0;
		t.candidates += g.totals?.candidates ?? 0;
		t.systematic += g.totals?.systematic ?? 0;
		t.noMeasure += g.totals?.noMeasure ?? 0;
	}
	return t;
}
