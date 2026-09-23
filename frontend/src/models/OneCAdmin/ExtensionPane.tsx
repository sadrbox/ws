/**
 * «Администрирование» → «Расширение БухПроф-AI» (22.09).
 *
 * ТРЕТЬЯ СУЩНОСТЬ РЯДОМ С КЛАСТЕРАМИ И АГЕНТАМИ. Кластер — сервер 1С с базами и сеансами; агент — служба на
 * компьютере, которая к ним ходит; расширение — то, что стоит ВНУТРИ базы и разговаривает с сервисом. Сведения о
 * нём лежали в трёх местах сразу: заявка базы — среди заявок агентов (хотя приходит не от агента, а из формы 1С),
 * версия — колонкой в списке баз, токен чата и вызовы — во вкладках карточки каждой базы. Вопросы «каким базам
 * открыт чат» и «где сборка старая» решались обходом карточек.
 *
 * СРЕЗ ПО ВСЕМ БАЗАМ, А НЕ ЗАМЕНА КАРТОЧКИ. Здесь смотрят на парк целиком: сколько баз подключено, где какая
 * версия, кому и когда выдан токен, что вызывали из чата. Одну базу по-прежнему смотрят в её карточке — там же
 * её проверяют кнопкой «Проверка BuhProf».
 *
 * ЧЕГО ЗДЕСЬ НЕТ. Заявки на подключение АГЕНТОВ и активация БИНов остались в разделе «Агенты 1С»: первые — про
 * службу на компьютере, вторые приходят из окна агента и упираются в его тариф. Соседство «всё, что называется
 * заявкой, лежит вместе» удобно только тому, кто уже знает, чем они отличаются.
 */
