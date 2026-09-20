/**
 * OneCAdmin — администрирование сервера 1С: базы клиентов и их состояние (E15/A5, P0).
 *
 * ВКЛАДКИ ОДНИМ РЯДОМ. «Прогресс запросов и команд» и «Задания» стоят после «Агентов» —
 * такими же вкладками, как всё остальное. Прежде экран делился надвое: работа слева,
 * наблюдение справа; деление съедало треть ширины постоянно, а таблицы баз и сеансов
 * широкие. Наблюдение от переключения вкладок НЕ прерывается — за командами следит сама
 * панель (useBatchWatch), а не вкладка; счётчик у «Прогресса» говорит, идёт ли что-то.
 *
 * НАСТРОЕК ОТДЕЛЬНОЙ ВКЛАДКОЙ НЕТ. Всё, что настраивается у сервера 1С (публичный адрес,
 * адрес и порт RAS), правится там же, где смотрят на сам сервер, — во вкладке «Параметры»
 * карточки агента: агент и есть то, что связывает панель с этим сервером. Отдельная
 * вкладка означала бы два места для одних и тех же полей.
 *
 * СООБЩЕНИЯ ЗДЕСЬ НЕ ВЫВОДЯТСЯ. Все `<Notice />` приложения показывает одна область —
 * «Технические сообщения» справа от пейнов (components/TechMessages). Своей доски у панели
 * больше нет: два места вывода одного и того же — это два места, которые обязаны
 * совпадать, а они рано или поздно расходятся.
 *
 * РАЗДЕЛЫ СОБРАНЫ ПО ПРЕДМЕТУ, А НЕ ПО КОМАНДАМ.
 *   «Кластер» — сеансы, соединения, процессы и лицензии: всё это одно живое состояние
 *      сервера, читается одной утилитой `rac` и отвечает за секунды. Тремя вкладками
 *      верхнего уровня это заставляло помнить, в какой из них какая половина ответа.
 *   «Прогресс» — операции панели, задания сервиса и процессы агента: три таблицы об одном
 *      и том же вопросе — «что сейчас происходит». Спрашивают их всегда вместе.
 *
 * ЧТО ДЕЛАЕТ КНОПКА «ОБНОВИТЬ». Она даёт АКТУАЛЬНЫЕ данные — по природе того, что
 * показывает таблица, а не «перечитывает тот же кэш»:
 *   «Базы» — спрашивает кластер (их состав заводит он) и перечитывает список;
 *   содержимое базы (пользователи, расширения) — читает саму базу; если отмечено несколько
 *     баз, читает их группой, по одной команде на базу;
 *   «Кластер» — команда в кластер, живое состояние;
 *   «Задания», «Агенты» — база сервиса, она и есть источник.
 *
 * ЧТО ОТКУДА (правило одно на всю панель). В кластер 1С ходит ТОЛЬКО агент, и только по
 * явной команде сервиса; браузер не знает про 1С ничего и разговаривает с `/v1/onec/*`.
 * Данные делятся на три вида, и это определяет, что вызывает обращение к 1С:
 *
 *   1. РЕЕСТР (базы, сводки по расширениям и пользователям) — таблицы БД сервиса.
 *      Наполняются heartbeat'ом агента и результатами команд. Открытие вкладки, прокрутка,
 *      сортировка, поиск и отбор по строке слева читают реестр и в 1С НЕ ходят.
 *   2. ЖИВОЕ СОСТОЯНИЕ (сеансы, соединения, блокировки, процессы, лицензии) — всегда
 *      команда в кластер: список часовой давности здесь бесполезен. Кэша нет (staleTime: 0).
 *   3. СОДЕРЖИМОЕ БАЗЫ (пользователи и расширения конкретной ИБ) — вход в базу, минуты и
 *      занятый сеанс 1С. Само не грузится НИКОГДА: только по кнопке «Обновить». Прочитанное
 *      оседает в реестре и дальше показывается оттуда — рядом видно, когда его читали.
 *
 * ВСЯ РАБОТА ВИДНА В «ПРОГРЕССЕ». Любой запрос, команда и групповая операция заводят
 * запись в реестре операций (progress.ts) — и те, что идут секунды, и те, что идут часами.
 * Иначе панель отвечала «команда отправлена» и замолкала.
 */
