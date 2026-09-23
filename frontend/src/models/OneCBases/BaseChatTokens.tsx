/**
 * Токены базы для чата внутри 1С (СВ4): кем и когда выпущены, отозваны ли, и как их сменить.
 *
 * Самих токенов здесь нет и быть не может: сервис хранит только их хэш. Токен выдаётся базе при одобрении
 * заявки на подключение (раздел «Расширение БухПроф-AI» → «Доступ AI») и уходит в 1С сам. Отозвать — значит
 * закрыть базе чат, пока она не подаст заявку заново. Отзывает только администратор BuhProf.
 *
 * СМЕНИТЬ — НЕ ОТОЗВАТЬ. Смена выпускает новый токен и отдаёт его базе в ответе на очередной ход: расширение
 * сохраняет его само, человек не делает ничего, связь не прерывается. Прежний токен работает, пока идёт
 * перекрытие, — на случай, если ответ с новым не дошёл. Отзыв обрывает связь сразу и требует новой заявки.
 *
 * ТАБЛИЦА — ШТАТНАЯ (23.09). Была сырая `<table>`: свой вид, свои заголовки, кнопки в каждой строке. Теперь
 * общий `Table`, как во всех списках панели: сортировка, поиск, настройка колонок, действия над активной
 * строкой. Строки НЕ переносятся — список читают глазами сверху вниз, и прыгающая высота строк этому мешает.
 *
 * БЕЗ ОБЁРТКИ ВОКРУГ ТАБЛИЦЫ (23.09) — по той же причине, что и в «Вызовах чата»: класс `.Instances` создан
 * для строк-плашек и несёт `container-type: size`, то есть меряет себя, не глядя на содержимое. Таблица
 * внутри получала нулевую область и показывала свой минимум вместо того, чтобы занять вкладку.
 *
 * ОТКАЗОВ ЧАТА ЗДЕСЬ БОЛЬШЕ НЕТ: их показывает вкладка «Вызовы чата» — и по одной базе, и по всем сразу,
 * вместе с успешными вызовами. Две таблицы об одном событии расходились бы в подробностях.
 */
