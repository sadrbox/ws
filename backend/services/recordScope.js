// ОБЛАСТЬ ЗАПИСИ: «организации» или «общая» (Г3 плана PLAN_INSTALL_MODES_2026-09-24.md).
//
// ЗАЧЕМ. У справочников поле `organizationUuid` НЕОБЯЗАТЕЛЬНОЕ, и пустое значение означает
// «запись ничья, общая для всех организаций установки». Механизм есть давно, а правила к нему
// нет — и он понимался тремя разными способами: список справочника общие записи НЕ показывал,
// лукап в документе показывал, план счетов имел свой третий фильтр. То есть общий контрагент был
// невидим в справочнике, но выбирался в документе.
//
// РЕШЕНИЕ ВЛАДЕЛЬЦА (24.09): общие записи разрешены ПО РЕЖИМУ УСТАНОВКИ и не для всех предметов.
//
//   group    — разрешены там, где дублирование мешает сводной отчётности: контрагенты, товары,
//              бренды, типы цен. Три карточки одного поставщика на три юрлица холдинга — это
//              три разные истории расчётов, которые потом склеивают вручную по БИН;
//   isolated — ЗАПРЕЩЕНЫ вовсе. Арендаторы друг другу посторонние, и общий справочник у них —
//              не удобство, а утечка: видно, с кем работает сосед;
//   service  — запрещены. Общий контрагент у двух клиентов обслуживающей фирмы означает
//              перемешанный учёт разных юридических лиц.
//
// ВСЕГДА ПРИНАДЛЕЖАТ ОРГАНИЗАЦИИ, при любом режиме: склады и кассы. Это физические объекты
// конкретного юрлица, и «общий склад» не имеет смысла ни в учёте, ни в жизни.
//
// БЕЗ PRISMA: правила проверяются тестом в гейте и читаются установщиком.

/** Предметы, где общая запись осмысленна (при разрешающем режиме). */
export const SHARED_CAPABLE = ["Counterparty", "Product", "Brand", "PriceType", "UnitOfMeasure", "Currency", "Tax", "ChartOfAccount", "SubkontoType"];

/** Предметы, которые принадлежат организации ВСЕГДА — независимо от режима. */
export const ALWAYS_ORG_SCOPED = ["Warehouse", "Cashbox", "BankAccount", "Employee", "Position"];

/**
 * Разрешает ли режим установки общие записи вообще.
 * Режим не выбран (`null`) — считаем, что разрешены: на работающей установке общие записи уже
 * могут быть (у нас это весь план счетов), и прятать их из-за ненастроенного режима нельзя.
 */
export function modeAllowsShared(mode) {
	if (!mode) return true;
	return mode === "group";
}

/** Может ли у этого предмета быть общая запись при данном режиме. */
export function sharedAllowed(model, mode) {
	if (ALWAYS_ORG_SCOPED.includes(model)) return false;
	if (!SHARED_CAPABLE.includes(model)) return false;
	return modeAllowsShared(mode);
}

/**
 * Какую область выбрать для НОВОЙ записи.
 *
 * Общую создаёт только тот, кто распоряжается организацией: общая запись видна всем, и завести
 * её «нечаянно» — значит показать своего поставщика соседнему юрлицу.
 *
 * @returns {"organization"|"shared"} и причина отказа, если общую нельзя
 */
export function resolveNewScope({ requested, model, mode, isOrgAdmin = false }) {
	if (requested !== "shared") return { scope: "organization", reason: null };
	if (!sharedAllowed(model, mode)) {
		return {
			scope: "organization",
			reason: ALWAYS_ORG_SCOPED.includes(model)
				? "OBJECT_IS_ORG_BOUND"   // склад/касса — физический объект юрлица
				: "MODE_FORBIDS_SHARED",  // изолированные арендаторы и обслуживание
		};
	}
	if (!isOrgAdmin) return { scope: "organization", reason: "NOT_ALLOWED_TO_SHARE" };
	return { scope: "shared", reason: null };
}

/**
 * Показывать ли общие записи в СПИСКЕ предмета.
 *
 * Правило одно на все витрины — в этом и была беда: список, лукап и план счетов отвечали
 * по-разному, и человек видел разное в зависимости от того, откуда смотрит.
 */
export function listIncludesShared(model, mode) {
	return sharedAllowed(model, mode);
}

export default {
	SHARED_CAPABLE, ALWAYS_ORG_SCOPED, modeAllowsShared, sharedAllowed,
	resolveNewScope, listIncludesShared,
};
