// ─────────────────────────────────────────────────────────────────────────────
// Организации, по которым строится отчёт (Б6 аудита 26.09).
//
// БЫЛО. Отчёты (ОСВ, журнал, карточка счёта, взаиморасчёты, отчёты по продажам,
// материальная ведомость) брали tenantFilter, а потом `?organizationUuid=` ПЕРЕЗАПИСЫВАЛ
// его: любой пользователь открывал ОСВ и выручку чужой организации, подставив её uuid.
// А материальная ведомость без параметра у пользователя без активной организации (и у
// суперадмина) суммировала все организации сразу — и выручку считала вовсе без фильтра.
//
// СТАЛО. Организация из запроса пересекается с доступными (orgIsAccessible из utils/auth.js —
// членство + обслуживание; суперадмин — если ему открыты данные): недоступна → 403. Без
// параметра — ровно то, что даёт tenantFilter (активная организация, либо все доступные в
// сводном виде, либо все — суперадмину).
// ─────────────────────────────────────────────────────────────────────────────
import { tenantFilter, orgIsAccessible } from "../utils/auth.js";

/** Отказ по организации отчёта. */
export class ReportScopeError extends Error {
	constructor(status, message) {
		super(message);
		this.name = "ReportScopeError";
		this.status = status;
	}
}

/**
 * Организации отчёта.
 * @returns {string[]|null} список uuid; null — без ограничения (суперадмин без параметра);
 *   [] — пользователю не доступна ни одна организация (отчёт пустой).
 * @throws {ReportScopeError} 403 — запрошенная организация недоступна.
 */
export function reportOrgs(req, organizationUuid) {
	const org = typeof organizationUuid === "string" && organizationUuid.trim() ? organizationUuid.trim() : null;
	if (org) {
		if (!orgIsAccessible(req, org)) throw new ReportScopeError(403, "Нет доступа к организации");
		return [org];
	}
	const tf = tenantFilter(req);
	if (!("organizationUuid" in tf)) return null;
	const v = tf.organizationUuid;
	if (v === null) return [];
	if (typeof v === "string") return [v];
	if (Array.isArray(v?.in)) return v.in;
	return [];
}

/**
 * Ровно одна организация — для отчётов, где смешение организаций бессмысленно
 * (материальная ведомость: себестоимость считается по учётной политике организации).
 * Без параметра берётся активная организация пользователя.
 */
export function reportSingleOrg(req, organizationUuid) {
	const orgs = reportOrgs(req, organizationUuid || req.user?.organizationUuid || null);
	if (orgs === null || orgs.length !== 1) {
		throw new ReportScopeError(400, "Выберите организацию: отчёт строится по одной организации");
	}
	return orgs[0];
}

/** Условие Prisma по полю организации для списка организаций отчёта. */
export function orgWhere(orgs, field = "organizationUuid") {
	if (orgs === null) return {};
	return { [field]: { in: orgs } };
}

/** Маппинг ReportScopeError → HTTP. true — ответ отправлен. */
export function respondReportScopeError(err, res) {
	if (err instanceof ReportScopeError) {
		res.status(err.status).json({ success: false, message: err.message });
		return true;
	}
	return false;
}

export default { reportOrgs, reportSingleOrg, orgWhere, ReportScopeError, respondReportScopeError };
