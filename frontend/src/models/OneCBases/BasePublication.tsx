/**
 * Публикация ОДНОЙ базы — в её карточке.
 *
 * ЗАЧЕМ ЗДЕСЬ. Групповые команды живут в списке баз: там выбирают набор. Но когда открыта
 * карточка одной базы, уходить в список, искать её там же и отмечать галочкой — лишний
 * путь ради того, что уже на экране. Команда одна и та же, цель — открытая база.
 *
 * СОСТОЯНИЕ ТРЁХЗНАЧНОЕ: «опубликована», «не опубликована» и «не проверялось». Последнее —
 * не «нет»: срез публикаций агент пока не отдаёт (см. AGENT_FINDINGS), и выдавать незнание
 * за отрицательный ответ значило бы врать о состоянии сервера.
 *
 * ОБЕ КОМАНДЫ ИДЕМПОТЕНТНЫ по контракту, поэтому состояние их не запрещает: публикацию
 * могли снять мимо панели, и запрет «уже опубликована» превращался бы в тупик — запрещена
 * оказывалась ровно та команда, которой расхождение и лечится.
 */
import { useRunningCommand } from "src/components/TechMessages/operations";
import { FC, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { translate } from "src/i18";
import { Button } from "src/components/Button";
import { ValueList, ValueRow } from "src/components/ValueList";
import { FormArea, GroupCol, GroupRow } from "src/components/UI";
import Modal from "src/components/Modal";
import Notice from "src/components/Notice";
import { getFormatDate } from "src/utils/datetime";
import { runBatch, type BatchType } from "src/services/onec/api";
import {
	publishLabel, reportBatchStart, useOnecErrorActions, useOnecWrite, usePublishAddressHint,
} from "src/models/OneCAdmin/shared";
import { attachBatch, startOp } from "src/models/OneCAdmin/progress";
import { useNoticeScope } from "src/components/TechMessages/store";
import { reportError } from "src/services/errors/route";
import styles from "src/models/OneCAdmin/OneCAdmin.module.scss";

type Job = "publish" | "unpublish";

const SPEC: Record<Job, { type: BatchType; title: string; warning: string }> = {
	publish: { type: "IB_PUBLISH", title: "onecPublish", warning: "onecPublishWarning" },
	unpublish: { type: "IB_UNPUBLISH", title: "onecUnpublish", warning: "onecUnpublishWarning" },
};

export const BasePublication: FC<{
	baseKey: string;
	published: boolean | null;
	publishUrl: string | null;
	/**
	 * Адрес под публичным именем сервера («Параметры» агента): агент отдаёт то, что записано в
	 * привязке сайта IIS, и это обычно localhost — рабочий адрес с самого сервера и
	 * бесполезный снаружи.
	 */
	publishUrlPublic: string | null;
	/** Когда состояние проверяли: без даты «нет» и «не знаем» выглядят одинаково. */
	seenAt: string | null;
	/** Сервер базы — по нему берётся «Адрес сервера» для предпросмотра ссылки. */
	serverName?: string | null;
	/** Только команды, без своей группы и списка значений: вкладка «Основное» показывает состояние сама. */
	compact?: boolean;
}> = ({ baseKey, published, publishUrl, publishUrlPublic, seenAt, serverName, compact }) => {
	const canWrite = useOnecWrite();
	const qc = useQueryClient();
	const scope = useNoticeScope();
	const actionsFor = useOnecErrorActions();
	const [confirm, setConfirm] = useState<Job | null>(null);
	/*
	 * КАКОЙ БУДЕТ ССЫЛКА — до нажатия. Публикация идёт на веб-сервер самой машины, и агент
	 * возвращает адрес из привязки сайта IIS: обычно `http://localhost/<база>`. Полезной
	 * ссылку делает «Адрес сервера» из параметров агента, поэтому подтверждение называет
	 * получающийся адрес, а если он не задан — говорит, где его указать.
	 */
	const address = usePublishAddressHint(serverName);

	const publishRunning = useRunningCommand(["IB_PUBLISH", "IB_UNPUBLISH"], baseKey);
	const run = useMutation({
		mutationFn: async (job: Job) => {
			const spec = SPEC[job];
			// Операция видна в «Прогрессе запросов и команд» — как и всё остальное, что
			// панель поручает агенту: «команда отправлена» без продолжения не ответ.
			const op = startOp({
				kind: "update", title: translate(spec.title), target: baseKey,
				total: 1, scope: { bases: [baseKey] },
			});
			const r = await runBatch(spec.type, [baseKey], {});
			attachBatch(op, r.batchId, r.total);
			return r;
		},
		onSuccess: (r) => {
			setConfirm(null);
			reportBatchStart(r, translate("onecPublication"));
			// Реестр перечитает наблюдатель заданий, когда команда выполнится (см.
			// useBatchWatch): сразу после постановки в очередь в нём ещё прежнее состояние.
			void qc.invalidateQueries({ queryKey: ["onec", "bases"] });
		},
		onError: (e: unknown, job) => {
			setConfirm(null);
			// Один канал решает один раз: дословный дубль «тост + запись» человек читал
			// дважды, а решение о канале принимает routeError.
			// Кнопки у отказа «база занята» (П25): повторить ту же публикацию и посмотреть держателя.
			reportError(e, {
				source: translate("onecPublication"), scope,
				actions: actionsFor(e, { baseKey, retry: () => run.mutate(job) }),
			});
		},
	});

	// Подтверждение — одно на оба вида: в сжатом оно висит при кнопках, в полном — при группе.
	const confirmModal = confirm ? (
		<Modal title={translate(SPEC[confirm].title)} onClose={() => setConfirm(null)}
			onApply={() => run.mutate(confirm)}>
			<div className={styles.ConfirmText}>
				<div className={styles.ConfirmDetails}>{translate("onecBase")}: {baseKey}</div>
				<Notice inline items={[
					{ type: "attention", text: translate(SPEC[confirm].warning) },
					// Снятие публикации адреса не создаёт — подсказка только к публикации.
					...(confirm === "publish" ? [address] : []),
				]} />
			</div>
		</Modal>
	) : null;

	/*
	 * СЖАТЫЙ ВИД (18.09): только команды, без своей группы и списка значений. Во вкладке «Основное» состояние
	 * публикации стоит строкой в «Состоянии», и повторять его рядом с кнопками незачем — а подтверждение,
	 * предупреждение об адресе и постановка задания остаются здесь, в одном месте.
	 */
	if (compact) {
		return (
			<>
				{canWrite && (
					<>
						<Button icon="open" variant="secondary" disabled={run.isPending || publishRunning}
							title={`${translate("onecPublish")}: ${baseKey}`}
							onClick={() => setConfirm("publish")}>
							{translate("onecPublish")}
						</Button>
						<Button icon="clear" variant="danger" disabled={run.isPending || publishRunning}
							title={`${translate("onecUnpublish")}: ${baseKey}`}
							onClick={() => setConfirm("unpublish")}>
							{translate("onecUnpublish")}
						</Button>
					</>
				)}
				{confirmModal}
			</>
		);
	}

	return (
		<FormArea title={translate("onecPublication")}>
			<GroupCol>
				{/* Состояние публикации в карточке не правят — его сообщает агент. Тот же
				    список «подпись — значение», что и в «Основном»: одна колонка подписей на
				    всю вкладку, и значения стоят по одной линии. */}
				<ValueList columns={2}>
					<ValueRow label={translate("onecPublication")} value={publishLabel(published)} />
					<ValueRow label={translate("onecPublishUrl")} value={publishUrlPublic || publishUrl || "—"} />
					<ValueRow label={translate("publishSeenAt")} value={seenAt ? getFormatDate(seenAt) : "—"} />
					{/* Ответ агента — рядом, и только когда он отличается от показанного:
					    расхождение и есть повод проверить привязку сайта на сервере. */}
					{publishUrlPublic && publishUrl && publishUrlPublic !== publishUrl && (
						<ValueRow label={translate("onecPublishUrlAgent")} value={publishUrl} />
					)}
				</ValueList>
				{/* Состояние публикации видно всем, кому открыта панель; публиковать и снимать
				    публикацию — только полному доступу (F5): снятая публикация отключает работу
				    людей в базе через веб-клиент. */}
				{canWrite && (
					<GroupRow>
						<Button icon="open" variant="secondary" disabled={run.isPending || publishRunning}
							title={`${translate("onecPublish")}: ${baseKey}`}
							onClick={() => setConfirm("publish")}>
							{translate("onecPublish")}
						</Button>
						<Button icon="clear" variant="danger" disabled={run.isPending || publishRunning}
							title={`${translate("onecUnpublish")}: ${baseKey}`}
							onClick={() => setConfirm("unpublish")}>
							{translate("onecUnpublish")}
						</Button>
					</GroupRow>
				)}
			</GroupCol>

			{confirmModal}
		</FormArea>
	);
};

export default BasePublication;
