/**
 * «Вызовы чата» в карточке базы (ПН8): что помощник вызывал из чата в 1С, по какой базе и чем кончилось.
 *
 * ЗАЧЕМ ОТДЕЛЬНО ОТ ЖУРНАЛА АГЕНТА. След одного разговора лежал в двух местах: вызовы в 1С — в журнале
 * службы, задачи и заметки — в журнале сервиса, и разбор жалобы «попросил список реализаций, ничего не
 * пришло» начинался с поиска, где именно смотреть. Здесь весь след канала одной таблицей.
 *
 * ЧЕТЫРЕ ИСХОДА, И КАЖДЫЙ ЛЕЧИТСЯ ПО-СВОЕМУ: «ушло» — 1С ответа не прислала (форму могли закрыть);
 * «выполнено»; «отказ» — ответили отказом, код рядом; «не выпущен» — сервис не отправил вызов, потому что
 * модель сослалась на объект, которого в разговоре не было. Слить их в «ошибку» значило бы потерять ответ.
 */
import { FC } from "react";
import { useQuery } from "@tanstack/react-query";
import { translate } from "src/i18";
import { getFormatDate } from "src/utils/datetime";
import { fetchChatCalls, type ChatCall } from "src/services/onec/api";
import { QueryError } from "src/models/OneCAdmin/shared";
import admin from "src/models/OneCAdmin/OneCAdmin.module.scss";

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
	const items = q.data?.items ?? [];

	return (
		<div className={admin.Instances}>
			<div className={admin.Hint}>{translate("onecChatCallsHint")}</div>
			<QueryError error={q.error} noticeKey={`chat-calls-${baseId ?? "all"}`} source={translate("onecTabChatCalls")} />
			{q.data && !items.length && <div className={admin.Hint}>{translate("onecChatCallsNone")}</div>}
			{items.length > 0 && (
				<table className={`${admin.StatsTable} ${admin.ReqTable}`}>
					<thead>
						<tr>
							<th>{translate("date")}</th>
							{all && <th>{translate("onecBase")}</th>}
							<th>{translate("onecChatFailureTool")}</th>
							<th>{translate("onecChatCallTarget")}</th>
							<th>{translate("organization")}</th>
							<th>{translate("status")}</th>
						</tr>
					</thead>
					<tbody>
						{items.map((c, i) => {
							const s = stateLabel(c.state);
							return (
								<tr key={`${c.at}-${c.callId ?? i}`}>
									<td>{getFormatDate(c.at)}</td>
									{all && <td>{(c.baseId && baseNames?.get(c.baseId)) || c.baseId?.slice(0, 8) || "—"}</td>}
									{/* Имя команды 1С рядом с именем инструмента: по нему ищут в журнале агента. */}
									<td title={c.commandType || undefined}>{c.tool || c.commandType || "—"}</td>
									<td>{c.target === "erp" ? translate("onecChatCallTargetErp") : translate("onecChatCallTarget1c")}</td>
									<td>{c.organizationName || "—"}</td>
									<td className={s.tone === "bad" ? admin.ReqOff : s.tone === "ok" ? admin.ReqOk : undefined}>
										{s.text}
										{c.code ? ` · ${c.code}` : ""}
										{c.message ? ` · ${c.message}` : ""}
									</td>
								</tr>
							);
						})}
					</tbody>
				</table>
			)}
		</div>
	);
};

export default BaseChatCalls;
