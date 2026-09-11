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
import { FC, useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAppContext } from "src/app/context";
import ModelList from "src/components/ModelList";
import ModelForm from "src/components/ModelForm";
import Table from "src/components/Table";
import { Field } from "src/components/Field";
import { Group, GroupCol, GroupRow } from "src/components/UI";
import Notice from "src/components/Notice";
import main from "src/styles/main.module.scss";
import { translate } from "src/i18";
import { FIELD_WIDTH } from "src/components/Field/fieldWidths";
import { asText } from "src/utils/asText";
import { getFormatDate } from "src/utils/datetime";
import { getModelColumns } from "src/components/Table/services";
import type { TColumn, TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import type { TTableVariant } from "src/components/Table";
import { buildStaticTableProps } from "src/utils/staticTableProps";
import { useStaticTableView } from "src/hooks/useStaticTableView";
import {
	fetchBaseExtensionsCached, fetchBaseUsersCached, fetchSessions, refreshBases,
	type IbExtension, type IbUser, type OnecBase,
} from "src/services/onec/api";
import { QueryError, publishLabel, useAgents, useBaseContentCheck } from "src/models/OneCAdmin/shared";
import { NoticeScope, useNoticeReport, useNoticeScope } from "src/models/OneCAdmin/notices";
import NoticeBoard from "src/models/OneCAdmin/NoticeBoard";
import { useOpenElement } from "src/models/OneCAdmin/ElementForm";
import { useOpenBaseUser } from "src/models/OneCAdmin/BaseUserForm";
import BaseGroupCommands from "src/models/OneCAdmin/BaseGroupCommands";
import BaseUserCommands from "src/models/OneCAdmin/BaseUserCommands";
import BaseCredentialsTab from "./BaseCredentials";
import BasePublication from "./BasePublication";
import { withOp } from "src/models/OneCAdmin/progress";
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
	{ identifier: "startedAt", type: "string", width: "170px", minWidth: "110px", alignment: "left", visible: true, inlist: true },
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
	 * Почему вкладка пуста — сообщением, а не блоком над таблицей. «Расширений нет» и
	 * «их ещё не читали» — разные ответы, и второй требует действия человека.
	 */
	const scope = useNoticeScope();
	useNoticeReport(scope, "base-ext-empty", translate("onecTabExtensions"),
		!ext.isLoading && !ext.error && !extRows.length
			? [{ type: "info", text: translate("onecExtNeverRead") }] : []);

	const userRows = (users.data?.items ?? []).map((x, i) => ({
		id: i + 1, uuid: x.name, name: x.name, fullName: x.fullName || "—",
		disabledLabel: x.disabled ? translate("onecUserDisabled") : translate("onecUserActive"),
		rolesLabel: (x.roles ?? []).join(", ") || "—",
		seenAtLabel: seenLabel(x),
	}));
	const userView = useStaticTableView(userRows, { name: "asc" });
	useNoticeReport(scope, "base-users-empty", translate("onecTabUsers"),
		!users.isLoading && !users.error && !userRows.length
			? [{ type: "info", text: translate("onecUsersNeverRead") }] : []);

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
						onRowClick: (r) => openExt(r, baseKey),
						sorting: extView.sorting, search: extView.search,
						isLoading: ext.isLoading,
						reloading: extCheck.checking,
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
					<Table {...buildStaticTableProps({
						componentName: "OneCBases_users", rows: userView.rows, columns: userCols, setColumns: setUserCols,
						onRowClick: (r) => openBaseUser(asText(r.name), baseKey),
						sorting: userView.sorting, search: userView.search,
						isLoading: users.isLoading,
						reloading: usersCheck.checking,
						// «Обновить» = войти в базу и прочитать её пользователей у 1С.
						// Отдельной кнопки «Проверить пользователей» здесь больше нет: она
						// делала ровно это же, и две кнопки одного действия только спорили,
						// какая «настоящая».
						onReload: () => void usersCheck.run([baseKey]),
						reloadTitle: translate("onecUsersCheck"),
						onActiveRowChange: (r) => setActiveUser(r ? asText(r.name) : ""),
						// Создать, изменить, удалить — по ЭТОЙ базе; роли читаются из неё же.
						extraButtons: (
							<BaseUserCommands baseKey={baseKey} activeUser={activeUser}
								onDone={() => void usersCheck.run([baseKey])} />
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

/**
 * Форма элемента: шапка полями + вложенные таблицы во вкладках. Только чтение.
 *
 * Пейн передаёт компоненту СЕБЯ (`<Component {...pane} />`), поэтому строка лежит в
 * `data`, а не в корне пропсов: читать props как строку — значит получить пустые поля
 * и пустой ключ базы, с которым запросы уходят в `/bases//extensions`.
 */
export const OneCBasesForm: FC<Partial<TPane>> = (paneProps) => {
	const row = (paneProps.data ?? {}) as TDataItem;
	const tabs = useBaseTabs(row);
	// «Закрыть» в командной панели формы НИЧЕГО не делала: обработчик был пустой
	// заглушкой. Кнопка, которая рисуется и не работает, хуже отсутствующей.
	const { requestClose } = useAppContext().windows;
	const close = useCallback(() => {
		if (paneProps.uniqId) void requestClose(paneProps.uniqId);
	}, [requestClose, paneProps.uniqId]);

	// Своя область сообщений: карточка открыта отдельным пейном и может быть единственным,
	// что человек видит, — её сообщения обязаны быть видны в ней самой.
	const scope = paneProps.uniqId ?? "base-card";

	/*
	 * ПЛАТФОРМА. Поле `onecVersion` у базы заполняет агент в срезе баз — и не заполняет:
	 * во всех 111 записях реестра оно пустое. Поэтому спрашиваем агента САМОГО СЕРВЕРА:
	 * платформа у всех баз одного сервера одна, и это тот же факт, только с другой
	 * стороны. Когда не знает никто — так и пишем: «—» читается как «нет версии», а
	 * версия есть всегда, просто её не сообщили.
	 */
	const agents = useAgents();
	const platform = asText(row.onecVersion)
		|| (agents.data?.items ?? []).find((a) => a.role === "admin" && a.platform)?.platform
		|| translate("onecPlatformUnknown");

	return (
		<NoticeScope.Provider value={scope}>
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
									<Group>
										<GroupRow>
											<Field name="ob_key" label={translate("baseKey")} value={asText(row.baseKey)} disabled onChange={() => {}} width={FIELD_WIDTH.wide} />
											<Field name="ob_status" label={translate("status")} value={statusLabel(asText(row.status))} disabled onChange={() => {}} width={FIELD_WIDTH.md} />
										</GroupRow>
										<Field name="ob_name" label={translate("name")} value={asText(row.name) || "—"} disabled onChange={() => {}} />
									</Group>

									<Group>
										<GroupRow>
											<Field name="ob_server" label={translate("onecServer")} value={asText(row.serverName) || "—"} disabled onChange={() => {}} width={FIELD_WIDTH.wide} />
											<Field name="ob_platform" label={translate("onecVersion")} value={platform} disabled onChange={() => {}} width={FIELD_WIDTH.md} />
										</GroupRow>
										<GroupRow>
											<Field name="ob_ext" label={translate("extensionsCount")}
												value={row.extensionsCount == null ? translate("onecExtNotChecked") : asText(row.extensionsCount)}
												disabled onChange={() => {}} width={FIELD_WIDTH.sm} />
											<Field name="ob_seen" label={translate("lastSeenAt")}
												value={row.lastSeenAt ? getFormatDate(asText(row.lastSeenAt)) : "—"} disabled onChange={() => {}} width={FIELD_WIDTH.date} />
										</GroupRow>
									</Group>

									{/* Публикация — со своими командами по ЭТОЙ базе: в списке те же команды
									    групповые, здесь цель уже выбрана и она на экране. */}
									<BasePublication baseKey={asText(row.baseKey)}
										published={row.published as boolean | null}
										publishUrl={row.publishUrl ? asText(row.publishUrl) : null} />
								</GroupCol>

								<GroupCol className={main.FormNotice}>
									{/* Реестр наполняют кластер и агент: править здесь нечего, и это
									    должно быть сказано, а не додумано по серым полям. */}
									<Notice items={[{ type: "info", text: translate("onecBaseCardReadonly") }]} />
								</GroupCol>
							</div>
						</div>
					),
				},
				...tabs,
			]}
		/>
		{/* Полоса сообщений внизу пейна: место занято всегда — форма не дёргается. */}
		<NoticeBoard compact scope={scope} />
		</NoticeScope.Provider>
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
			? ({
				baseKey: found.key, name: found.name, status: found.status, serverName: found.serverName,
				onecVersion: found.onecVersion, extensionsCount: found.extensionsCount,
				published: found.published, publishUrl: found.publishUrl,
				lastSeenAt: found.lastSeenAt, infobaseId: found.infobaseId,
			} as unknown as TDataItem)
			: (typeof base === "string" ? ({ baseKey: key } as unknown as TDataItem) : base);
		addPane({ label: `${translate("onecBase")}: ${key}`, component: OneCBasesForm as never, data: row });
	};
}

/** Вкладки предпросмотра в split-виде — те же, что и в форме. */
const PreviewTabs: FC<{ row: TDataItem }> = ({ row }) => <>{useBaseTabs(row)[0].component}</>;

export const OneCBasesList: FC<{
	variant?: TTableVariant;
	onSelectItem?: (item: TDataItem) => void;
	/** Запущенное задание открывают сразу: групповая операция не должна уходить «в никуда». */
	onBatchStarted?: (batchId: string) => void;
}> = ({ variant, onSelectItem, onBatchStarted }) => {
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
			// «—» читалось бы как «версии нет»; версия есть всегда, её просто не сообщили.
			if (col.identifier === "onecVersion") {
				return <span>{asText(row.onecVersion) || platform || translate("onecPlatformUnknown")}</span>;
			}
			return undefined;
		}}
		previewTabs={(row) => [{ id: "ext", label: translate("onecTabExtensions"), component: <PreviewTabs row={row} /> }]}
		// Групповые команды по отмеченным базам: публикация и её снятие, пользователи,
		// расширения. Здесь набор баз уже выбран — уходить за ним на другую вкладку незачем.
		extraButtons={(selected) => <BaseGroupCommands selected={selected} onBatchStarted={onBatchStarted} />}
	/>
	);
};
OneCBasesList.displayName = "OneCBasesList";

export default OneCBasesList;
