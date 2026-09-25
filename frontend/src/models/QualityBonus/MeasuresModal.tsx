/**
 * Меры руководителя по сотруднику (E17 СК5.4, п. 30 стандарта): беседа, обучение,
 * предупреждение, иное.
 *
 * Зачем. «Нарушения повторяются, а меры нет» — отдельное нарушение руководителя, и решение о
 * соответствии должности тоже опирается на принятые меры. Мера после первого нарушения окна
 * систематичности снимает сигнал «мер нет».
 *
 * Назначает главбух, руководитель или администратор; удалить может автор меры или
 * администратор. Отказ сервера (403) показывает общий перехватчик запросов тостом.
 */
import { type FC, useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { translate } from "src/i18";
import { useAppContext } from "src/app/context";
import Modal from "src/components/Modal";
import Notice, { type NoticeItem } from "src/components/Notice";
import { Button } from "src/components/Button";
import IconButton from "src/components/IconButton/IconButton";
import { FieldDate, FieldSelect, FieldTextarea } from "src/components/Field";
import { FIELD_WIDTH } from "src/components/Field/fieldWidths";
import { Group, GroupCol } from "src/components/UI";
import { showToast } from "src/components/UIToast";
import { routeError } from "src/services/errors/route";
import { getAppUtcOffset, getFormatDateOnly } from "src/utils/datetime";
import { createMeasure, deleteMeasure, fetchMeasures, type Measure } from "src/services/quality/api";
import { localYmd } from "src/models/_quality/month";
import { measureKindLabel, measureKindOptions, validateMeasure } from "./bonus";
import main from "src/styles/main.module.scss";
import styles from "./QualityBonus.module.scss";

interface Props {
	userUuid: string;
	userName: string;
	/** Может назначать меры (главбух, руководитель, администратор). */
	canAdd: boolean;
	isAdmin: boolean;
	onClose: () => void;
}

export const MeasuresModal: FC<Props> = ({ userUuid, userName, canAdd, isAdmin, onClose }) => {
	const queryClient = useQueryClient();
	const { auth, actions } = useAppContext();
	const [kind, setKind] = useState("talk");
	const [note, setNote] = useState("");
	const [date, setDate] = useState(() => localYmd(getAppUtcOffset() * 60));
	const [busy, setBusy] = useState(false);
	const [notices, setNotices] = useState<NoticeItem[]>([]);

	const q = useQuery({
		queryKey: ["violation-measures", userUuid],
		queryFn: async () => (await fetchMeasures(userUuid)).items ?? [],
	});

	const refresh = useCallback(async () => {
		await queryClient.invalidateQueries({ queryKey: ["violation-measures", userUuid] });
		// Мера снимает сигнал «мер нет» в итогах месяца.
		await queryClient.invalidateQueries({ queryKey: ["quality", "bonus"] });
	}, [queryClient, userUuid]);

	const add = useCallback(async () => {
		const err = validateMeasure(note);
		if (err) return setNotices([{ type: "error", text: translate(err) }]);
		setBusy(true);
		setNotices([]);
		try {
			await createMeasure({ userUuid, kind, note: note.trim(), ...(date ? { date } : {}) });
			showToast(translate("measureAdded"), "success");
			setNote("");
			await refresh();
		} catch (e) {
			setNotices(routeError(e, { source: translate("bonusMeasuresTitle"), fallback: translate("measureAddFailed") }));
		} finally {
			setBusy(false);
		}
	}, [note, userUuid, kind, date, refresh]);

	const remove = useCallback(async (m: Measure) => {
		if (!(await actions.confirm(translate("measureDeleteAsk")))) return;
		try {
			await deleteMeasure(m.uuid);
			await refresh();
		} catch (e) {
			setNotices(routeError(e, { source: translate("bonusMeasuresTitle") }));
		}
	}, [actions, refresh]);

	const myUuid = auth.user?.uuid ?? "";
	const items = q.data ?? [];

	return (
		<Modal title={`${translate("bonusMeasuresTitle")}: ${userName}`} onClose={onClose} className={styles.MeasuresModal}
			buttons={[{ label: translate("close"), onClick: onClose, variant: "secondary" }]}>
			<GroupCol gap={12}>
				{q.isLoading ? (
					<div className={main.SettingHint}>{translate("loading")}</div>
				) : items.length ? (
					<ul className={styles.Measures}>
						{items.map((m) => {
							// Автор меры приходит в записи (createdByUuid), но в типе клиента его нет.
							const author = (m as Measure & { createdByUuid?: string | null }).createdByUuid;
							return (
								<li key={m.uuid} className={styles.Measure}>
									<span className={styles.MeasureDate}>{getFormatDateOnly(m.date)}</span>
									<span className={styles.MeasureKind}>{measureKindLabel(m.kind)}</span>
									<span className={styles.MeasureNote}>
										{m.note}
										{m.createdByName && <span className={styles.MeasureAuthor}> — {m.createdByName}</span>}
									</span>
									{(isAdmin || (!!author && author === myUuid)) && (
										<IconButton icon="close" size="sm" title={translate("delete")} aria-label={translate("delete")}
											onClick={() => void remove(m)} />
									)}
								</li>
							);
						})}
					</ul>
				) : (
					<div className={main.SettingHint}>{translate("measuresNone")}</div>
				)}

				{canAdd && (
					<GroupCol gap={6}>
						<Group>
							<FieldSelect label={translate("measureKind")} name={`measure_${userUuid}_kind`} value={kind}
								options={measureKindOptions()} onChange={(e) => setKind(e.target.value)} disabled={busy} />
							<FieldDate label={translate("date")} name={`measure_${userUuid}_date`} value={date} width={FIELD_WIDTH.date}
								onChange={(e) => setDate(e.target.value)} disabled={busy} />
						</Group>
						<FieldTextarea label={translate("measureNote")} name={`measure_${userUuid}_note`} value={note}
							onChange={(e) => setNote(e.target.value)} rows={3} disabled={busy} hint={translate("measureNoteHint")} />
						<Group>
							<Button variant="primary" onClick={() => void add()} disabled={busy}>{translate("measureAdd")}</Button>
						</Group>
					</GroupCol>
				)}
				<Notice inline items={notices} />
			</GroupCol>
		</Modal>
	);
};

export default MeasuresModal;