import { FC, useEffect, useMemo, useState } from "react";
import { translate } from "src/i18";
import Tabs from "src/components/Tabs";
import { OneCBasesList } from "src/models/OneCBases";
import SessionsTab from "./SessionsTab";
import ConnectionsTab from "./ConnectionsTab";
import ServerTab from "./ServerTab";
import ExtensionsTab from "./ExtensionsTab";
import UsersTab from "./UsersTab";
import BatchesTab from "./BatchesTab";
import AgentsTab from "./AgentsTab";
import SchedulesTab from "./SchedulesTab";
import RegistrationsTab from "./RegistrationsTab";
import ActivationRequestsTab from "./ActivationRequestsTab";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchActivationRequests, fetchEnrollments, fetchRegistrations, fetchServers } from "src/services/onec/api";
import EnrollmentsTab from "./EnrollmentsTab";
import { getOnecServer, setOnecServer, subscribeOnecServer } from "src/services/onec/serverScope";
import { FieldSelect } from "src/components/Field";
import ProcessesTab from "./ProcessesTab";
import ProgressTab from "./ProgressTab";
import { useBatchWatch } from "./progress";
import main from "src/styles/main.module.scss";
import styles from "./OneCAdmin.module.scss";
import {
	ReadonlyNotice, useAgents, useOnecPermissions,
} from "./shared";
import { agentsAllow } from "./onecPermissions";

type Tab = "bases" | "cluster" | "extensions" | "users" | "agents" | "requests" | "schedules" | "progress";

/**
 * «Заявки» (СВ4) — то, что приходит в панель снаружи и ждёт решения администратора BuhProf: подключение базы
 * из 1С и активация организации из окна агента. Решать могут только администраторы BuhProf; остальные видят.
 */
const RequestsSection: FC = () => {
	const [inner, setInner] = useState<"registrations" | "activation" | "enrollments">("registrations");
	return (
		<Tabs
			activeTab={inner}
			onTabChange={(id) => setInner(id as typeof inner)}
			tabs={[
				{ id: "registrations", label: translate("onecReqRegistrations"), component: inner === "registrations" ? <RegistrationsTab /> : null },
				{ id: "activation", label: translate("onecReqActivation"), component: inner === "activation" ? <ActivationRequestsTab /> : null },
				{ id: "enrollments", label: translate("onecEnrollments"), component: inner === "enrollments" ? <EnrollmentsTab /> : null },
			]}
		/>
	);
};

/**
 * ВЫБОР СЕРВЕРА 1С (C9). Показывается, только когда серверов больше одного: с одним сервером панель выглядит как
 * раньше. Выбор уходит в каждый запрос панели (serverScope → aiFetch), а данные панели перечитываются — списки
 * прежнего сервера на экране остаться не должны.
 */
const ServerPicker: FC = () => {
	const qc = useQueryClient();
	const servers = useQuery({ queryKey: ["onec", "servers"], queryFn: fetchServers, staleTime: 60_000 });
	const [server, setServer] = useState<string | null>(getOnecServer());
	useEffect(() => subscribeOnecServer(setServer), []);
	const items = servers.data?.items ?? [];
	// Выбранного сервера больше нет (удалён, закрыт) — назад к «все серверы».
	useEffect(() => {
		if (server && servers.data && !items.some((x) => x.id === server)) setOnecServer(null);
	}, [server, servers.data, items]);
	if (items.length < 2) return null;
	return (
		<div className={styles.ServerPicker}>
			<FieldSelect name="onec_server" label={translate("onecServer")} size="sm" value={server ?? ""}
				onChange={(e) => {
					setOnecServer(e.target.value || null);
					void qc.invalidateQueries({ queryKey: ["onec"] });
				}}
				options={[{ value: "", label: translate("onecServerAll") }, ...items.map((x) => ({ value: x.id, label: `${x.name} (${x.bases})` }))]} />
		</div>
	);
};

