/**
 * СВОДНЫЙ ВИД ПО ГРУППЕ ОРГАНИЗАЦИЙ (Г2 плана PLAN_INSTALL_MODES_2026-09-24.md).
 *
 * Раньше «все мои организации» показывались ТОЛЬКО когда активной организации нет вовсе: сводка
 * получалась из отсутствия выбора, а не из намерения. Человек не понимал, почему иногда видит
 * три организации, а иногда одну, — и это невозможно было ни объяснить, ни повторить.
 *
 * Теперь выбор явный и уходит заголовком `X-Org-Scope: group` в каждом запросе: ни один вызов
 * API переписывать не пришлось. Сервер ограничивает сводку организациями, к которым есть доступ.
 *
 * ЗАПИСЬ В СВОДНОМ РЕЖИМЕ ЗАПРЕЩЕНА сервером (400 `SCOPE_READ_ONLY`): документ принадлежит
 * конкретному юрлицу, и «создать в группе» — дорогая ошибка учёта, а не удобство.
 *
 * Выбор — удобство одного зрителя: хранится в localStorage и переживает перезагрузку.
 */
const KEY = "org.scope";
export type OrgScope = "organization" | "group";

let current: OrgScope = "organization";
const listeners = new Set<(s: OrgScope) => void>();

try {
	current = (typeof localStorage !== "undefined" && localStorage.getItem(KEY)) === "group" ? "group" : "organization";
} catch {
	current = "organization";
}

export const getOrgScope = (): OrgScope => current;
export const isGroupScope = (): boolean => current === "group";

export function setOrgScope(scope: OrgScope): void {
	if (scope === current) return;
	current = scope;
	try {
		if (scope === "group") localStorage.setItem(KEY, "group");
		else localStorage.removeItem(KEY);
	} catch {
		/* приватный режим — выбор живёт до перезагрузки */
	}
	for (const l of listeners) l(scope);
}

export function subscribeOrgScope(l: (s: OrgScope) => void): () => void {
	listeners.add(l);
	return () => { listeners.delete(l); };
}