import { FC, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { translate } from "src/i18";
import Table from "src/components/Table";
import { Button } from "src/components/Button";
import Modal from "src/components/Modal";
import { showToast } from "src/components/UIToast";
import { reportError } from "src/services/errors/route";
import { getFormatDate } from "src/utils/datetime";
import { getModelColumns } from "src/components/Table/services";
import type { TColumn } from "src/components/Table/types";
import { buildStaticTableProps } from "src/utils/staticTableProps";
import { useStaticTableView } from "src/hooks/useStaticTableView";
import { withStableIds } from "src/utils/stableRowId";
import { asText } from "src/utils/asText";
import { fetchBaseTokens, revokeBaseToken, rotateBaseToken, type BaseToken } from "src/services/onec/api";
import { QueryError } from "src/models/OneCAdmin/shared";
import admin from "src/models/OneCAdmin/OneCAdmin.module.scss";

/** Колонка «База» — только в сводном режиме: в карточке базы она одна и та же во всех строках. */
const columns = (all: boolean): TColumn[] => ([
	...(all ? [{ identifier: "baseKey", type: "string", width: "200px", minWidth: "120px", alignment: "left", visible: true, inlist: true }] : []),
	{ identifier: "tokenIssued", type: "datetime", width: "170px", minWidth: "120px", alignment: "left", visible: true, inlist: true },
	{ identifier: "tokenIssuedBy", type: "string", width: "280px", minWidth: "150px", alignment: "left", visible: true, inlist: true },
	{ identifier: "tokenState", type: "string", width: "260px", minWidth: "150px", alignment: "left", visible: true, inlist: true },
] as unknown as TColumn[]);

/** Состояние токена одной строкой: действует, сменён (и до какого мига принимается прежний) или отозван. */
const stateOf = (t: BaseToken): { text: string; tone: "ok" | "off" } => {
	if (t.revokedAt) return { text: `${translate("onecTokenRevoked")} ${getFormatDate(t.revokedAt)}`, tone: "off" };
	if (t.replacedBy) {
		return {
			text: `${translate("onecTokenReplaced")}${t.acceptedUntil ? ` ${translate("onecTokenAcceptedUntil")} ${getFormatDate(t.acceptedUntil)}` : ""}`,
			tone: "off",
		};
	}
	return { text: translate("onecTokenActive"), tone: "ok" };
};

/**
 * `baseId` пуст — токены ВСЕХ баз (раздел «Расширение БухПроф-AI» → «Доступ AI»).
 *
 * ЗАЧЕМ РЕЖИМ «ВСЕ». Форма в 1С говорит человеку: «в панели BuhProf AI выдали новый токен взамен
 * отозванного» — а в панели токены лежали только в карточке КОНКРЕТНОЙ базы. Чтобы дойти до них, нужно было
 * заранее знать, какая база, то есть ответ требовался раньше самого вопроса.
 */
export const BaseChatTokens: FC<{ baseId?: string; baseKey?: string; fitHeight?: boolean }> = ({ baseId, baseKey, fitHeight }) => {
	const all = !baseId;
	const qc = useQueryClient();
	const queryKey = ["onec", "base-tokens", baseId ?? "all"];
	const q = useQuery({ queryKey, queryFn: () => fetchBaseTokens(baseId) });
	const items = useMemo(() => q.data?.items ?? [], [q.data]);
	const [cols, setCols] = useState<TColumn[]>(() => getModelColumns(columns(all), all ? "OneCBases_tokens_all" : "OneCBases_tokens"));
	const [activeId, setActiveId] = useState<string | null>(null);
	const [confirm, setConfirm] = useState<BaseToken | null>(null);
	const [rotating, setRotating] = useState<BaseToken | null>(null);

	const revoke = useMutation({
		mutationFn: (t: BaseToken) => revokeBaseToken(t.id),
		onSuccess: () => { setConfirm(null); showToast(translate("onecTokenRevoked"), "success"); void qc.invalidateQueries({ queryKey }); },
		onError: (e) => reportError(e, { source: translate("onecTabBaseToken") }),
	});

	const rotate = useMutation({
		mutationFn: (t: BaseToken) => rotateBaseToken(t.id),
		onSuccess: () => { setRotating(null); showToast(translate("onecTokenRotateDone"), "success"); void qc.invalidateQueries({ queryKey }); },
		onError: (e) => reportError(e, { source: translate("onecTabBaseToken") }),
	});

	const rows = useMemo(() => withStableIds(items.map((t) => ({
		uuid: t.id,
		baseKey: t.baseKey,
		tokenIssued: t.createdAt,
		tokenIssuedBy: t.createdBy || "—",
		tokenState: stateOf(t).text,
		__tone: stateOf(t).tone,
	})), (r) => r.uuid), [items]);
	const view = useStaticTableView(rows, { tokenIssued: "desc" });
	const active = items.find((t) => t.id === activeId) ?? null;
	// Менять и отзывать можно только ДЕЙСТВУЮЩИЙ токен: у отозванного и сменённого менять нечего.
	const live = !!active && !active.revokedAt && !active.replacedBy && !!q.data?.canRevoke;

	return (
		<>
			<div className={admin.Hint}>{translate("onecTokensHint")}</div>
			<QueryError error={q.error} noticeKey={`base-tokens-${baseId ?? "all"}`} source={translate("onecTabBaseToken")} />
			<Table {...buildStaticTableProps({
				componentName: all ? "OneCBases_tokens_all" : "OneCBases_tokens",
				rows: view.rows, columns: cols, setColumns: setCols,
				sorting: view.sorting, search: view.search, fitHeight,
				isLoading: q.isLoading,
				reloading: q.isFetching && !q.isLoading,
				onReload: () => void q.refetch(),
				emptyText: translate("onecTokensNone"),
				onActiveRowChange: (r) => setActiveId(r ? asText(r.uuid) : null),
				renderCell: (r, col) => (col.identifier === "tokenState"
					? <span className={asText(r.__tone) === "ok" ? admin.ReqOk : admin.ReqOff}>{asText(r.tokenState)}</span>
					: undefined),
				extraButtons: !q.data?.canRevoke ? undefined : (
					<>
						<Button disabled={!live || rotate.isPending} onClick={() => active && setRotating(active)}>{translate("onecTokenRotate")}</Button>
						<Button disabled={!live || revoke.isPending} onClick={() => active && setConfirm(active)}>{translate("onecTokenRevoke")}</Button>
					</>
				),
			})} />
			{rotating && (
				<Modal title={translate("onecTokenRotate")} onClose={() => setRotating(null)} onApply={() => rotate.mutate(rotating)}>
					<div className={admin.ModalForm}>
						<div>{baseKey ?? rotating.baseKey} · {getFormatDate(rotating.createdAt)}</div>
						<div>{translate("onecTokenRotateHint")}</div>
					</div>
				</Modal>
			)}
			{confirm && (
				<Modal title={translate("onecTokenRevoke")} onClose={() => setConfirm(null)} onApply={() => revoke.mutate(confirm)}>
					<div className={admin.ModalForm}>
						<div>{baseKey ?? confirm.baseKey} · {getFormatDate(confirm.createdAt)}</div>
						<div className={admin.ConfirmWarning}>{translate("onecTokenRevokeWarning")}</div>
					</div>
				</Modal>
			)}
		</>
	);
};

export default BaseChatTokens;