/** Сколько заявок ждёт решения — число у вкладки: заявку ждут у телефона, открывать раздел наугад не придётся. */
function usePendingRequests(): number {
	const reg = useQuery({ queryKey: ["onec", "registrations", "PENDING", ""], queryFn: () => fetchRegistrations({ state: "PENDING" }), refetchInterval: 60_000, retry: false });
	const act = useQuery({ queryKey: ["onec", "activation-requests", "PENDING", ""], queryFn: () => fetchActivationRequests({ state: "PENDING" }), refetchInterval: 60_000, retry: false });
	const enr = useQuery({ queryKey: ["onec", "enrollments", "PENDING", ""], queryFn: () => fetchEnrollments({ state: "PENDING" }), refetchInterval: 60_000, retry: false });
	return (reg.data?.items.length ?? 0) + (act.data?.items.length ?? 0) + (enr.data?.items.length ?? 0);
}

/**
 * «Кластер» — живое состояние сервера 1С одним разделом.
 *
 * Внутренние вкладки монтируются по одной: каждая при монтировании спрашивает кластер
 * (сеансы, соединения, процессы, лицензии), и открытие раздела стоило бы четырёх команд
 * в 1С вместо одной нужной.
 */
const ClusterSection: FC = () => {
	const [inner, setInner] = useState<"sessions" | "connections" | "server">("sessions");
	return (
		<Tabs
			activeTab={inner}
			onTabChange={(id) => setInner(id as typeof inner)}
			tabs={[
				{ id: "sessions", label: translate("onecTabSessions"), component: inner === "sessions" ? <SessionsTab /> : null },
				{ id: "connections", label: translate("onecTabConnections"), component: inner === "connections" ? <ConnectionsTab /> : null },
				{ id: "server", label: translate("onecTabServer"), component: inner === "server" ? <ServerTab /> : null },
			]}
		/>
	);
};

/**
 * «Прогресс» — ВСЁ, что отвечает на вопрос «что сейчас происходит и что происходило».
 *
 * Три таблицы об одном: операции панели (запросы и команды, которые она затеяла), задания
 * (групповые операции на стороне сервиса) и процессы агента (что он запустил на сервере
 * 1С прямо сейчас). Пока они стояли тремя вкладками в разных концах панели, ответ на один
 * вопрос приходилось собирать из трёх мест — а спрашивают их всегда вместе: «команда не
 * отвечает — она вообще дошла? задание живо? агент что-то делает?».
 *
 * Внутренние вкладки монтируются по одной: «Процессы агента» — команда в 1С, и открывать
 * её вместе с остальными значило бы спрашивать сервер всякий раз, когда человек заглянул
 * посмотреть на очередь.
 */
const ProgressSection: FC<{ watch: ReturnType<typeof useBatchWatch> }> = ({ watch }) => {
	const [inner, setInner] = useState<"ops" | "batches" | "processes">("ops");
	return (
		<Tabs
			activeTab={inner}
			onTabChange={(id) => setInner(id as typeof inner)}
			tabs={[
				{
					id: "ops", label: translate("onecTabProgress"),
					component: inner === "ops"
						? <ProgressTab isLoading={watch.isFetching} onRefresh={watch.refresh} />
						: null,
				},
				{ id: "batches", label: translate("onecTabBatches"), component: inner === "batches" ? <BatchesTab /> : null },
				{ id: "processes", label: translate("onecTabProcesses"), component: inner === "processes" ? <ProcessesTab /> : null },
			]}
		/>
	);
};

