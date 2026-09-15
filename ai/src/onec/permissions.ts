/**
 * ВЛОЖЕННЫЕ РАЗРЕШЕНИЯ «АДМИНИСТРИРОВАНИЯ 1С» (решение пользователя 15.09).
 *
 * Общее право `OneCAdmin` (полный / только чтение) даёт доступ к разделу. Действия в трёх его частях требуют
 * отдельных строк `access_permissions` — без них там только просмотр:
 *
 *   OneCAdmin.Agents              — уровень: просмотр ⊂ редактирование ⊂ управление;
 *   OneCAdmin.Extensions.<action> — разрешено (`full`) или нет;
 *   OneCAdmin.BaseUsers.<action>  — так же; action: manage | edit | create | delete | groupEdit.
 *
 * «Управление» раздела включает все его действия. «Групповое редактирование» нужно, когда команда идёт больше
 * чем в одну базу. Правило одно на сервис и панель; здесь — без express и базы, чтобы его проверял тест.
 */

export type AgentsLevel = "none" | "view" | "edit" | "manage";
export type SectionAction = "manage" | "edit" | "create" | "delete" | "groupEdit";
export type OnecSection = "extensions" | "baseUsers";

export type OnecPermissions = { agents: AgentsLevel; extensions: SectionAction[]; baseUsers: SectionAction[] };

export const SECTION_ACTIONS: SectionAction[] = ["manage", "edit", "create", "delete", "groupEdit"];
const RANK: Record<AgentsLevel, number> = { none: 0, view: 1, edit: 2, manage: 3 };
const SECTION_KEY: Record<OnecSection, string> = { extensions: "OneCAdmin.Extensions", baseUsers: "OneCAdmin.BaseUsers" };
export const AGENTS_KEY = "OneCAdmin.Agents";

/** Уровень агентов из строки: свои значения и, для порядка, общие `full`/`readonly`. */
const agentsLevelOf = (v: string): AgentsLevel =>
	v === "manage" || v === "full" ? "manage" : v === "edit" ? "edit" : v === "view" || v === "readonly" ? "view" : "none";

export function buildOnecPermissions(
	rows: { modelName: string; accessLevel: string }[],
	opts: { isSuperAdmin: boolean; hasSection: boolean },
): OnecPermissions {
	if (opts.isSuperAdmin) return { agents: "manage", extensions: [...SECTION_ACTIONS], baseUsers: [...SECTION_ACTIONS] };
	if (!opts.hasSection) return { agents: "none", extensions: [], baseUsers: [] };
	// Строки со всех организаций пользователя — берём максимум: сервер 1С один на установку.
	const agentRows = rows.filter((r) => r.modelName === AGENTS_KEY);
	const agents = agentRows.length
		? agentRows.map((r) => agentsLevelOf(r.accessLevel)).reduce((a, b) => (RANK[b] > RANK[a] ? b : a), "none" as AgentsLevel)
		// Строки нет — доступ к разделу даёт просмотр (вложенные обязательны для действий).
		: "view";
	const section = (s: OnecSection) => SECTION_ACTIONS.filter((a) =>
		rows.some((r) => r.modelName === `${SECTION_KEY[s]}.${a}` && r.accessLevel === "full"));
	return { agents, extensions: section("extensions"), baseUsers: section("baseUsers") };
}

export const agentsAllow = (p: OnecPermissions, need: AgentsLevel): boolean => RANK[p.agents] >= RANK[need];

export function sectionAllows(p: OnecPermissions, section: OnecSection, action: SectionAction, bases: number): boolean {
	const set = p[section];
	if (set.includes("manage")) return true;
	if (!set.includes(action)) return false;
	return bases <= 1 || set.includes("groupEdit");
}

/** Какое действие какого раздела совершает пакетная команда. */
export const SECTION_OF_TYPE: Record<string, { section: OnecSection; action: SectionAction }> = {
	IB_CREATE_USER: { section: "baseUsers", action: "create" },
	IB_UPDATE_USER: { section: "baseUsers", action: "edit" },
	IB_DELETE_USER: { section: "baseUsers", action: "delete" },
	IB_INSTALL_EXTENSION: { section: "extensions", action: "create" },
	IB_DELETE_EXTENSION: { section: "extensions", action: "delete" },
};

export type OnecRequirement =
	| { kind: "agents"; level: AgentsLevel }
	| { kind: "section"; section: OnecSection; action: SectionAction; bases: number; type: string; baseKeys: string[] }
	| { kind: "deferred" };

/**
 * Какое вложенное разрешение нужно запросу. `null` — вложенные не участвуют, действует общее правило
 * (onec/access.ts). `deferred` — решает обработчик: повтору задания нужен тип задания.
 */
export function onecRequirement(method: string, path: string, body?: unknown): OnecRequirement | null {
	const m = method.toUpperCase();
	if (m === "GET") {
		if (/^\/agents\/[^/]+\/(health|log)$/.test(path) || path === "/agent-processes") return { kind: "agents", level: "view" };
		return null;
	}
	if (m === "PATCH" && (/^\/agents\/[^/]+$/.test(path) || /^\/servers\/[^/]+$/.test(path))) return { kind: "agents", level: "edit" };
	if ((m === "POST" && path === "/agents") || (m === "DELETE" && /^\/agents\/[^/]+$/.test(path))
		|| (m === "POST" && /^\/agents\/[^/]+\/[a-z-]+$/.test(path))
		|| (m === "POST" && /^\/agent-processes\/[^/]+\/kill$/.test(path))
		|| (m === "POST" && /^\/commands\/[^/]+\/abort$/.test(path))) {
		return { kind: "agents", level: "manage" };
	}
	if (m === "POST" && path === "/batch") {
		const b = (body ?? {}) as { type?: unknown; baseKeys?: unknown };
		const type = String(b.type ?? "").toUpperCase();
		const need = SECTION_OF_TYPE[type];
		if (!need) return null;
		const keys = Array.isArray(b.baseKeys) ? [...new Set(b.baseKeys.filter((k): k is string => typeof k === "string" && !!k))] : [];
		return { kind: "section", ...need, bases: keys.length, type, baseKeys: keys };
	}
	if (m === "POST" && /^\/batches\/[^/]+\/retry$/.test(path)) return { kind: "deferred" };
	return null;
}

const AGENTS_LABEL: Record<AgentsLevel, string> = { none: "нет доступа", view: "просмотр", edit: "редактирование", manage: "управление" };
const ACTION_LABEL: Record<SectionAction, string> = {
	manage: "управление", edit: "редактирование", create: "создание", delete: "удаление", groupEdit: "групповое редактирование",
};
const SECTION_LABEL: Record<OnecSection, string> = { extensions: "Расширения", baseUsers: "Пользователи баз" };

/** Что именно не разрешено — словами, для отказа 403. */
export function deniedMessage(need: Exclude<OnecRequirement, { kind: "deferred" }>, p: OnecPermissions): string {
	if (need.kind === "agents") {
		return `Нужно разрешение «Администрирование 1С → Агенты: ${AGENTS_LABEL[need.level]}» (сейчас: ${AGENTS_LABEL[p.agents]})`;
	}
	const set = p[need.section];
	const missing = [
		...(set.includes(need.action) ? [] : [ACTION_LABEL[need.action]]),
		...(need.bases > 1 && !set.includes("groupEdit") ? [ACTION_LABEL.groupEdit] : []),
	];
	return `Нужно разрешение «Администрирование 1С → ${SECTION_LABEL[need.section]}: ${missing.join(", ") || ACTION_LABEL.manage}»`;
}
