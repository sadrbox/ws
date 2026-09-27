// Бонус и нарушения (E17 СК5) — чистые правила без Prisma.
//
// Правила применения бонуса (приложение А плана):
//  * один подтверждённый факт нарушения — бонус за месяц не начисляется полностью;
//  * самовыявленная и своевременно исправленная ошибка нарушением не считается;
//  * нарушение учитывается в месяце ВЫЯВЛЕНИЯ, а не совершения («ошибки не сгорают»);
//  * повторяемость — уже вопрос соответствия должности (флаг систематичности).

import { addMonths } from "./time.js";
import { calendarDateOf, orgTimeZone } from "../periodBounds.js";

/** Местная дата значения числом ГГГГММДД — для сравнения дней; пусто/мусор → null. */
const dayKey = (value, tz) => {
	const c = calendarDateOf(value, tz);
	return c ? c.y * 10000 + c.m * 100 + c.d : null;
};

export const VIOLATION_STATUSES = ["candidate", "confirmed", "disputed", "rejected"];
export const MEASURE_KINDS = ["talk", "training", "warning", "other"];

/** Идёт ли нарушение в бонус: подтверждено, не самовыявлено, не удалено. */
export function countsForBonus(v) {
	return !!v && v.status === "confirmed" && !v.selfDetected && !v.deletedAt;
}

/** Месяцы окна систематичности, заканчивая `month` включительно. */
export function windowMonths(month, n) {
	const out = [];
	for (let i = n - 1; i >= 0; i--) out.push(addMonths(month, -i));
	return out;
}

/**
 * Итог месяца по сотрудникам.
 * @param {{month:string, staff:{userUuid:string,userName?:string,groupName?:string,role?:string}[],
 *          violations:object[], measures?:object[], settings:object}} p
 *   violations — ВСЕ нарушения окна систематичности (для флага), не только месяца;
 *   tz — пояс организации (IANA, services/periodBounds.js); по умолчанию — пояс установки.
 */
export function computeBonusResults({ month, staff, violations, measures = [], settings, tz = orgTimeZone() }) {
	const n = settings?.violations?.systematicMonths ?? 3;
	const threshold = settings?.violations?.systematicThreshold ?? 3;
	const window = new Set(windowMonths(month, n));
	const byUser = new Map();
	for (const s of staff) byUser.set(s.userUuid, { ...s, confirmed: [], candidates: 0, disputed: 0, windowCount: 0, firstWindowAt: null });
	const ensure = (uid) => {
		if (!byUser.has(uid)) byUser.set(uid, { userUuid: uid, confirmed: [], candidates: 0, disputed: 0, windowCount: 0, firstWindowAt: null });
		return byUser.get(uid);
	};
	for (const v of violations) {
		if (v.deletedAt) continue;
		const row = ensure(v.userUuid);
		if (v.bonusMonth === month) {
			if (countsForBonus(v)) row.confirmed.push(v);
			else if (v.status === "candidate") row.candidates++;
			else if (v.status === "disputed") row.disputed++;
		}
		if (countsForBonus(v) && window.has(v.bonusMonth)) {
			row.windowCount++;
			const at = new Date(v.detectedAt);
			if (!row.firstWindowAt || at < row.firstWindowAt) row.firstWindowAt = at;
		}
	}
	return [...byUser.values()]
		.map((r) => {
			const systematic = r.windowCount >= threshold;
			// Мера не раньше первого нарушения окна — реакция была (п. 30). Сравниваются МЕСТНЫЕ ДАТЫ, а не
			// моменты (И24): дата меры хранится моментом — старые записи голой датой (00:00Z, 05:00 по Алматы),
			// новые — концом местного дня, — а нарушение выявляется среди дня; мера в день выявления — реакция.
			const first = r.firstWindowAt ? dayKey(r.firstWindowAt, tz) : null;
			const measured = first != null && measures.some((m) => !m.deletedAt && m.userUuid === r.userUuid && (dayKey(m.date, tz) ?? -1) >= first);
			return {
				userUuid: r.userUuid,
				userName: r.userName ?? r.userUuid,
				groupName: r.groupName ?? null,
				role: r.role ?? null,
				bonus: r.confirmed.length === 0,
				confirmedCount: r.confirmed.length,
				violations: r.confirmed.map((v) => ({ uuid: v.uuid, itemNumber: v.itemNumber, description: v.description, detectedAt: v.detectedAt })),
				pendingCandidates: r.candidates,
				disputed: r.disputed,
				windowCount: r.windowCount,
				systematic,
				// Нарушения повторяются, а меры нет — сигнал руководителю и его руководителю.
				noMeasure: systematic && !measured,
			};
		})
		.sort((a, b) => Number(a.bonus) - Number(b.bonus) || b.confirmedCount - a.confirmedCount || String(a.userName).localeCompare(String(b.userName), "ru"));
}

/**
 * Можно ли менять нарушение: месяц бонуса не закрыт. Закрытый месяц — снимок, который уже
 * ушёл в расчёт; правка задним числом разошлась бы с выплаченным.
 */
export function monthLocked(bonusMonth, closedMonths) {
	return closedMonths.has(bonusMonth);
}

export default { VIOLATION_STATUSES, MEASURE_KINDS, countsForBonus, windowMonths, computeBonusResults, monthLocked };
