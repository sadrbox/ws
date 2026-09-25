/**
 * Решение по записи реестра нарушений (E17 СК5.3): подтвердить, отклонить, оспорить, решить
 * по возражению.
 *
 * КТО ЧТО ВИДИТ. Кнопки — по признакам записи с сервера (`canDecide`, `isMine`): решает главбух
 * сотрудника, руководитель или администратор, о себе не решает никто; оспаривает только сам
 * нарушитель. Сервер проверяет всё ещё раз и отказ (403) объясняет сам — его текст показывает
 * общий перехватчик запросов тостом. Отказ по существу (400/409: «месяц закрыт», «укажите
 * причину») — сообщением формы: его чинят здесь же.
 */
import { type FC, useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { translate } from "src/i18";
import { useAppContext } from "src/app/context";
import { Button } from "src/components/Button";
import { FieldSelect, FieldTextarea } from "src/components/Field";
import { Group, GroupCol } from "src/components/UI";
import { showToast } from "src/components/UIToast";
import type { NoticeItem } from "src/components/Notice";
import { routeError } from "src/services/errors/route";
import { confirmViolation, disputeViolation, rejectViolation, resolveDispute, type ViolationStatus } from "src/services/quality/api";
import {
	availableActions, EMPTY_SELF_DETECTED, validateConfirm, validateDispute, validateReject, validateResolve,
	type SelfDetectedInfo,
} from "./violations";
import main from "src/styles/main.module.scss";
import styles from "./StandardViolations.module.scss";

/** Условия «самовыявлено» из правил применения бонуса. */
const CONDITIONS: { key: keyof SelfDetectedInfo; label: string }[] = [
	{ key: "foundBySelfCheck", label: "violationCondSelfCheck" },
	{ key: "fixedInTime", label: "violationCondFixedInTime" },
	{ key: "reported", label: "violationCondReported" },
	{ key: "noConsequences", label: "violationCondNoConsequences" },
];

interface Props {
	uuid: string;
	status: ViolationStatus;
	selfDetected: boolean;
	canDecide: boolean;
	isMine: boolean;
	/** Форма занята (загрузка) — кнопки недоступны. */
	disabled?: boolean;
	/** Имя формы — подпись записей журнала. */
	source: string;
	/** Действие выполнено: перечитать запись (признаки canDecide/isMine отдаёт только GET). */
	onDone: () => Promise<void> | void;
	/** Сообщения формы: ошибки проверки и отказы сервера по существу. */
	onNotices: (items: NoticeItem[]) => void;
}

export const DecisionBlock: FC<Props> = ({ uuid, status, selfDetected, canDecide, isMine, disabled, source, onDone, onNotices }) => {
	const queryClient = useQueryClient();
	const { confirm } = useAppContext().actions;
	const acts = availableActions({ status, selfDetected, canDecide, isMine });
	const [note, setNote] = useState("");
	const [self, setSelf] = useState(false);
	const [info, setInfo] = useState<SelfDetectedInfo>(EMPTY_SELF_DETECTED);
	const [disputeText, setDisputeText] = useState("");
	const [decision, setDecision] = useState("");
	const [resolveNote, setResolveNote] = useState("");
	const [busy, setBusy] = useState(false);

	const fail = useCallback((key: string) => onNotices([{ type: "error", text: translate(key) }]), [onNotices]);

	/** Выполнить действие: сообщения формы — очистить, по успеху — тост и перечитать запись. */
	const run = useCallback(async (action: () => Promise<unknown>, successKey: string) => {
		setBusy(true);
		onNotices([]);
		try {
			await action();
			showToast(translate(successKey), "success");
			setNote("");
			setSelf(false);
			setInfo(EMPTY_SELF_DETECTED);
			setDisputeText("");
			setDecision("");
			setResolveNote("");
			// Решение меняет и список, и итоги месяца (кандидаты, «бонус есть/нет»).
			void queryClient.invalidateQueries({ queryKey: ["standard-violations"] });
			void queryClient.invalidateQueries({ queryKey: ["quality"] });
			await onDone();
		} catch (e) {
			onNotices(routeError(e, { source, fallback: translate("violationActionFailed") }));
		} finally {
			setBusy(false);
		}
	}, [onNotices, onDone, queryClient, source]);

	const doConfirm = useCallback(async () => {
		const err = validateConfirm(self, info);
		if (err) return fail(err);
		// Подтверждённое нарушение снимает бонус за месяц целиком — спрашиваем. Самовыявленная
		// ошибка бонус не снимает, её подтверждение — просто учёт.
		if (!self && !(await confirm(translate("violationConfirmAsk")))) return;
		await run(
			() => confirmViolation(uuid, { note: note.trim() || undefined, selfDetected: self, ...(self ? { selfDetectedInfo: info } : {}) }),
			self ? "violationSelfDetectedDone" : "violationConfirmedDone",
		);
	}, [self, info, fail, confirm, run, uuid, note]);

	const doReject = useCallback(async () => {
		const err = validateReject(note);
		if (err) return fail(err);
		await run(() => rejectViolation(uuid, note.trim()), "violationRejectedDone");
	}, [note, fail, run, uuid]);

	const doDispute = useCallback(async () => {
		const err = validateDispute(disputeText);
		if (err) return fail(err);
		await run(() => disputeViolation(uuid, disputeText.trim()), "violationDisputedDone");
	}, [disputeText, fail, run, uuid]);

	const doResolve = useCallback(async () => {
		const err = validateResolve(decision, resolveNote);
		if (err) return fail(err);
		await run(() => resolveDispute(uuid, decision as "confirmed" | "rejected", resolveNote.trim()), "violationResolvedDone");
	}, [decision, resolveNote, fail, run, uuid]);

	const off = busy || !!disabled;

	if (!acts.confirm && !acts.reject && !acts.dispute && !acts.resolve) {
		return (
			<div className={main.SettingHint}>
				{translate(status === "rejected" ? "violationNoActionsRejected" : isMine ? "violationNoActionsMine" : "violationNoActions")}
			</div>
		);
	}

	return (
		<GroupCol gap={12}>
			{(acts.confirm || acts.reject) && (
				<GroupCol gap={6}>
					<FieldTextarea
						label={translate(acts.confirm ? "violationDecisionNote" : "violationRejectReason")}
						name={`violation_${uuid}_note`} value={note} onChange={(e) => setNote(e.target.value)}
						rows={3} disabled={off}
						hint={translate(acts.confirm ? "violationDecisionNoteHint" : "violationRejectReasonHint")} />
					{acts.confirm && (
						<>
							<label className={[main.SettingChip, self && main.SettingChipActive].filter(Boolean).join(" ")}>
								<input type="checkbox" checked={self} disabled={off} onChange={(e) => setSelf(e.target.checked)} />
								<span className={main.SettingLabelStrong}>{translate("violationSelfDetected")}</span>
							</label>
							{self && (
								<div className={styles.Conditions}>
									{CONDITIONS.map((c) => (
										<label key={c.key} className={[main.SettingChip, info[c.key] && main.SettingChipActive].filter(Boolean).join(" ")}>
											<input type="checkbox" checked={info[c.key]} disabled={off}
												onChange={(e) => setInfo((prev) => ({ ...prev, [c.key]: e.target.checked }))} />
											<span>{translate(c.label)}</span>
										</label>
									))}
									<span className={main.SettingHint}>{translate("violationSelfDetectedHint")}</span>
								</div>
							)}
						</>
					)}
					<Group>
						{acts.confirm && (
							<Button variant="primary" disabled={off} onClick={() => void doConfirm()}>
								{translate(self ? "violationConfirmSelfDetected" : "violationConfirm")}
							</Button>
						)}
						{acts.reject && (
							<Button disabled={off} onClick={() => void doReject()}>{translate("violationReject")}</Button>
						)}
					</Group>
				</GroupCol>
			)}

			{acts.dispute && (
				<GroupCol gap={6}>
					<FieldTextarea label={translate("violationDisputeText")} name={`violation_${uuid}_dispute`}
						value={disputeText} onChange={(e) => setDisputeText(e.target.value)} rows={3} disabled={off}
						hint={translate("violationDisputeHint")} />
					<Group>
						<Button variant="primary" disabled={off} onClick={() => void doDispute()}>{translate("violationDispute")}</Button>
					</Group>
				</GroupCol>
			)}

			{acts.resolve && (
				<GroupCol gap={6}>
					<FieldSelect label={translate("violationResolveDecision")} name={`violation_${uuid}_decision`}
						value={decision} onChange={(e) => setDecision(e.target.value)} disabled={off}
						options={[
							{ value: "", label: translate("violationResolvePick") },
							{ value: "confirmed", label: translate("violationResolveKeep") },
							{ value: "rejected", label: translate("violationResolveDrop") },
						]} />
					{/* «Решает следующий уровень»: сервер не даёт решать тому, кто подтверждал (кроме
					    администратора); уровня выше нет — решает администратор фирмы (решено 25.09). */}
					<FieldTextarea label={translate("violationResolveNote")} name={`violation_${uuid}_resolveNote`}
						value={resolveNote} onChange={(e) => setResolveNote(e.target.value)} rows={3} disabled={off}
						hint={translate("violationResolveHint")} />
					<span className={main.SettingHint}>{translate("violationResolveAdminNote")}</span>
					<Group>
						<Button variant="primary" disabled={off} onClick={() => void doResolve()}>{translate("violationResolve")}</Button>
					</Group>
				</GroupCol>
			)}
		</GroupCol>
	);
};

export default DecisionBlock;
