/**
 * «Кластеры 1С» — строки списка кластеров без JSX (ради тестов и Fast Refresh).
 *
 * Кластер в панели — это сервер 1С из реестра: его базы, его сеансы, его админ-агент. Всё остальное на экране
 * читается в контексте выбранного кластера, поэтому список кластеров и есть первый уровень иерархии.
 */
import { translate } from "src/i18";
import type { OnecAgent, OnecServer } from "src/services/onec/api";

export type ClusterRow = {
	uuid: string;
	clusterName: string;
	clusterAgent: string;
	clusterBases: number;
	clusterAddress: string;
	/** Есть ли у кластера админ-агент на связи: без него кластерные команды выполнять некому. */
	online: boolean;
};

/**
 * Админ-агент этого кластера: он и выполняет кластерные команды (выбор идёт по серверу). Отключённый тоже
 * возвращается: «агента нет» и «агент отключён» — разные ответы с разными действиями (завести или включить).
 */
export const agentOfServer = (agents: readonly OnecAgent[], serverId: string): OnecAgent | null =>
	agents.find((a) => a.role === "admin" && a.serverId === serverId && !a.disabled)
	?? agents.find((a) => a.role === "admin" && a.serverId === serverId)
	?? null;

/** Состояние агента одним словом — те же три, что в списке агентов: отключён, занят, на связи, не на связи. */
const agentState = (a: OnecAgent): string => (a.disabled
	? translate("onecAgentDisabled")
	: a.busy ? translate("onecAgentBusy")
		: a.online ? translate("onecAgentOnline") : translate("onecAgentOffline"));

/**
 * Кластер — сервер 1С с админ-агентом или с базами в реестре. Строка сервера заводится при регистрации ЛЮБОГО
 * агента, и у бизнес-агента она означает его рабочее место, а не кластер: реестр кластера такой агент не ведёт
 * (СП4). Показывать такие строки в «Кластерах» значило бы звать кластером компьютер бухгалтера; его базы видны в
 * карточке агента («Базы агента»).
 */
const isCluster = (s: OnecServer, agents: readonly OnecAgent[]): boolean =>
	s.bases > 0 || agents.some((a) => a.role === "admin" && a.serverId === s.id);

export function clusterRows(servers: readonly OnecServer[], agents: readonly OnecAgent[]): ClusterRow[] {
	return servers.filter((s) => isCluster(s, agents)).map((s) => {
		const agent = agentOfServer(agents, s.id);
		return {
			uuid: s.id,
			clusterName: s.name,
			clusterAgent: agent
				? `${agent.name || agent.id.slice(0, 8)} · ${agentState(agent)}`
				: translate("onecClusterNoAgent"),
			clusterBases: s.bases,
			clusterAddress: [s.publicHost, s.rasHost ? `RAS ${s.rasHost}${s.rasPort ? `:${s.rasPort}` : ""}` : ""].filter(Boolean).join(" · ") || "—",
			online: !!agent?.online && !agent.disabled,
		};
	});
}

/**
 * Какой кластер показать. Прежний выбор — если он ещё существует; иначе единственный; иначе первый по имени.
 * «Ни одного» бывает только до первой регистрации агента: сервер заводит он сам.
 */
export function pickCluster(rows: readonly ClusterRow[], stored: string | null): string | null {
	if (stored && rows.some((r) => r.uuid === stored)) return stored;
	return rows[0]?.uuid ?? null;
}

/**
 * Опции выбора кластера для тулбара панели (вариант 1: выбор — в шапке, а не отдельным списком слева).
 * В подписи только имя: адрес, агент и число баз стоят рядом с полем и меняются вместе с выбором, поэтому
 * дублировать их в каждой строке выпадающего списка незачем — оно лишь удлиняет её до неразличимости.
 */
export const clusterOptions = (rows: readonly ClusterRow[]): { value: string; label: string }[] =>
	rows.map((r) => ({ value: r.uuid, label: r.clusterName }));

/**
 * Чем один кластер отличается от другого на глаз: адрес и число баз. Строка стоит рядом с выбором и отвечает
 * на вопрос «точно ли это тот сервер», не заставляя открывать реестр.
 */
export const clusterSubtitle = (row: ClusterRow): string =>
	`${row.clusterAddress} · ${translate("onecTabBases")}: ${row.clusterBases}`;