export const OneCAdminList: FC = () => {
	const [tab, setTab] = useState<Tab>("bases");

	/**
	 * Слежение за командами — НА УРОВНЕ ПАНЕЛИ, а не вкладки.
	 *
	 * Команда, поставленная со вкладки «Базы», выполняется минутами; если следит за ней
	 * только та вкладка, переход на соседнюю обрывает наблюдение, и результат команды
	 * (например, новое состояние публикации) не доезжает до таблиц. Здесь наблюдатель
	 * живёт, пока открыта панель, — независимо от того, какая вкладка показана.
	 */
	const watch = useBatchWatch();
	const running = watch.running;

	const perms = useOnecPermissions();
	const pending = usePendingRequests();
	const agentsList = useAgents();
	const offlineAgents = (agentsList.data?.items ?? []).filter((a) => !a.disabled && !a.online).length;
	const tabs = useMemo(() => [
		{
			id: "bases",
			label: translate("onecTabBases"),
			// Штатный список: ModelList даёт отметки строк, поиск, сортировку, курсорную
			// подгрузку, предпросмотр по «Переключить вид списка» и открытие карточки
			// отдельным пейном. Своя таблица здесь была ровно тем же, но хуже.
			component: tab === "bases" ? <OneCBasesList /> : null,
		},
		{
			id: "cluster",
			label: translate("onecTabCluster"),
			component: tab === "cluster" ? <ClusterSection /> : null,
		},
		{
			id: "extensions",
			label: translate("onecTabExtensions"),
			component: tab === "extensions" ? <ExtensionsTab /> : null,
		},
		{
			id: "users",
			label: translate("onecTabUsers"),
			component: tab === "users" ? <UsersTab /> : null,
		},
		// Без просмотра агентов (вложенное разрешение) вкладки нет.
		...(agentsAllow(perms, "view") ? [{
			id: "agents",
			// Сколько агентов пропало со связи (п. 4) — числом у вкладки: заходить проверять наугад не придётся.
			label: offlineAgents ? `${translate("onecTabAgents")} (${translate("onecAgentsOfflineShort")}: ${offlineAgents})` : translate("onecTabAgents"),
			component: tab === "agents" ? <AgentsTab /> : null,
		}] : []),
		{
			id: "requests",
			label: pending ? `${translate("onecTabRequests")} (${pending})` : translate("onecTabRequests"),
			component: tab === "requests" ? <RequestsSection /> : null,
		},
		{
			// Обслуживание по расписанию — рядом с агентами: и то и другое про то, как
			// панель работает САМА, без человека за экраном. Прогоны при этом видны в
			// «Заданиях», как и всё остальное.
			id: "schedules",
			label: translate("onecTabSchedules"),
			component: tab === "schedules" ? <SchedulesTab /> : null,
		},
		{
			// Наблюдение — В ОБЩЕМ РЯДУ ВКЛАДОК, после «Агентов». Счётчик говорит, идёт ли
			// что-то, и этого довольно, чтобы решить, заглядывать ли: само наблюдение от
			// переключения вкладок не прерывается (см. useBatchWatch выше).
			id: "progress",
			label: running ? `${translate("onecTabProgress")} (${running})` : translate("onecTabProgress"),
			component: tab === "progress" ? <ProgressSection watch={watch} /> : null,
		},
	], [tab, running, watch, perms, pending, offlineAgents]);

	return (
		<div className={main.PaneFill}>
			{/* «Доступ только на просмотр» — один раз на панель, а не на каждой вкладке:
			    иначе одно и то же сообщение приходило бы на доску от пяти экранов. */}
			<ReadonlyNotice />
			<ServerPicker />
			<Tabs tabs={tabs} activeTab={tab} onTabChange={(id) => setTab(id as Tab)} />
		</div>
	);
};

export default OneCAdminList;
