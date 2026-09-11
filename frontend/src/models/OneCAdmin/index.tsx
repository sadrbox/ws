/**
 * OneCAdmin — администрирование сервера 1С: базы клиентов и их состояние (E15/A5, P0).
 *
 * ВКЛАДКИ ОДНИМ РЯДОМ. «Прогресс запросов и команд» и «Задания» стоят после «Агентов» —
 * такими же вкладками, как всё остальное. Прежде экран делился надвое: работа слева,
 * наблюдение справа; деление съедало треть ширины постоянно, а таблицы баз и сеансов
 * широкие. Наблюдение от переключения вкладок НЕ прерывается — за командами следит сама
 * панель (useBatchWatch), а не вкладка; счётчик у «Прогресса» говорит, идёт ли что-то.
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
import { FC, useMemo, useState } from "react";
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
import ProcessesTab from "./ProcessesTab";
import ProgressTab from "./ProgressTab";
import SettingsTab from "./SettingsTab";
import { useBatchWatch } from "./progress";
import main from "src/styles/main.module.scss";

type Tab = "bases" | "cluster" | "extensions" | "users" | "agents" | "progress" | "settings";

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
		{
			id: "agents",
			label: translate("onecTabAgents"),
			component: tab === "agents" ? <AgentsTab /> : null,
		},
		{
			// Наблюдение — В ОБЩЕМ РЯДУ ВКЛАДОК, после «Агентов». Счётчик говорит, идёт ли
			// что-то, и этого довольно, чтобы решить, заглядывать ли: само наблюдение от
			// переключения вкладок не прерывается (см. useBatchWatch выше).
			id: "progress",
			label: running ? `${translate("onecTabProgress")} (${running})` : translate("onecTabProgress"),
			component: tab === "progress" ? <ProgressSection watch={watch} /> : null,
		},
		{
			// Настройки — то, что панель знает о среде, а узнать сама не может: под каким
			// именем сервер виден снаружи. Агент этого не знает и знать не обязан.
			id: "settings",
			label: translate("onecTabSettings"),
			component: tab === "settings" ? <SettingsTab /> : null,
		},
	], [tab, running, watch]);

	return (
		<div className={main.PaneFill}>
			<Tabs tabs={tabs} activeTab={tab} onTabChange={(id) => setTab(id as Tab)} />
		</div>
	);
};

export default OneCAdminList;
