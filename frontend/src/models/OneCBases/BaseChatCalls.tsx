/**
 * «Вызовы чата» (ПН8): что помощник вызывал из чата в 1С, по какой базе и чем кончилось.
 *
 * ЗАЧЕМ ОТДЕЛЬНО ОТ ЖУРНАЛА АГЕНТА. След одного разговора лежал в двух местах: вызовы в 1С — в журнале
 * службы, задачи и заметки — в журнале сервиса, и разбор жалобы «попросил список реализаций, ничего не
 * пришло» начинался с поиска, где именно смотреть. Здесь весь след канала одной таблицей.
 *
 * ЧЕТЫРЕ ИСХОДА, И КАЖДЫЙ ЛЕЧИТСЯ ПО-СВОЕМУ: «ушло» — 1С ответа не прислала (форму могли закрыть);
 * «выполнено»; «отказ» — ответили отказом, код рядом; «не выпущен» — сервис не отправил вызов, потому что
 * модель сослалась на объект, которого в разговоре не было. Слить их в «ошибку» значило бы потерять ответ.
 *
 * ТАБЛИЦА — ШТАТНАЯ (А4 аудита 23.09). Была сырая `<table>`: в самом длинном списке раздела нельзя было ни
 * отсортировать по времени, ни спрятать колонку, ни найти строку поиском, хотя соседние вкладки это умеют.
 * Строки не переносятся: журнал читают сверху вниз, и прыгающая высота строк этому мешает.
 *
 * БЕЗ ОБЁРТКИ ВОКРУГ ТАБЛИЦЫ (23.09). Список лежал в `.Instances` — классе для строк-плашек экземпляров
 * агента, у которого стоит `container-type: size`: такой блок считает свой размер, НЕ ГЛЯДЯ на содержимое,
 * и в колонке вкладки получал нулевую высоту. Таблица держалась только собственным `min-height` — ровно
 * 296 пикселей посреди пустой области, сколько бы места ей ни отвели. Как во всех списках панели, таблица
 * теперь прямой ребёнок вкладки и делит её высоту сама.
 */
import { FC, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { translate } from "src/i18";
import Table from "src/components/Table";
import { getModelColumns } from "src/components/Table/services";
import type { TColumn } from "src/components/Table/types";
import { buildStaticTableProps } from "src/utils/staticTableProps";
import { useStaticTableView } from "src/hooks/useStaticTableView";
import { withStableIds } from "src/utils/stableRowId";
import { asText } from "src/utils/asText";
import { fetchChatCalls, type ChatCall } from "src/services/onec/api";
import { QueryError } from "src/models/OneCAdmin/shared";
import admin from "src/models/OneCAdmin/OneCAdmin.module.scss";

/** Колонка «База» — только в сводном режиме: в карточке базы она одна и та же во всех строках. */
const columns = (all: boolean): TColumn[] => ([
	{ identifier: "callAt", type: "datetime", width: "170px", minWidth: "120px", alignment: "left", visible: true, inlist: true },
	...(all ? [{ identifier: "baseKey", type: "string", width: "180px", minWidth: "110px", alignment: "left", visible: true, inlist: true }] : []),
	{ identifier: "callTool", type: "string", width: "200px", minWidth: "130px", alignment: "left", visible: true, inlist: true },
	{ identifier: "callTarget", type: "string", width: "110px", minWidth: "80px", alignment: "left", visible: true, inlist: true },
	{ identifier: "organization", type: "string", width: "220px", minWidth: "130px", alignment: "left", visible: true, inlist: true },
	{ identifier: "callState", type: "string", width: "320px", minWidth: "160px", alignment: "left", visible: true, inlist: true },
] as unknown as TColumn[]);

/** Подпись исхода и тон: «ушло» — не отказ, и красным его красить нельзя. */
const stateLabel = (s: ChatCall["state"]): { text: string; tone: "ok" | "bad" | "muted" } => {
	if (s === "ok") return { text: translate("onecChatCallOk"), tone: "ok" };
	if (s === "failed") return { text: translate("onecChatCallFailed"), tone: "bad" };
	if (s === "rejected") return { text: translate("onecChatCallRejected"), tone: "bad" };
	return { text: translate("onecChatCallSent"), tone: "muted" };
};

/**
 * `baseId` пуст — журнал ПО ВСЕМ базам (раздел «Расширение БухПроф-AI»); тогда в таблице появляется колонка
 * «База»: без неё строки разных клиентов неразличимы. `baseNames` — подписи баз по идентификатору, их знает
 * только реестр баз, а журнал хранит один идентификатор.
 */
export const BaseChatCalls: FC<{ baseId?: string; baseNames?: ReadonlyMap<string, string> }> = ({ baseId, baseNames }) => {
	const all = !baseId;
	const q = useQuery({
		queryKey: ["onec", "chat-calls", baseId ?? "all"],
		queryFn: () => fetchChatCalls(baseId),
	});
	const items = useMemo(() => q.data?.items ?? [], [q.data]);
	const [cols, setCols] = useState<TColumn[]>(() => getModelColumns(columns(all), all ? "OneCBases_chat_calls_all" : "OneCBases_chat_calls"));

	const rows = useMemo(() => withStableIds(items.map((c, i) => {
		const s = stateLabel(c.state);
		return {
			uuid: `${c.at}-${c.callId ?? i}`,
			callAt: c.at,
			// Подпись базы знает реестр; журнал хранит идентификатор, и короткий кусок его лучше пустоты.
			baseKey: (c.baseId && baseNames?.get(c.baseId)) || c.baseId?.slice(0, 8) || "—",
			// Имя команды 1С рядом с именем инструмента: по нему ищут в журнале агента.
			callTool: c.tool || c.commandType || "—",
			__commandType: c.commandType,
			callTarget: c.target === "erp" ? translate("onecChatCallTargetErp") : translate("onecChatCallTarget1c"),
			organization: c.organizationName || "—",
			callState: [s.text, c.code, c.message].filter(Boolean).join(" · "),
			__tone: s.tone,
		};
	}), (r) => r.uuid), [items, baseNames]);
	const view = useStaticTableView(rows, { callAt: "desc" });

	return (
		<>
			<div className={admin.Hint}>{translate("onecChatCallsHint")}</div>
			<QueryError error={q.error} noticeKey={`chat-calls-${baseId ?? "all"}`} source={translate("onecTabChatCalls")} />
			<Table {...buildStaticTableProps({
				componentName: all ? "OneCBases_chat_calls_all" : "OneCBases_chat_calls",
				rows: view.rows, columns: cols, setColumns: setCols,
				sorting: view.sorting, search: view.search,
				isLoading: q.isLoading,
				reloading: q.isFetching && !q.isLoading,
				onReload: () => void q.refetch(),
				emptyText: translate("onecChatCallsNone"),
				renderCell: (r, col) => {
					if (col.identifier === "callState") {
						const tone = asText(r.__tone);
						return (
							<span className={tone === "bad" ? admin.ReqOff : tone === "ok" ? admin.ReqOk : undefined}>
								{asText(r.callState)}
							</span>
						);
					}
					if (col.identifier === "callTool") {
						return <span title={asText(r.__commandType) || undefined}>{asText(r.callTool)}</span>;
					}
					return undefined;
				},
			})} />
		</>
	);
};

export default BaseChatCalls;
