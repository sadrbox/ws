/**
 * Базы 1С — ШТАТНЫЙ список и форма элемента (E15/L2–L5).
 *
 * Раньше базы жили самодельной таблицей внутри «Администрирования 1С»: своё открытие
 * элемента, свой предпросмотр, свой множественный выбор. Здесь то же самое сделано общим
 * паттерном — `ModelList` + `ModelForm`, — поэтому список ведёт себя как все остальные:
 * курсорная подгрузка, поиск, сортировка, отметки строк, split-предпросмотр по кнопке
 * «Переключить вид списка», открытие элемента отдельным пейном и «Показать в списке».
 *
 * СОЗДАНИЕ И УДАЛЕНИЕ НЕПРИМЕНИМЫ: базы заводят и удаляют в кластере 1С, а не в панели.
 * Отсюда `hideAddDelete` — тот же режим, что у справочников, наполняемых системой.
 */
import { useRunningCommand } from "src/components/TechMessages/operations";
import { finishOp } from "src/models/OneCAdmin/progress";
import { startOp } from "src/models/OneCAdmin/progress";
import { useOnecWrite } from "src/models/OneCAdmin/shared";
import { FC, useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAppContext } from "src/app/context";
import ModelList from "src/components/ModelList";
import ModelForm from "src/components/ModelForm";
import Table from "src/components/Table";
import { FormArea, GroupCol, GroupRow } from "src/components/UI";
import { Button } from "src/components/Button";
import { Icon } from "src/components/IconButton/icons";
import Notice from "src/components/Notice";
import { ValueList, ValueRow } from "src/components/ValueList";
import { StateChip, StateChips } from "src/components/StateChip";
import main from "src/styles/main.module.scss";
import { translate } from "src/i18";
import { asText } from "src/utils/asText";
import { getFormatDate } from "src/utils/datetime";
import { getModelColumns } from "src/components/Table/services";
import type { TColumn, TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import type { TTableVariant } from "src/components/Table";
import { buildStaticTableProps } from "src/utils/staticTableProps";
import { useStaticTableView } from "src/hooks/useStaticTableView";
import {
	fetchBaseExtensionsCached, fetchBaseInfo, fetchBaseUsersCached, fetchBases, fetchSessions, refreshBases, type IbExtension, type IbUser, type OnecBase, setScheduledJobs
} from "src/services/onec/api";
import {
	EchoDelayNotice, QueryError, ReadonlyNotice, publishLabel, unreachableReason, unreachableShort,
	useAgents, useBaseContentCheck,
} from "src/models/OneCAdmin/shared";
import { useOpenElement } from "src/models/OneCAdmin/ElementForm";
import { useOpenBaseUser } from "src/models/OneCAdmin/BaseUserForm";
import BaseGroupCommands from "src/models/OneCAdmin/BaseGroupCommands";
import BaseUserCommands from "src/models/OneCAdmin/BaseUserCommands";
import BaseCredentialsTab from "./BaseCredentials";
import BaseAvailability from "./BaseAvailability";
import BasePublication from "./BasePublication";
import { withOp } from "src/models/OneCAdmin/progress";
import { useNoticeScope, useScopeObject } from "src/components/TechMessages/store";
import { reportError } from "src/services/errors/route";
import { sessionsLockView } from "src/models/OneCAdmin/sessionsLock";
import BaseMaintenance from "./BaseMaintenance";
import columnsJson from "./columns.json";

const ENDPOINT = "onec-bases";
const LIST_NAME = "OneCBasesList";

/** Статус базы человеческим языком (значения приходят из реестра сервиса). */
const statusLabel = (v: string): string => {
	const key = { ONLINE: "onecBaseOnline", MISSING: "onecBaseMissing", DISABLED: "onecBaseDisabled", UNKNOWN: "onecBaseUnknown" }[v];
	return key ? translate(key) : v;
};

/**
 * «Прочитано» — когда содержимое базы читали у самой 1С.
 *
 * Метку ставит либо реестр (кэш хранит время чтения), либо сама проверка в момент
 * ответа агента (см. useBaseContentCheck). Без времени строка не выдаёт себя за свежую.
 */
const seenLabel = (x: { seenAt?: string | null }): string =>
	x.seenAt ? getFormatDate(x.seenAt) : "—";

const extColumns = (): TColumn[] => ([
	{ identifier: "name", type: "string", width: "240px", minWidth: "140px", alignment: "left", visible: true, inlist: true },
	// Синоним — человеческое имя расширения: служебное Имя вида EF_00_00062473 не говорит
	// ни о чём, а в кэше синоним лежит с самого начала и никуда не показывался.
	{ identifier: "synonym", type: "string", width: "240px", minWidth: "140px", alignment: "left", visible: true, inlist: true },
	{ identifier: "version", type: "string", width: "130px", minWidth: "80px", alignment: "left", visible: true, inlist: true },
	{ identifier: "purpose", type: "string", width: "150px", minWidth: "90px", alignment: "left", visible: true, inlist: true },
	{ identifier: "safeMode", type: "string", width: "140px", minWidth: "90px", alignment: "left", visible: true, inlist: true },
	// Когда это читали у самой 1С: таблица наполняется кэшем, и её возраст — часть данных.
	{ identifier: "seenAtLabel", type: "string", width: "170px", minWidth: "110px", alignment: "left", visible: true, inlist: true },
] as unknown as TColumn[]);

const userColumns = (): TColumn[] => ([
	{ identifier: "name", type: "string", width: "220px", minWidth: "130px", alignment: "left", visible: true, inlist: true },
	{ identifier: "fullName", type: "string", width: "240px", minWidth: "140px", alignment: "left", visible: true, inlist: true },
	{ identifier: "disabledLabel", type: "string", width: "120px", minWidth: "80px", alignment: "left", visible: true, inlist: true },
	{ identifier: "rolesLabel", type: "string", width: "260px", minWidth: "140px", alignment: "left", visible: true, inlist: true },
	{ identifier: "seenAtLabel", type: "string", width: "170px", minWidth: "110px", alignment: "left", visible: true, inlist: true },
] as unknown as TColumn[]);

const sessionColumns = (): TColumn[] => ([
	{ identifier: "sessionId", type: "string", width: "90px", minWidth: "60px", alignment: "left", visible: true, inlist: true },
	{ identifier: "userName", type: "string", width: "180px", minWidth: "110px", alignment: "left", visible: true, inlist: true },
	{ identifier: "appId", type: "string", width: "150px", minWidth: "90px", alignment: "left", visible: true, inlist: true },
	{ identifier: "host", type: "string", width: "150px", minWidth: "90px", alignment: "left", visible: true, inlist: true },
	{ identifier: "startedAt", type: "datetime", width: "170px", minWidth: "110px", alignment: "left", visible: true, inlist: true },
] as unknown as TColumn[]);

/**
 * Сеансы базы — из общего среза кластера, по UUID базы. Отдельной команды агенту не нужно:
 * его отбор по базе ломается там, где сеансов нет (см. fetchSessions).
 *
 * НО САМ СОБОЙ СРЕЗ НЕ БЕРЁТСЯ. Открытие карточки ОДНОЙ базы запускало команду в кластер по
 * ВСЕМУ кластеру — и так на каждое открытие: сто карточек = сто команд, причём вкладку
 * «Сеансы» при этом чаще всего не открывают. Теперь срез читается по кнопке, как расширения
 * и пользователи, а `staleTime` позволяет переиспользовать уже полученный вкладкой «Сеансы»
 * ответ вместо нового обращения к 1С.
 */
function useBaseSessions(infobaseId: string, enabled: boolean) {
	const sessions = useQuery({
		queryKey: ["onec", "sessions"], queryFn: fetchSessions,
		enabled,
		staleTime: 30_000,
	});
	const rows = useMemo(
		() => (infobaseId ? (sessions.data?.items ?? []).filter((s) => s.infobase === infobaseId) : []),
		[sessions.data, infobaseId],
	);
	return { rows, query: sessions };
}

/**
 * Вкладки формы и предпросмотра — один и тот же набор: в split-виде показывается ровно то,
 * что откроется в форме, без расхождений.
 *
 * Расширения и пользователи НЕ грузятся сами: каждый такой запрос — вход в базу, десятки
 * секунд и занятый сеанс 1С. Их читают кнопкой.
 */
const useBaseTabs = (row: TDataItem) => {
	const baseKey = asText(row.baseKey);
	// Из карточки базы элемент открывается В КОНТЕКСТЕ ЭТОЙ БАЗЫ: она сразу отмечена,
	// роли и реквизиты взяты из неё.
	// Пользователь базы — своя карточка пары «человек + база»: права у него в каждой
	// базе свои, и общая карточка элемента показывала бы одни, а меняла другие.
	const openBaseUser = useOpenBaseUser();
	const openExt = useOpenElement("extension");
	const [loadSessions, setLoadSessions] = useState(false);

	/**
	 * Пользователи базы читаются ТЕМ ЖЕ механизмом, что и на вкладке «Пользователи баз»
	 * (см. useBaseUsersCheck): операция видна в «Прогрессе запросов и команд», её итог
	 * приходит сообщением, а сводки реестра после неё перечитываются. Раньше здесь был
	 * свой запрос, и одна и та же кнопка на двух экранах делала разное.
	 *
	 * Запрос НЕ включён (`enabled: false`): он существует только ради кэша — проверка
	 * кладёт в него прочитанное, а сам он в 1С не ходит никогда.
	 */
	const usersCheck = useBaseContentCheck("users");
	const extCheck = useBaseContentCheck("extensions");
	// Чтение содержимого базы могло начаться до перезагрузки страницы — иконка крутится до итога.
	const extReading = useRunningCommand(["IB_LIST_EXTENSIONS"], baseKey);
	const usersReading = useRunningCommand(["IB_LIST_USERS"], baseKey);
	// Кого правим: строка, выбранная одиночным щелчком. Двойной по-прежнему открывает
	// карточку пары — кнопка «Изменить» делает тот же жест явным.
	const [activeUser, setActiveUser] = useState("");

	/*
	 * Карточка ОТКРЫВАЕТСЯ КЭШЕМ реестра, а не пустой таблицей.
	 *
	 * Раньше здесь стояла заглушка (`enabled: false`, пустой список): считалось, что
	 * показать нечего, пока человек не нажмёт «Обновить». Но показать было что — всё
	 * прочитанное лежит в реестре сервиса, из него же в списке баз считается колонка
	 * «Расширений». Выходило «панель не показывает расширения базы», хотя она их знает.
	 *
	 * Кэш стоит один запрос к БД сервиса и в 1С не ходит; живое чтение (кнопка «Обновить»)
	 * — это вход в базу на минуты. Возраст данных виден в колонке «Прочитано», поэтому
	 * кэш никого не обманывает: видно и что известно, и насколько это свежо.
	 * `enabled` по ключу базы: без него запрос уходил бы в `/bases//extensions/cached`.
	 */
	const ext = useQuery({
		queryKey: ["onec", "base-ext", baseKey],
		queryFn: (): Promise<{ items: IbExtension[] }> => fetchBaseExtensionsCached(baseKey),
		enabled: !!baseKey,
		staleTime: Infinity,
	});
	const users = useQuery({
		queryKey: ["onec", "base-users", baseKey],
		queryFn: (): Promise<{ items: IbUser[] }> => fetchBaseUsersCached(baseKey),
		enabled: !!baseKey,
		staleTime: Infinity,
	});

	const [extCols, setExtCols] = useState<TColumn[]>(() => getModelColumns(extColumns(), "OneCBases_ext"));
	const [userCols, setUserCols] = useState<TColumn[]>(() => getModelColumns(userColumns(), "OneCBases_users"));
	const [sesCols, setSesCols] = useState<TColumn[]>(() => getModelColumns(sessionColumns(), "OneCBases_sessions"));

	const extRows = (ext.data?.items ?? []).map((x, i) => ({
		id: i + 1, uuid: x.name, name: x.name, synonym: x.synonym || "—",
		version: x.version ?? "—", purpose: x.purpose ?? "—",
		safeMode: x.safeMode == null ? "—" : x.safeMode ? translate("yes") : translate("no"),
		seenAtLabel: seenLabel(x),
	}));
	const extView = useStaticTableView(extRows, { name: "asc" });

	/*
	 * ПОЧЕМУ ВКЛАДКА ПУСТА — В САМОЙ ТАБЛИЦЕ. «Расширений нет» и «их ещё не читали» —
	 * разные ответы, и второй требует действия человека. Раньше это уходило сообщением в
	 * «Технические сообщения» и висело там, пока открыта карточка: очистка его не брала (и
	 * не могла — форма сообщала его заново), а список выглядел незакрывающимся. Место
	 * объяснения — там, где человек ищет данные.
	 */
	const extEmptyText = !ext.isLoading && !ext.error && !extRows.length
		? translate("onecExtNeverRead") : undefined;

	const userRows = (users.data?.items ?? []).map((x, i) => ({
		id: i + 1, uuid: x.name, name: x.name, fullName: x.fullName || "—",
		disabledLabel: x.disabled ? translate("onecUserDisabled") : translate("onecUserActive"),
		rolesLabel: (x.roles ?? []).join(", ") || "—",
		seenAtLabel: seenLabel(x),
	}));
	const userView = useStaticTableView(userRows, { name: "asc" });
	const usersEmptyText = !users.isLoading && !users.error && !userRows.length
		? translate("onecUsersNeverRead") : undefined;

	const own = useBaseSessions(asText(row.infobaseId), loadSessions);
	const sesRows = own.rows.map((s, i) => ({
		id: i + 1, uuid: s.session ?? String(i), sessionId: s.sessionId || "—",
		userName: s.userName || "—", appId: s.appId || "—", host: s.host || "—",
		startedAt: s.startedAt ? getFormatDate(s.startedAt) : "—",
	}));
	const sesView = useStaticTableView(sesRows, { sessionId: "asc" });

	return [
		{
			id: "ext", label: translate("onecTabExtensions"),
			component: (
				<>
					{/*
					  * Пустая таблица молчит о причине: расширений у базы нет — или их ещё
					  * никто не читал? Это разные вещи, и вторая требует действия человека.
					  * Сообщение уходит НА ДОСКУ карточки (полоса внизу): вставленное над
					  * таблицей, оно сдвигало бы её вниз при каждом появлении.
					  */}
					<QueryError error={ext.error} noticeKey="base-ext" source={translate("onecTabExtensions")} />
					<Table {...buildStaticTableProps({
						componentName: "OneCBases_ext", rows: extView.rows, columns: extCols, setColumns: setExtCols,
						emptyText: extEmptyText,
						onRowClick: (r) => openExt(r, baseKey),
						sorting: extView.sorting, search: extView.search,
						isLoading: ext.isLoading,
						reloading: extCheck.checking || extReading,
						// «Обновить» = войти в базу и прочитать её расширения у самой 1С.
						// Таблица при этом показывает известное из реестра: гасить её незачем.
						onReload: () => void extCheck.run([baseKey]),
						reloadTitle: translate("onecExtCheck"),
					})} />
				</>
			),
		},
		{
			id: "users", label: translate("onecTabUsers"),
			component: (
				<>
					<QueryError error={users.error} noticeKey="base-users" source={translate("onecTabUsers")} />
					{/* Создание, правка и удаление идут отсюда: если агент не умеет приносить
					    состояние ответом, таблица обновится с задержкой — и об этом лучше знать. */}
					<EchoDelayNotice />
					<Table {...buildStaticTableProps({
						componentName: "OneCBases_users", rows: userView.rows, columns: userCols, setColumns: setUserCols,
						emptyText: usersEmptyText,
						onRowClick: (r) => openBaseUser(asText(r.name), baseKey),
						sorting: userView.sorting, search: userView.search,
						isLoading: users.isLoading,
						reloading: usersCheck.checking || usersReading,
						// «Обновить» = войти в базу и прочитать её пользователей у 1С.
						// Отдельной кнопки «Проверить пользователей» здесь больше нет: она
						// делала ровно это же, и две кнопки одного действия только спорили,
						// какая «настоящая».
						onReload: () => void usersCheck.run([baseKey]),
						reloadTitle: translate("onecUsersCheck"),
						onActiveRowChange: (r) => setActiveUser(r ? asText(r.name) : ""),
						// Создать, изменить, удалить — по ЭТОЙ базе; роли читаются из неё же.
						extraButtons: (
							// После создания и удаления таблица обновится из реестра по завершении
							// команды (R7-П1): живое чтение базы здесь лишнее, а склеенное с раньше
							// поставленным отдавало список ДО изменения.
							<BaseUserCommands baseKey={baseKey} activeUser={activeUser} />
						),
					})} />
				</>
			),
		},
		{
			// Обслуживание — операции над самой базой: проверка, выгрузка, загрузка,
			// обновление конфигурации. Все они об одном и том же и стоят часов работы
			// сервера, поэтому живут в карточке базы, а не в списке.
			id: "maintenance", label: translate("onecTabMaintenance"),
			component: <BaseMaintenance baseKey={baseKey} />,
		},
		{
			// Доступ — отдельной вкладкой: это НАСТРОЙКА базы, а не её состояние, и
			// смешивать её со списками пользователей и расширений нельзя.
			id: "access", label: translate("onecTabAccess"),
			component: <BaseCredentialsTab baseKey={baseKey} />,
		},
		{
			id: "sessions", label: translate("onecTabSessions"),
			component: (
				<>
					{/* Ошибку среза показываем здесь же: раньше вкладка молчала — ни данных,
					    ни причины, хотя команда в кластер могла отказать. */}
					<QueryError error={own.query.error} noticeKey="base-sessions" source={translate("onecTabSessions")} />
					<Table {...buildStaticTableProps({
						componentName: "OneCBases_sessions", rows: sesView.rows, columns: sesCols, setColumns: setSesCols,
						sorting: sesView.sorting, search: sesView.search,
						isLoading: own.query.isLoading && !own.rows.length,
						reloading: own.query.isFetching,
						// Живое состояние кластера: обновление всегда спрашивает его.
						onReload: () => { setLoadSessions(true); if (loadSessions) void own.query.refetch(); },
						reloadTitle: translate("onecSessionsShow"),
					})} />
				</>
			),
		},
	];
};

/** Запись реестра → строка карточки. Один код на открытие и на обновление после команд. */
const baseToRow = (b: OnecBase): TDataItem => ({
	baseKey: b.key, name: b.name, status: b.status, serverName: b.serverName,
	onecVersion: b.onecVersion, extensionsCount: b.extensionsCount,
	published: b.published, publishUrl: b.publishUrl,
	publishUrlPublic: b.publishUrlPublic, publishSeenAt: b.publishSeenAt,
	ibUnreachableAt: b.ibUnreachableAt, ibUnreachableReason: b.ibUnreachableReason,
	disabled: b.disabled,
	lastSeenAt: b.lastSeenAt, infobaseId: b.infobaseId,
	sessionsDenied: b.sessionsDenied ?? null, sessionsDeniedMessage: b.sessionsDeniedMessage ?? null,
	sessionsDeniedFrom: b.sessionsDeniedFrom ?? null, sessionsDeniedTo: b.sessionsDeniedTo ?? null,
	sessionsDeniedSource: b.sessionsDeniedSource ?? null, sessionsDeniedActive: b.sessionsDeniedActive ?? null,
	sessionsDeniedSeenAt: b.sessionsDeniedSeenAt ?? null, sessionsDeniedCodeSet: b.sessionsDeniedCodeSet ?? null,
	configName: b.configName ?? null, configVersion: b.configVersion ?? null, configSeenAt: b.configSeenAt ?? null,
	// Запрет регламентных заданий (С39, С40): без этих полей карточка показывала прочерк, хотя реестр их знает.
	scheduledJobsDenied: b.scheduledJobsDenied ?? null, scheduledJobsSeenAt: b.scheduledJobsSeenAt ?? null,
	scheduledJobsSource: b.scheduledJobsSource ?? null,
} as unknown as TDataItem);

/**
 * Конфигурация со временем чтения (С35): «БухгалтерияПредприятия 3.0.180.20 · прочитано …». Не читали — «—»;
 * прочитана без версии — «версия не задана»: это ответ базы, а не незнание.
 */
const configLabel = (row: TDataItem): string => {
	const name = asText(row.configName);
	const version = asText(row.configVersion);
	const seenAt = row.configSeenAt ? asText(row.configSeenAt) : "";
	if (!name && !version && !seenAt) return "—";
	const text = [name, version || (seenAt ? translate("onecConfigVersionNotSet") : "")].filter(Boolean).join(" ");
	return seenAt ? `${text} · ${translate("onecConfigReadAt")} ${getFormatDate(seenAt)}` : text;
};

/**
 * Форма элемента: шапка полями + вложенные таблицы во вкладках. Только чтение.
 *
 * Пейн передаёт компоненту СЕБЯ (`<Component {...pane} />`), поэтому строка лежит в
 * `data`, а не в корне пропсов: читать props как строку — значит получить пустые поля
 * и пустой ключ базы, с которым запросы уходят в `/bases//extensions`.
 */
export const OneCBasesForm: FC<Partial<TPane>> = (paneProps) => {
	const opened = (paneProps.data ?? {}) as TDataItem;
	/*
	 * КАРТОЧКА ЧИТАЕТ РЕЕСТР, А НЕ ТОЛЬКО СНИМОК, С КОТОРЫМ ЕЁ ОТКРЫЛИ.
	 *
	 * Пейн передаёт строку таблицы — то, как база выглядела в момент двойного щелчка. Пока
	 * карточка показывала ТОЛЬКО её, любая команда оставляла экран в прошлом: опубликовали
	 * базу, задание отработало, реестр обновился, а в открытой карточке по-прежнему «не
	 * опубликована» — до перезагрузки страницы. Теперь поверх снимка ложится текущая запись
	 * реестра, а реестр перечитывается сам после каждой завершившейся работы (см.
	 * refreshAfterWork в OneCAdmin/progress).
	 *
	 * Снимок остаётся основой: базы может не быть в реестре (её только что завели), и
	 * показывать пустую карточку вместо известных реквизитов было бы хуже.
	 */
	const key = asText(opened.baseKey);
	// Объект карточки: сообщения и итоги операций по базе открывают эту карточку.
	useScopeObject(key ? { endpoint: "onec-bases", uuid: key, label: key } : undefined);
	const registry = useQuery({ queryKey: ["onec", "bases"], queryFn: fetchBases, enabled: !!key });
	const fresh = useMemo(
		() => (registry.data?.items ?? []).find((b) => b.key.toLowerCase() === key.toLowerCase()),
		[registry.data, key],
	);
	const row = useMemo(() => (fresh ? { ...opened, ...baseToRow(fresh) } : opened), [fresh, opened]);
	const tabs = useBaseTabs(row);
	// «Закрыть» в командной панели формы НИЧЕГО не делала: обработчик был пустой
	// заглушкой. Кнопка, которая рисуется и не работает, хуже отсутствующей.
	const { requestClose } = useAppContext().windows;
	const close = useCallback(() => {
		if (paneProps.uniqId) void requestClose(paneProps.uniqId);
	}, [requestClose, paneProps.uniqId]);

	/*
	 * ПЛАТФОРМА. Поле `onecVersion` у базы заполняет агент в срезе баз — и не заполняет:
	 * во всех 111 записях реестра оно пустое. Поэтому спрашиваем агента САМОГО СЕРВЕРА:
	 * платформа у всех баз одного сервера одна, и это тот же факт, только с другой
	 * стороны. Когда не знает никто — так и пишем: «—» читается как «нет версии», а
	 * версия есть всегда, просто её не сообщили.
	 */
	const agents = useAgents();
	/** Код причины и полное объяснение — нужны и метке, и строке состояния. */
	const reasonCode = row.ibUnreachableReason ? asText(row.ibUnreachableReason) : null;
	const unreachableTitle = row.ibUnreachableAt
		? unreachableReason({
			status: asText(row.status), disabled: row.disabled === true,
			ibUnreachableAt: asText(row.ibUnreachableAt), ibUnreachableReason: reasonCode,
		})
		: undefined;
	const platform = asText(row.onecVersion)
		|| (agents.data?.items ?? []).find((a) => a.role === "admin" && a.platform)?.platform
		|| translate("onecPlatformUnknown");

	/*
	 * СВЕДЕНИЯ О БАЗЕ (С35). Версию конфигурации агент сам не читает — только по кнопке: один вход в базу за
	 * конфигурацией, расширениями и блокировкой. Это чтение — кнопка есть и у просмотра. Сборка агента без
	 * `IB_INFO` — кнопка недоступна и говорит почему (на связи агент или нет, объявленное он не забывает).
	 */
	const scope = useNoticeScope();
	const infoKnown = agents.isLoading || (agents.data?.items ?? [])
		.some((a) => a.role === "admin" && !a.disabled && a.capabilities.includes("IB_INFO"));
	/*
	 * ЗАПРЕТ РЕГЛАМЕНТНЫХ ЗАДАНИЙ (С39, П26). Фоновое задание базы держит её разделённым доступом: установка
	 * расширения, выгрузка и проверка отказывают «Ошибка разделенного доступа», а блокировка входа фоновые задания
	 * не останавливает. Кнопка здесь же, где видно состояние базы, — чтобы не искать её по вкладкам во время работ.
	 */
	const cardQc = useQueryClient();
	const canWrite = useOnecWrite();
	const jobsDenied = (row.scheduledJobsDenied ?? null) as boolean | null;
	/*
	 * Команду знает агент со сборки `2026-09-16 12:13`. Старый агент её не выполнит, и активная кнопка обещала бы
	 * то, чего не будет: так же, как «Обновить сведения», гасим её и говорим почему.
	 */
	const jobsKnown = agents.isLoading || (agents.data?.items ?? [])
		.some((a) => a.role === "admin" && !a.disabled && a.capabilities.includes("CLUSTER_SET_SCHEDULED_JOBS"));
	/*
	 * «ВЕРНУТЬ КАК БЫЛО» (П27). Ответ несёт `was` — состояние до команды. Переключатель его не знает: после работ человек
	 * не помнит, были ли задания запрещены до него. Запоминаем `was` у базы (в браузере — переживёт перезагрузку) и
	 * предлагаем вернуть именно его, пока текущее состояние от него отличается.
	 */
	const wasKey = `onec_jobs_was_${key}`;
	const [jobsWas, setJobsWas] = useState<boolean | null>(() => {
		try { const v = localStorage.getItem(wasKey); return v === "true" ? true : v === "false" ? false : null; } catch { return null; }
	});
	const rememberWas = (v: boolean | null) => {
		setJobsWas(v);
		try { if (v === null) localStorage.removeItem(wasKey); else localStorage.setItem(wasKey, String(v)); } catch { /* хранилище недоступно */ }
	};
	// Запрет заданий и чтение сведений могли начаться до перезагрузки страницы — кнопки заняты до итога.
	const jobsRunning = useRunningCommand(["CLUSTER_SET_SCHEDULED_JOBS"], key);
	const infoRunning = useRunningCommand(["IB_INFO"], key);
	const setJobs = useMutation({
		mutationFn: async (p: { denied: boolean; restore?: boolean }) => {
			const op = startOp({
				kind: "update", title: translate(p.denied ? "onecScheduledJobsDeny" : "onecScheduledJobsAllow"),
				target: key, total: 1, scope: { bases: [key] },
			});
			try {
				const r = await setScheduledJobs(key, p.denied);
				/*
				 * ИТОГ ПО ФАКТУ, А НЕ ПО НАЖАТИЮ. `denied` — прочитано после записи; расходится с запросом — задания
				 * остались, как были; нет вовсе — кластер не отдал состояние. Оговорки сервиса (С41) — туда же.
				 */
				const warning = [
					r?.caveat,
					typeof r?.denied === "boolean" && r.denied !== p.denied ? translate("onecScheduledJobsNotApplied") : "",
					!r?.caveat && r?.unverified?.includes("denied") ? translate("onecScheduledJobsUnverified") : "",
				].filter(Boolean).join(". ");
				finishOp(op, warning ? { warning } : {});
				return r;
			} catch (e) {
				finishOp(op, { failed: 1, note: e instanceof Error ? e.message : String(e), error: e });
				throw e;
			}
		},
		onSuccess: (r, p) => {
			if (p.restore) rememberWas(null);
			// Запоминаем исходное только у первой команды серии работ: второй запрет подряд не должен затереть «как было».
			else if (typeof r?.was === "boolean" && jobsWas === null && r.was !== p.denied) rememberWas(r.was);
			void cardQc.invalidateQueries({ queryKey: ["onec", "bases"] });
		},
		onError: (e: unknown) => reportError(e, { source: translate("onecScheduledJobs"), scope }),
	});

	const readInfo = useMutation({
		mutationFn: () => withOp(
			{ kind: "read", title: translate("onecBaseInfoRefresh"), target: key, scope: { bases: [key] } },
			() => fetchBaseInfo(key),
		),
		// Итог операции об отказе уже сказал — маршрутизатор покажет только тост.
		onError: (e: unknown) => reportError(e, { source: translate("onecBaseInfoRefresh"), scope }),
	});

	return (
		<ModelForm
			paneId={paneProps.uniqId}
			endpoint={ENDPOINT}
			readonly
			isLoading={false}
			// Реестр наполняется кластером и агентом — править и сохранять нечего.
			onSave={() => {}} onSaveAndClose={() => {}} onClose={close}
			tabs={[
				{
					id: "main", label: translate("general"),
					/*
					 * Каркас формы — общий для всего приложения (см. SalesForm): контейнер,
					 * колонка полей шириной под чтение и колонка сообщений справа снизу.
					 * Раньше карточка базы рисовала поля голым GroupCol во всю ширину —
					 * ряды растягивались на весь экран, и форма не была похожа ни на одну
					 * другую в системе.
					 */
					component: (
						<div className={main.FormContainer}>
							<div className={main.FormWrapper}>
								<GroupCol className={main.Form}>
									{/*
									  * СОСТОЯНИЕ — МЕТКАМИ, ДО ЧТЕНИЯ. С вопросом «что с ней сейчас»
									  * карточку и открывают, а в общем списке ответ стоял третьей строкой
									  * наравне с именем сервера: чтобы узнать, опубликована ли база,
									  * приходилось прочитать семь строк. Слово в метке говорит то же, что и
									  * цвет, — цвет лишь помогает найти её взглядом.
									  */}
									<FormArea title={translate("state")}>
										<StateChips>
											<StateChip
												tone={row.disabled === true ? "unknown" : row.ibUnreachableAt ? "bad" : "ok"}
												title={unreachableTitle}>
												{row.disabled === true
													? translate("onecBaseDisabled")
													: row.ibUnreachableAt
														? unreachableShort(reasonCode)
														: statusLabel(asText(row.status))}
											</StateChip>
											<StateChip tone={row.published === true ? "ok" : row.published === false ? "bad" : "unknown"}>
												{publishLabel(row.published as boolean | null)}
											</StateChip>
											<StateChip tone={row.extensionsCount == null ? "unknown" : "neutral"}>
												{row.extensionsCount == null
													? translate("onecExtNotChecked")
													: `${translate("extensionsCount")}: ${asText(row.extensionsCount)}`}
											</StateChip>
											{/*
											  * Запрещённые регламентные задания — меткой в состоянии: это временное положение на время работ,
											  * и о нём надо помнить, чтобы разрешить задания обратно.
											  */}
											{row.scheduledJobsDenied === true && (
												<StateChip tone="bad" title={translate("onecScheduledJobsHint")}>
													{translate("onecScheduledJobsDeniedChip")}
												</StateChip>
											)}
											{/* Вход в базу: закрыт ли он сейчас — видно без перехода на «Сеансы». */}
											{(() => {
												const lock = sessionsLockView(row as never);
												return lock.known
													? <StateChip tone={lock.tone} title={lock.details || undefined}>{lock.label}</StateChip>
													: null;
											})()}
										</StateChips>
									</FormArea>

									{/*
									  * ЗДЕСЬ НЕЧЕГО ПРАВИТЬ — и показано это списком «подпись — значение», а
									  * не выключенными полями ввода. Поле с рамкой и серым фоном обещает
									  * правку, которой нет: по нему щёлкают, ничего не происходит, и человек
									  * идёт искать, где она включается.
									  *
									  * ДВА СТОЛБЦА: семь реквизитов в один занимали высоту всей вкладки, а
									  * правая половина ширины пустовала — публикация уезжала за нижний край.
									  * Порядок в разметке и есть порядок чтения: слева направо, сверху вниз.
									  */}
									<FormArea title={translate("props")}>
										<ValueList columns={2}>
											<ValueRow label={translate("baseKey")} value={asText(row.baseKey)} />
											<ValueRow label={translate("onecServer")} value={asText(row.serverName)} />
											<ValueRow label={translate("name")} value={asText(row.name)} />
											<ValueRow label={translate("onecVersion")} value={platform} />
											<ValueRow label={translate("status")} title={unreachableTitle}
												value={row.ibUnreachableAt
													? unreachableShort(reasonCode)
													: statusLabel(asText(row.status))} />
											<ValueRow label={translate("lastSeenAt")}
												value={row.lastSeenAt ? getFormatDate(asText(row.lastSeenAt)) : "—"} />
											{/* Конфигурация — из эха загрузки, обновления, установки расширения и из «Обновить
											    сведения» (S3, С35) — со временем чтения; платформа — строкой выше. */}
											<ValueRow label={translate("onecConfiguration")} value={configLabel(row)} />
											<ValueRow label={translate("onecScheduledJobs")}
												value={jobsDenied == null
													? "—"
													: `${translate(jobsDenied ? "onecScheduledJobsDeniedLabel" : "onecScheduledJobsAllowedLabel")}`
														// Время — только у прочитанного у кластера; записанное по команде так и называем (С40).
														+ (row.scheduledJobsSource === "command"
															? ` · ${translate("onecScheduledJobsByCommand")}`
															: row.scheduledJobsSeenAt ? ` · ${getFormatDate(asText(row.scheduledJobsSeenAt))}` : "")} />
											<ValueRow label={translate("onecSessionsLockState")}
												title={sessionsLockView(row as never).details || undefined}
												value={sessionsLockView(row as never).label} />
										</ValueList>
										<GroupRow>
											<Button variant={jobsDenied ? "primary" : "secondary"}
												disabled={!key || !canWrite || !jobsKnown || setJobs.isPending || jobsRunning}
												title={jobsKnown
													? translate("onecScheduledJobsHint")
													: `${translate("onecAgentMissing")}: ${translate("onecScheduledJobs")}. ${translate("onecAgentUpdateHint")}`}
												onClick={() => setJobs.mutate({ denied: !jobsDenied })}>
												{translate(jobsDenied ? "onecScheduledJobsAllow" : "onecScheduledJobsDeny")}
											</Button>
											{jobsWas !== null && jobsWas !== jobsDenied && (
												<Button variant="primary"
													disabled={!key || !canWrite || !jobsKnown || setJobs.isPending || jobsRunning}
													title={translate(jobsWas ? "onecScheduledJobsDeniedLabel" : "onecScheduledJobsAllowedLabel")}
													onClick={() => setJobs.mutate({ denied: jobsWas, restore: true })}>
													{translate("onecScheduledJobsRestore")}
												</Button>
											)}
											<Button variant="secondary" disabled={!key || !infoKnown || readInfo.isPending || infoRunning}
												title={infoKnown
													? translate("onecBaseInfoHint")
													: `${translate("onecAgentMissing")}: ${translate("onecFeatureInfo")}. ${translate("onecAgentUpdateHint")}`}
												onClick={() => readInfo.mutate()}>
												<Icon name="reload" /> {translate("onecBaseInfoRefresh")}
											</Button>
										</GroupRow>
									</FormArea>

									{/* Доступность: почему в базу не войти и что панель может с этим
									    сделать. Молчит, пока всё в порядке. */}
									<BaseAvailability baseKey={asText(row.baseKey)}
										status={asText(row.status)}
										hidden={row.disabled === true}
										ibUnreachableAt={row.ibUnreachableAt ? asText(row.ibUnreachableAt) : null}
										ibUnreachableReason={row.ibUnreachableReason ? asText(row.ibUnreachableReason) : null} />

									{/* Публикация — со своими командами по ЭТОЙ базе: в списке те же команды
									    групповые, здесь цель уже выбрана и она на экране. */}
									<BasePublication baseKey={asText(row.baseKey)}
										serverName={row.serverName ? asText(row.serverName) : null}
										published={row.published as boolean | null}
										publishUrl={row.publishUrl ? asText(row.publishUrl) : null}
										publishUrlPublic={row.publishUrlPublic ? asText(row.publishUrlPublic) : null}
										seenAt={row.publishSeenAt ? asText(row.publishSeenAt) : null} />
								</GroupCol>

								<GroupCol className={main.FormNotice}>
									{/* Реестр наполняют кластер и агент: править здесь нечего, и это
									    должно быть сказано, а не додумано по серым полям. */}
									<Notice inline items={[{ type: "info", text: translate("onecBaseCardReadonly") }]} />
									{/* А если и команд карточки не видно — причина в правах, и сказать
									    об этом надо в самой карточке: её вкладки живут своей доской. */}
									<ReadonlyNotice />
								</GroupCol>
							</div>
						</div>
					),
				},
				...tabs,
			]}
		/>
	);
};
OneCBasesForm.displayName = "OneCBasesForm";

/**
 * Открыть карточку «База 1С» отдельным пейном.
 *
 * ЗАЧЕМ ХУК. Строка таблицы баз встречается на пяти экранах, и по двойному щелчку из неё
 * должна открываться карточка ЕЁ типа — базы, а не того, ради чего таблицу показали.
 * Реквизиты берём из уже загруженного реестра: карточка ждёт строку целиком, а на руках
 * у вызывающего часто только ключ.
 */
export function useOpenOnecBase() {
	const { addPane } = useAppContext().windows;
	const qc = useQueryClient();
	return (base: string | TDataItem) => {
		const key = typeof base === "string" ? base : asText(base.baseKey);
		if (!key) return;
		const cached = qc.getQueryData<{ items?: OnecBase[] }>(["onec", "bases"])?.items ?? [];
		const found = cached.find((b) => b.key.toLowerCase() === key.toLowerCase());
		const row: TDataItem = found
			? baseToRow(found)
			: (typeof base === "string" ? ({ baseKey: key } as unknown as TDataItem) : base);
		addPane({ label: `${translate("onecBase")}: ${key}`, component: OneCBasesForm as never, data: row });
	};
}

/** Вкладки предпросмотра в split-виде — те же, что и в форме. */
const PreviewTabs: FC<{ row: TDataItem }> = ({ row }) => <>{useBaseTabs(row)[0].component}</>;

export const OneCBasesList: FC<{
	variant?: TTableVariant;
	onSelectItem?: (item: TDataItem) => void;
}> = ({ variant, onSelectItem }) => {
	// Платформа: у баз она пуста (агент не заполняет поле в срезе), поэтому подставляем
	// версию сервера, за который отвечает админ-агент, — см. карточку базы.
	const agents = useAgents();
	const platform = (agents.data?.items ?? []).find((a) => a.role === "admin" && a.platform)?.platform ?? "";
	return (
	<ModelList
		endpoint={ENDPOINT}
		listName={LIST_NAME}
		columnsJson={columnsJson}
		FormComponent={OneCBasesForm as never}
		getLabel={(d) => asText(d?.baseKey)}
		defaultSort={{ baseKey: "asc" }}
		/*
		 * «Обновить» спрашивает КЛАСТЕР, а не перерисовывает снимок. Список баз — кэш:
		 * базы заводит и удаляет кластер, и обновление, которое читает только наш кэш,
		 * честно показывает вчерашний состав, называя это обновлением. Отдельная кнопка
		 * «Обновить из кластера» после этого не нужна: у обновления один смысл.
		 */
		onReload={() => withOp(
			{ kind: "read", title: translate("onecRefreshFromCluster"), target: translate("onecTabBases") },
			refreshBases,
		)}
		// Создание и удаление неприменимы: базы приходят из кластера 1С.
		hideAddDelete
		variant={variant}
		onSelectItem={onSelectItem}
		// Состояние публикации хранится булевым (с «не проверялась» = null), а подпись
		// к нему — дело интерфейса: в API текста для человека быть не должно.
		// Значение обёрнуто в <span>, как и штатный рендер ячейки: голая строка ложится
		// прямым потомком ячейки и выпадает из общей вёрстки (обрезка, выравнивание).
		renderCell={(row, col) => {
			if (col.identifier === "published") return <span>{publishLabel(row.published as boolean | null)}</span>;
			/*
			 * Состояние: у фантома кластер отвечает ONLINE — запись в кластере есть, самой
			 * базы нет. Показывать такую базу как рабочую значит звать в неё командой,
			 * которая заведомо откажет; поэтому состояние называет именно это.
			 */
			if (col.identifier === "status") {
				const reason = row.ibUnreachableReason ? asText(row.ibUnreachableReason) : null;
				return (
					<span title={row.ibUnreachableAt
						? unreachableReason({
							status: asText(row.status), disabled: row.disabled === true,
							ibUnreachableAt: asText(row.ibUnreachableAt), ibUnreachableReason: reason,
						})
						: undefined}>
						{row.ibUnreachableAt ? unreachableShort(reason) : statusLabel(asText(row.status))}
					</span>
				);
			}
			// «—» читалось бы как «версии нет»; версия есть всегда, её просто не сообщили.
			if (col.identifier === "onecVersion") {
				return <span>{asText(row.onecVersion) || platform || translate("onecPlatformUnknown")}</span>;
			}
			/*
			 * Адрес публикации — тоже скрыт по умолчанию: он длинный, а нужен точечно.
			 * «—» у неопубликованной базы — не пропуск, а отсутствие адреса как такового.
			 *
			 * Показываем адрес ПОД ПУБЛИЧНЫМ ИМЕНЕМ сервера, если оно задано в параметрах агента;
			 * подсказка хранит то, что сказал агент, — расхождение между ними и есть повод
			 * проверить привязку сайта.
			 */
			if (col.identifier === "publishUrl") {
				const shown = asText(row.publishUrlPublic) || asText(row.publishUrl);
				const raw = asText(row.publishUrl);
				return <span title={shown && raw && shown !== raw ? raw : undefined}>{shown || "—"}</span>;
			}
			return undefined;
		}}
		previewTabs={(row) => [{ id: "ext", label: translate("onecTabExtensions"), component: <PreviewTabs row={row} /> }]}
		// Групповые команды по отмеченным базам. Отметки — заготовка: набор целей,
		// параметры и «что произойдёт» спрашивает помощник, он же заводит задание.
		extraButtons={(selected) => <BaseGroupCommands selected={selected} />}
	/>
	);
};
OneCBasesList.displayName = "OneCBasesList";

export default OneCBasesList;
