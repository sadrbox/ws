/**
 * «Администрирование» → «Агенты» (21.09).
 *
 * РАЗДЕЛЁННЫЕ ДАННЫЕ. Кластеры и агенты — про разное: кластер это сервер 1С с его базами и сеансами, агент —
 * служба на компьютере, которая к ним ходит. Пока всё лежало одной панелью, «Агенты» были вкладкой среди баз и
 * сеансов, и вопрос «какие вообще службы у нас работают» решался поиском нужной вкладки.
 *
 * У агентов две роли, и это видно списком: админ-агент отвечает за СВОЙ кластер (сервер 1С целиком — все базы
 * всех клиентов), бизнес-агент — за базы, которые в нём подключены: организации у агента нет, кого он обслуживает,
 * говорят его базы (28.09). Здесь же заявки на подключение агентов и процессы, которые агенты запустили на своих
 * компьютерах. Заявки БАЗ с 22.09 — в разделе
 * «Расширение БухПроф-AI»: их шлёт не агент, а расширение внутри базы.
 */
import { FC, useState } from "react";
import { translate } from "src/i18";
import { PaneActiveProvider, usePanePollInterval } from "src/hooks/usePaneActive";
import Tabs from "src/components/Tabs";
import AgentsTab from "./AgentsTab";
import ProcessesTab from "./ProcessesTab";
import EnrollmentsTab from "./EnrollmentsTab";
import { useQuery } from "@tanstack/react-query";
import { fetchEnrollments } from "src/services/onec/api";
import { useAgents, useOnecPermissions } from "./shared";
import { ReadonlyNotice } from "./sharedUi";
import { agentsAllow } from "./onecPermissions";
import main from "src/styles/main.module.scss";

type AgentsPaneTab = "agents" | "requests" | "processes";

/**
 * Сколько заявок на подключение агентов ждёт решения — числом у вкладки: заявку ждут у телефона, открывать наугад
 * не придётся. Заявки баз считает раздел расширения; активации БИН больше нет (В8, 28.09).
 */
function usePendingRequests(): number {
	// Опрос — только пока панель на экране (О4 аудита 26.09).
	const pollInterval = usePanePollInterval(60_000);
	const enr = useQuery({ queryKey: ["onec", "enrollments", "PENDING", ""], queryFn: () => fetchEnrollments({ state: "PENDING" }), refetchInterval: pollInterval, retry: false });
	return enr.data?.items.length ?? 0;
}

const AgentsPaneBody: FC = () => {
	const perms = useOnecPermissions();
	const [tab, setTab] = useState<AgentsPaneTab>("agents");
	const pending = usePendingRequests();
	const agents = useAgents();
	const offline = (agents.data?.items ?? []).filter((a) => !a.disabled && !a.online).length;

	// Без просмотра агентов (вложенное разрешение) раздел не показывает ничего, кроме объяснения.
	if (!agentsAllow(perms, "view")) {
		return (
			<div className={main.PaneFill}>
				<ReadonlyNotice />
			</div>
		);
	}

	return (
		<div className={main.PaneFill}>
			<ReadonlyNotice />
			<Tabs
				activeTab={tab}
				onTabChange={(id) => setTab(id as AgentsPaneTab)}
				tabs={[
					{
						id: "agents",
						label: offline ? `${translate("onecTabAgents")} (${translate("onecAgentsOfflineShort")}: ${offline})` : translate("onecTabAgents"),
						component: tab === "agents" ? <AgentsTab /> : null,
					},
					{
						id: "requests",
						label: pending ? `${translate("onecTabRequests")} (${pending})` : translate("onecTabRequests"),
						component: tab === "requests" ? <EnrollmentsTab /> : null,
					},
					{
						// Что агенты запустили на своих компьютерах: rac, ibcmd, конфигуратор, мост.
						id: "processes", label: translate("onecTabProcesses"),
						component: tab === "processes" ? <ProcessesTab /> : null,
					},
				]}
			/>
		</div>
	);
};

/** Корень панели: опросы внутри идут, только пока панель на экране (О4 аудита 26.09). */
export const OneCAgentsList: FC<{ uniqId?: string }> = ({ uniqId }) => (
	<PaneActiveProvider uniqId={uniqId}>
		<AgentsPaneBody />
	</PaneActiveProvider>
);

export default OneCAgentsList;
