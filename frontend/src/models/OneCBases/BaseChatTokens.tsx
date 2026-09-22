/**
 * «Чат в 1С» в карточке базы (СВ4): токены базы для чата внутри 1С — кем и когда выпущены, отозваны ли.
 *
 * Самих токенов здесь нет и быть не может: сервис хранит только их хэш. Токен выдаётся базе при одобрении заявки
 * на подключение (панель → «Заявки») и уходит в 1С сам. Отозвать — значит закрыть базе чат, пока она не подаст
 * заявку заново. Отзывает только администратор BuhProf.
 *
 * СМЕНИТЬ — НЕ ОТОЗВАТЬ. Смена выпускает новый токен и отдаёт его базе в ответе на очередной ход: расширение
 * сохраняет его само, человек не делает ничего, связь не прерывается. Прежний токен работает, пока идёт
 * перекрытие, — на случай, если ответ с новым не дошёл. Отзыв обрывает связь сразу и требует новой заявки.
 */
import { FC, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { translate } from "src/i18";
import { Button } from "src/components/Button";
import Modal from "src/components/Modal";
import { showToast } from "src/components/UIToast";
import { reportError } from "src/services/errors/route";
import { getFormatDate } from "src/utils/datetime";
import { fetchBaseTokens, revokeBaseToken, rotateBaseToken, type BaseToken } from "src/services/onec/api";
import { QueryError } from "src/models/OneCAdmin/shared";
import admin from "src/models/OneCAdmin/OneCAdmin.module.scss";

export const BaseChatTokens: FC<{ baseId: string; baseKey: string }> = ({ baseId, baseKey }) => {
	const qc = useQueryClient();
	const queryKey = ["onec", "base-tokens", baseId];
	const q = useQuery({ queryKey, queryFn: () => fetchBaseTokens(baseId), enabled: !!baseId });
	const items = q.data?.items ?? [];
	const [confirm, setConfirm] = useState<BaseToken | null>(null);
	const [rotating, setRotating] = useState<BaseToken | null>(null);

	const revoke = useMutation({
		mutationFn: (t: BaseToken) => revokeBaseToken(t.id),
		onSuccess: () => { setConfirm(null); showToast(translate("onecTokenRevoked"), "success"); void qc.invalidateQueries({ queryKey }); },
		onError: (e) => reportError(e, { source: translate("onecTabChat") }),
	});

	const rotate = useMutation({
		mutationFn: (t: BaseToken) => rotateBaseToken(t.id),
		onSuccess: () => { setRotating(null); showToast(translate("onecTokenRotateDone"), "success"); void qc.invalidateQueries({ queryKey }); },
		onError: (e) => reportError(e, { source: translate("onecTabChat") }),
	});

	return (
		<div className={admin.Instances}>
			<div className={admin.Hint}>{translate("onecTokensHint")}</div>
			<QueryError error={q.error} noticeKey={`base-tokens-${baseId}`} source={translate("onecTabChat")} />
			{q.data && !items.length && <div className={admin.Hint}>{translate("onecTokensNone")}</div>}
			{items.length > 0 && (
				<table className={`${admin.StatsTable} ${admin.ReqTable}`}>
					<thead>
						<tr>
							<th>{translate("onecTokenIssued")}</th>
							<th>{translate("onecTokenIssuedBy")}</th>
							<th>{translate("status")}</th>
							<th />
						</tr>
					</thead>
					<tbody>
						{items.map((t) => (
							<tr key={t.id}>
								<td>{getFormatDate(t.createdAt)}</td>
								<td>{t.createdBy || "—"}</td>
								<td>
									{t.revokedAt
										? <span className={admin.ReqOff}>{translate("onecTokenRevoked")} {getFormatDate(t.revokedAt)}</span>
										: t.replacedBy
											// Токен сменён: он ещё принимается, пока идёт перекрытие, — база
											// сохранит новый сама, в ответе на очередной ход.
											? <span className={admin.ReqOff}>{translate("onecTokenReplaced")}{t.acceptedUntil ? ` ${translate("onecTokenAcceptedUntil")} ${getFormatDate(t.acceptedUntil)}` : ""}</span>
											: <span className={admin.ReqOk}>{translate("onecTokenActive")}</span>}
								</td>
								<td>
									{!t.revokedAt && !t.replacedBy && q.data?.canRevoke && (
										<>
											<Button onClick={() => setRotating(t)} disabled={rotate.isPending}>{translate("onecTokenRotate")}</Button>
											<Button onClick={() => setConfirm(t)} disabled={revoke.isPending}>{translate("onecTokenRevoke")}</Button>
										</>
									)}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			)}
			{rotating && (
				<Modal title={translate("onecTokenRotate")} onClose={() => setRotating(null)} onApply={() => rotate.mutate(rotating)}>
					<div className={admin.ModalForm}>
						<div>{baseKey} · {getFormatDate(rotating.createdAt)}</div>
						<div>{translate("onecTokenRotateHint")}</div>
					</div>
				</Modal>
			)}
			{confirm && (
				<Modal title={translate("onecTokenRevoke")} onClose={() => setConfirm(null)} onApply={() => revoke.mutate(confirm)}>
					<div className={admin.ModalForm}>
						<div>{baseKey} · {getFormatDate(confirm.createdAt)}</div>
						<div className={admin.ConfirmWarning}>{translate("onecTokenRevokeWarning")}</div>
					</div>
				</Modal>
			)}
		</div>
	);
};

export default BaseChatTokens;
