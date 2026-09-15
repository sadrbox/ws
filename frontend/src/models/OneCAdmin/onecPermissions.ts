/**
 * ВЛОЖЕННЫЕ РАЗРЕШЕНИЯ «АДМИНИСТРИРОВАНИЯ 1С» в панели — те же правила, что в сервисе (ai/src/onec/permissions.ts).
 *
 * Общее право `OneCAdmin` даёт доступ к разделу; действия в «Агентах», «Расширениях» и «Пользователях баз» —
 * только по вложенным строкам (решение 15.09): агенты — уровнем просмотр ⊂ редактирование ⊂ управление,
 * расширения и пользователи баз — действиями; «управление» включает все действия раздела, а команда больше
 * чем в одну базу требует ещё «группового редактирования».
 *
 * Отдельным модулем: правила проверяются тестом, а не-компонентный экспорт в модуле с компонентом ломает
 * Fast Refresh.
 */
import { translate } from "src/i18";

export type AgentsLevel = "none" | "view" | "edit" | "manage";
export type SectionAction = "manage" | "edit" | "create" | "delete" | "groupEdit";
export type OnecSection = "extensions" | "baseUsers";
export type OnecPermissions = { agents: AgentsLevel; extensions: SectionAction[]; baseUsers: SectionAction[] };

export const SECTION_ACTIONS: SectionAction[] = ["manage", "edit", "create", "delete", "groupEdit"];
export const AGENTS_KEY = "OneCAdmin.Agents";
export const SECTION_KEY: Record<OnecSection, string> = { extensions: "OneCAdmin.Extensions", baseUsers: "OneCAdmin.BaseUsers" };
const RANK: Record<AgentsLevel, number> = { none: 0, view: 1, edit: 2, manage: 3 };

const agentsLevelOf = (v: string): AgentsLevel =>
	v === "manage" || v === "full" ? "manage" : v === "edit" ? "edit" : v === "view" || v === "readonly" ? "view" : "none";

export function buildOnecPermissions(
	rows: { modelName: string; accessLevel: string }[],
	opts: { isSuperAdmin: boolean; hasSection: boolean },
): OnecPermissions {
	if (opts.isSuperAdmin) return { agents: "manage", extensions: [...SECTION_ACTIONS], baseUsers: [...SECTION_ACTIONS] };
	if (!opts.hasSection) return { agents: "none", extensions: [], baseUsers: [] };
	const agentRows = rows.filter((r) => r.modelName === AGENTS_KEY);
	const agents = agentRows.length
		? agentRows.map((r) => agentsLevelOf(r.accessLevel)).reduce((a, b) => (RANK[b] > RANK[a] ? b : a), "none" as AgentsLevel)
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

/** Раздел и действие пакетной команды; прочие команды — по общему праву. */
export const SECTION_OF_TYPE: Record<string, { section: OnecSection; action: SectionAction }> = {
	IB_CREATE_USER: { section: "baseUsers", action: "create" },
	IB_UPDATE_USER: { section: "baseUsers", action: "edit" },
	IB_DELETE_USER: { section: "baseUsers", action: "delete" },
	IB_INSTALL_EXTENSION: { section: "extensions", action: "create" },
	IB_DELETE_EXTENSION: { section: "extensions", action: "delete" },
};

const SECTION_I18: Record<OnecSection, string> = { extensions: "onecPermExtensions", baseUsers: "onecPermBaseUsers" };
const ACTION_I18: Record<SectionAction, string> = {
	manage: "onecPermManage", edit: "onecPermEdit", create: "onecPermCreate", delete: "onecPermDelete", groupEdit: "onecPermGroupEdit",
};

/** Чего не хватает — словами: «Нет разрешения: Администрирование 1С → Пользователи баз: групповое редактирование». */
export function deniedText(p: OnecPermissions, section: OnecSection, action: SectionAction, bases: number): string {
	const set = p[section];
	const missing = [
		...(set.includes(action) ? [] : [translate(ACTION_I18[action])]),
		...(bases > 1 && !set.includes("groupEdit") ? [translate(ACTION_I18.groupEdit)] : []),
	];
	return `${translate("onecPermDenied")}: ${translate(SECTION_I18[section])}: ${missing.join(", ") || translate(ACTION_I18.manage)}`;
}

/** Вложенные строки формы разрешений: ключ, подпись, вложенность. */
export const ONEC_NESTED_PERMISSIONS: { key: string; label: string; depth: number }[] = [
	{ key: AGENTS_KEY, label: translate("onecPermAgents"), depth: 1 },
	...(["extensions", "baseUsers"] as OnecSection[]).flatMap((s) => SECTION_ACTIONS.map((a) => ({
		key: `${SECTION_KEY[s]}.${a}`, label: `${translate(SECTION_I18[s])}: ${translate(ACTION_I18[a])}`, depth: 2,
	}))),
];

export const nestedDepth = (modelName: string): number =>
	ONEC_NESTED_PERMISSIONS.find((x) => x.key === modelName)?.depth ?? 0;

/** Уровни строки: у агентов свои, у действий — «разрешено / запрещено»; `null` — обычная строка. */
export function nestedLevelOptions(modelName: string): { value: string; label: string }[] | null {
	if (modelName === AGENTS_KEY) {
		return [
			{ value: "none", label: translate("accessLevelNone") || "Нет доступа" },
			{ value: "view", label: translate("onecPermLevelView") },
			{ value: "edit", label: translate("onecPermLevelEdit") },
			{ value: "manage", label: translate("onecPermLevelManage") },
		];
	}
	if (nestedDepth(modelName) === 2) {
		return [
			{ value: "full", label: translate("onecPermAllowed") },
			{ value: "none", label: translate("onecPermForbidden") },
		];
	}
	return null;
}