import { FC, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { translate } from "src/i18";
import Tabs from "src/components/Tabs";
import Table from "src/components/Table";
import { getModelColumns } from "src/components/Table/services";
import type { TColumn } from "src/components/Table/types";
import { buildStaticTableProps } from "src/utils/staticTableProps";
import { useStaticTableView } from "src/hooks/useStaticTableView";
import { withStableIds } from "src/utils/stableRowId";
import { asText } from "src/utils/asText";
import { getFormatDate } from "src/utils/datetime";
import { fetchExtensionBases, fetchBases, fetchRegistrations } from "src/services/onec/api";
import RegistrationsTab from "./RegistrationsTab";
import BaseChatCalls from "src/models/OneCBases/BaseChatCalls";
import BaseChatTokens from "src/models/OneCBases/BaseChatTokens";
import { ReadonlyNotice, QueryError, useOnecPermissions } from "./shared";
import { agentsAllow } from "./onecPermissions";
import { extensionRows, extensionSummary } from "./extensionView";
import main from "src/styles/main.module.scss";
import styles from "./OneCAdmin.module.scss";

type ExtensionTab = "access" | "bases" | "calls";

const columns = (): TColumn[] => ([
	{ identifier: "baseKey", type: "string", width: "200px", minWidth: "120px", alignment: "left", visible: true, inlist: true },
	{ identifier: "organizationName", type: "string", width: "220px", minWidth: "140px", alignment: "left", visible: true, inlist: true },
	{ identifier: "extVersion", type: "string", width: "150px", minWidth: "100px", alignment: "left", visible: true, inlist: true },
	{ identifier: "accessLabel", type: "string", width: "170px", minWidth: "120px", alignment: "left", visible: true, inlist: true },
	{ identifier: "transportLabel", type: "string", width: "130px", minWidth: "90px", alignment: "left", visible: true, inlist: true },
	{ identifier: "agentName", type: "string", width: "180px", minWidth: "120px", alignment: "left", visible: true, inlist: true },
	{ identifier: "approvedAt", type: "datetime", width: "170px", minWidth: "120px", alignment: "left", visible: true, inlist: true },
	/*
	 * «Последний обмен» — ОДНО число на две дороги (С2 аудита 23.09): срез агента и запрос из самой базы.
	 * Базу без агента раньше нечем было показать, хотя чатом она работает каждый день. Срез агента остался
	 * отдельной колонкой, скрытой: она отвечает на другой вопрос — что видит агент.
	 */
	{ identifier: "lastExchangeAt", type: "datetime", width: "170px", minWidth: "120px", alignment: "left", visible: true, inlist: true },
	{ identifier: "seenAt", type: "datetime", width: "170px", minWidth: "120px", alignment: "left", visible: false, inlist: true },
] as unknown as TColumn[]);

/**
 * «Доступ AI» — заявка и токен ОДНОЙ историей (22.09, по разбору с владельцем).
 *
 * ПОЧЕМУ ВМЕСТЕ. Это не два предмета, а два состояния одного: заявку подают, чтобы база получила токен; токен
 * выдаётся по заявке ровно один раз (`tokenDeliveredAt`); отозвали токен — нужна новая заявка, потому что
 * выпустить его в панели нечем. Разнесённые по вкладкам, они заставляли связывать глазами «одобрено 20.09» из
 * одной таблицы и «отозван» из другой.
 *
 * ЧТО ИМЕННО ДАЁТ ЭТОТ ДОСТУП — чат внутри 1С и задачи с заметками, то есть канал «1С → сервис». Команды
 * помощника (документы, отчёты, долги) идут другим каналом, через агента, и токена базы не используют: отзыв
 * их не выключает. Название вкладки говорит про доступ, а не про расширение целиком, чтобы не обещать лишнего.
 *
 * ДВЕ ТАБЛИЦЫ ДЕЛЯТ ВЫСОТУ ПОПОЛАМ, А НЕ СКЛАДЫВАЮТСЯ. Каждая таблица панели требует места под строки
 * (`min-height`), и две подряд перерастали вкладку: область тянулась вниз, а общий скролл уносил вместе с
 * собой заголовок второй таблицы. Здесь высоту назначает вкладка (`fitHeight`), а строки прокручиваются
 * внутри каждой таблицы — обе видны сразу, как их и читают: заявка сверху, выданный по ней токен снизу.
 */
const AccessTab: FC = () => (
	<div className={styles.SplitTabs}>
		<section className={styles.SplitHalf}>
			<div className={styles.SectionTitle}>{translate("onecReqRegistrations")}</div>
			<RegistrationsTab fitHeight />
		</section>
		<section className={styles.SplitHalf}>
			<div className={styles.SectionTitle}>{translate("onecExtTokens")}</div>
			<BaseChatTokens fitHeight />
		</section>
	</div>
);

/**
 * «Базы с расширением» — парк одним списком: где стоит расширение, какой версии, открыт ли доступ AI, чем
 * база отвечает агенту (HTTP или COM) и когда её подключили.
 *
 * ДАННЫЕ — ТОЛЬКО ИЗ ИСТОЧНИКОВ РАСШИРЕНИЯ (заявки, токены, срез бизнес-агентов и запросы самой базы по
 * каналу чата — С2 аудита 23.09: база без агента иначе оставалась без версии и без «последнего обмена»),
 * сводку собирает сервис
 * (`GET /v1/onec/extension-bases`). Реестр кластера здесь не при чём: его ведёт админ-агент, панель сужает
 * его до выбранного кластера, и у клиента без админ-агента экран был пуст, хотя базы подключены (23.09).
 */
const BasesTab: FC = () => {
	const [cols, setCols] = useState<TColumn[]>(() => getModelColumns(columns(), "OneCAdmin_extension_bases"));
	/*
	 * «Обновить» спрашивает срезы агентов заново (fresh), обычное открытие довольствуется кэшем сервиса:
	 * иначе нажатие сразу после обновления расширения у клиента возвращало прежнюю версию (А2 аудита 23.09).
	 */
	const [fresh, setFresh] = useState(false);
	const list = useQuery({
		queryKey: ["onec", "extension-bases", fresh ? "fresh" : "cached"],
		queryFn: () => fetchExtensionBases(fresh),
		staleTime: 60_000,
	});

	const rows = useMemo(
		() => withStableIds(extensionRows(list.data?.items ?? []), (r) => r.uuid),
		[list.data],
	);
	const summary = useMemo(() => extensionSummary(rows), [rows]);
	const view = useStaticTableView(rows, { baseKey: "asc" });

	return (
		<>
			<div className={styles.Hint}>{translate("onecExtBasesHint")}</div>
			{/* Сводка одной строкой: сколько баз, у скольких открыт доступ, кто ждёт решения и кого обновлять. */}
			{rows.length > 0 && (
				<div className={styles.Hint}>
					{translate("onecExtBasesCount")}: {summary.bases}
					{" · "}{translate("onecExtWithChat")}: {summary.withAccess}
					{summary.pending ? ` · ${translate("onecReqPending")}: ${summary.pending}` : ""}
					{summary.newestVersion ? ` · ${translate("onecExtTopVersion")}: ${summary.newestVersion}` : ""}
					{summary.outdated.length ? ` · ${translate("onecExtOutdated")}: ${summary.outdated.join(", ")}` : ""}
					{summary.unknownVersion ? ` · ${translate("onecExtVersionUnknown")}: ${summary.unknownVersion}` : ""}
				</div>
			)}
			<QueryError error={list.error} noticeKey="onec-ext-bases" source={translate("OneCExtension")} />
			<Table {...buildStaticTableProps({
				componentName: "OneCAdmin_extension_bases", rows: view.rows, columns: cols, setColumns: setCols,
				sorting: view.sorting, search: view.search,
				isLoading: list.isLoading,
				reloading: list.isFetching && !list.isLoading,
				onReload: () => { setFresh(true); void list.refetch(); },
				emptyText: translate("onecExtBasesNone"),
				renderCell: (r, col) => {
					if (col.identifier === "extVersion") {
						const v = asText(r.extVersion);
						if (!v) return <span className={main.Muted}>{translate("onecExtVersionUnknown")}</span>;
						// Версия со слов заявки: база могла обновиться, а агент об этом ещё не сообщал.
						if (r.versionStale) return <span title={translate("onecExtVersionStale")}>{v} *</span>;
						// Версию назвала сама база в запросе чата — живая, звёздочка не нужна; откуда она, говорит подсказка.
						return <span title={r.versionFromChat ? translate("onecExtVersionFromChat") : undefined}>{v}</span>;
					}
					/*
					 * ПУСТО ЗНАЧИТ «НИКТО НЕ СКАЗАЛ», а не «связи нет»: база без агента и без единого запроса из 1С
					 * ничем себя не проявляла, и выдумывать за неё время нельзя. Откуда взято время — подсказкой:
					 * срез агента и запрос из самой базы говорят о разном, и при разборе это первое, что спросят.
					 */
					if (col.identifier === "lastExchangeAt") {
						const at = asText(r.lastExchangeAt);
						if (!at) return <span className={main.Muted}>—</span>;
						return (
							<span title={translate(r.lastExchangeSource === "chat" ? "onecExtExchangeFromChat" : "onecExtExchangeFromAgent")}>
								{getFormatDate(at)}
							</span>
						);
					}
					if (col.identifier === "accessLabel") {
						const tone = asText(r.access);
						return (
							<span className={tone === "active" ? styles.ReqOk : tone === "revoked" ? styles.ReqOff : undefined}>
								{asText(r.accessLabel)}
							</span>
						);
					}
					return undefined;
				},
			})} />
		</>
	);
};

export const OneCExtensionList: FC = () => {
	const perms = useOnecPermissions();
	const [tab, setTab] = useState<ExtensionTab>("access");
	// Журналу вызовов нужны подписи баз: он хранит идентификатор, а имя знает только реестр.
	const bases = useQuery({ queryKey: ["onec", "bases"], queryFn: fetchBases, staleTime: 60_000, enabled: tab === "calls" });
	const baseNames = useMemo(
		() => new Map((bases.data?.items ?? []).map((b) => [b.id, b.key])),
		[bases.data],
	);
	/** Заявок, ждущих решения, — числом у вкладки: их ждут у телефона, открывать наугад не придётся. */
	const pending = useQuery({
		queryKey: ["onec", "registrations", "PENDING", ""],
		queryFn: () => fetchRegistrations({ state: "PENDING" }),
		refetchInterval: 60_000, retry: false,
	});
	const waiting = pending.data?.items.length ?? 0;

	// Право то же, что у соседних разделов 1С; без просмотра агентов не показываем ничего, кроме объяснения.
	if (!agentsAllow(perms, "view")) {
		return (
			<div className={main.PaneFill}>
				<ReadonlyNotice />
			</div>
		);
	}

	/*
	 * РАЗДЕЛ ЦЕЛИКОМ ЗАКРЫТ — ГОВОРИМ ОБ ЭТОМ ОДИН РАЗ (Б3 аудита 23.09).
	 *
	 * Пункт меню показывается по праву «Администрирование 1С», а сводные списки сервиса при
	 * `ONEC_SERVER_SCOPE=organizations` открыты только администратору BuhProf. Панель заранее знать этого не
	 * может: настройка живёт на сервере. Поэтому узнаём по первому же ответу — счётчик заявок всё равно
	 * спрашивается при открытии — и показываем одно понятное объяснение вместо трёх вкладок с ошибками.
	 */
	if ((pending.error as { code?: string } | null)?.code === "FORBIDDEN") {
		return (
			<div className={main.PaneFill}>
				<div className={styles.Hint}>{translate("onecExtForbidden")}</div>
			</div>
		);
	}

	return (
		<div className={main.PaneFill}>
			<ReadonlyNotice />
			<Tabs
				activeTab={tab}
				onTabChange={(id) => setTab(id as ExtensionTab)}
				tabs={[
					{
						// Заявка приходит из формы 1С «БухПроф AI → Подключение к BuhProf AI» — от расширения, не от агента.
						id: "access",
						label: waiting ? `${translate("onecExtAccess")} (${waiting})` : translate("onecExtAccess"),
						component: tab === "access" ? <AccessTab /> : null,
					},
					{ id: "bases", label: translate("onecExtBases"), component: tab === "bases" ? <BasesTab /> : null },
					{
						// Журнал вызовов по ВСЕМ базам: та же таблица, что в карточке базы, но без отбора по одной.
						id: "calls", label: translate("onecTabChatCalls"),
						component: tab === "calls" ? <BaseChatCalls baseNames={baseNames} /> : null,
					},
				]}
			/>
		</div>
	);
};

export default OneCExtensionList;
