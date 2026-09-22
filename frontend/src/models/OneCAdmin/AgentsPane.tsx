/**
 * «Администрирование» → «Агенты» (21.09).
 *
 * РАЗДЕЛЁННЫЕ ДАННЫЕ. Кластеры и агенты — про разное: кластер это сервер 1С с его базами и сеансами, агент —
 * служба на компьютере, которая к ним ходит. Пока всё лежало одной панелью, «Агенты» были вкладкой среди баз и
 * сеансов, и вопрос «какие вообще службы у нас работают» решался поиском нужной вкладки.
 *
 * У агентов две роли, и это видно списком: админ-агент отвечает за СВОЙ кластер (сервер 1С целиком — все базы
 * всех клиентов), бизнес-агент — за базы одной организации ERP. Здесь же заявки на подключение агентов,
 * активация БИНов и процессы, которые агенты запустили на своих компьютерах. Заявки БАЗ с 22.09 — в разделе
 * «Расширение БухПроф-AI»: их шлёт не агент, а расширение внутри базы.
 */
import { FC, useState } from "react";
import { translate } from "src/i18";
import Tabs from "src/components/Tabs";
import AgentsTab from "./AgentsTab";
import ProcessesTab from "./ProcessesTab";
import ActivationRequestsTab from "./ActivationRequestsTab";
import EnrollmentsTab from "./EnrollmentsTab";
import { useQuery } from "@tanstack/react-query";
import { fetchActivationRequests, fetchEnrollments } from "src/services/onec/api";
import { ReadonlyNotice, useAgents, useOnecPermissions } from "./shared";
import { agentsAllow } from "./onecPermissions";
import main from "src/styles/main.module.scss";

type AgentsPaneTab = "agents" | "requests" | "processes";

/**
 * Заявки, ждущие решения: подключение АГЕНТА и активация БИН.
 *
 * ЗАЯВКИ БАЗ ЗДЕСЬ БОЛЬШЕ НЕТ (22.09): они приходят не от агента, а из формы 1С «БухПроф AI → Подключение к
 * BuhProf AI», и живут в разделе «Расширение БухПроф-AI» вместе с остальным про расширение. Соседство по слову
 * «заявка» удобно только тому, кто уже знает, чем они отличаются; остальные искали заявку базы среди агентских.
 *
 * Активация БИН осталась: её просят ИЗ ОКНА АГЕНТА, решение меняет список активных БИН агента и упирается в его
 * тариф — это про агента, а не про расширение.
 */
const RequestsSection: FC = () => {
	const [inner, setInner] = useState<"enrollments" | "activation">("enrollments");
	return (
		<Tabs
			activeTab={inner}
			onTabChange={(id) => setInner(id as typeof inner)}
			tabs={[
				// Подключение агента — первым: с него начинается работа, а БИНы приходят уже через агента.
				{ id: "enrollments", label: translate("onecEnrollments"), component: inner === "enrollments" ? <EnrollmentsTab /> : null },
				{ id: "activation", label: translate("onecReqActivation"), component: inner === "activation" ? <ActivationRequestsTab /> : null },
			]}
		/>
	);
};

/**
 * Сколько заявок ждёт решения — числом у вкладки: заявку ждут у телефона, открывать наугад не придётся.
 * Считаются только СВОИ заявки раздела: агентские и активация БИН. Заявки баз считает раздел расширения.
 */
function usePendingRequests(): number {
	const enr = useQuery({ queryKey: ["onec", "enrollments", "PENDING", ""], queryFn: () => fetchEnrollments({ state: "PENDING" }), refetchInterval: 60_000, retry: false });
	const act = useQuery({ queryKey: ["onec", "activation-requests", "PENDING", ""], queryFn: () => fetchActivationRequests({ state: "PENDING" }), refetchInterval: 60_000, retry: false });
	return (enr.data?.items.length ?? 0) + (act.data?.items.length ?? 0);
}

export const OneCAgentsList: FC = () => {
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
						component: tab === "requests" ? <RequestsSection /> : null,
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

export default OneCAgentsList;
