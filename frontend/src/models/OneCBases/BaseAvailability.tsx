/**
 * Доступность базы — и что делать, когда её нет.
 *
 * ПРО ЧТО ЭТО. Кластер перечисляет РЕГИСТРАЦИИ баз, а не сами базы. Бывает, что база из
 * СУБД удалена, а запись в кластере осталась: `rac` честно отвечает ONLINE, и база выглядит
 * рабочей ровно до первой команды внутрь, которая отвечает «База данных отсутствует в
 * сервере баз данных. Не найдена база данных 'aibek' в SQL-сервере 'localhost'». Дальше по
 * кругу: нажали «Обновить», подождали минуту, получили то же самое.
 *
 * ЧТО ЗДЕСЬ ДЕЛАЕТСЯ. Во-первых, называется причина — по коду, который сервис разобрал из
 * ответа (см. ibFailureReason): «нет в СУБД», «нет в кластере», «не пускают». Во-вторых,
 * даётся действие, доступное панели.
 *
 * ПОЧЕМУ НЕ «УДАЛИТЬ БАЗУ». Удалять регистрацию в кластере панель не будет: это разрушающее
 * действие над чужой системой, и делает его администратор на самом сервере 1С — осознанно и
 * зная, что данные восстановить неоткуда. Панель умеет другое: перестать считать базу
 * рабочей. Скрытая база уходит из групповых операций и из отборов, а решение обратимо —
 * восстановили базу из копии, вернули в работу.
 */
import { useRunningCommand } from "src/components/TechMessages/operations";
import { FC, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { translate } from "src/i18";
import { Button } from "src/components/Button";
import { Icon } from "src/components/IconButton/icons";
import Modal from "src/components/Modal";
import Notice from "src/components/Notice";
import { FormArea, GroupCol, GroupRow } from "src/components/UI";
import { showToast } from "src/components/UIToast";
import { reportError } from "src/services/errors/route";
import { dropBaseRegistration, removeBaseFromRegistry, setBaseHidden } from "src/services/onec/api";
import { unreachableReason, useOnecWrite } from "src/models/OneCAdmin/shared";
import { withOp } from "src/models/OneCAdmin/progress";

export const BaseAvailability: FC<{
	baseKey: string;
	status: string;
	/** Что знает о базе кластер, независимо от скрытия (С44): `MISSING` — регистрации уже нет. */
	clusterStatus: string;
	/** Скрыта ли база в реестре: решение администратора, а не состояние сервера. */
	hidden: boolean;
	ibUnreachableAt: string | null;
	ibUnreachableReason: string | null;
	/** База убрана из реестра — карточке больше нечего показывать. */
	onRemoved?: () => void;
}> = ({ baseKey, status, clusterStatus, hidden, ibUnreachableAt, ibUnreachableReason, onRemoved }) => {
	const canWrite = useOnecWrite();
	const qc = useQueryClient();
	const [confirmDrop, setConfirmDrop] = useState(false);
	const [confirmRemove, setConfirmRemove] = useState(false);
	/*
	 * РЕГИСТРАЦИИ В КЛАСТЕРЕ НЕТ (П32). Такой базе не нужны ни «Удалить регистрацию» (удалять нечего — агент ответил
	 * бы «не найдена в кластере»), ни «Скрыть/Вернуть в работу» (работать с ней нельзя в любом случае). Нужно одно —
	 * убрать строку из списка (С45).
	 */
	const missing = clusterStatus === "MISSING";

	const remove = useMutation({
		mutationFn: () => withOp(
			{ kind: "delete", title: translate("onecBaseRemoveFromList"), target: baseKey },
			() => removeBaseFromRegistry(baseKey),
		),
		onSuccess: () => {
			setConfirmRemove(false);
			showToast(translate("onecBaseRemovedFromList"), "success");
			void qc.invalidateQueries({ queryKey: ["onec", "bases"] });
			void qc.invalidateQueries({ queryKey: ["onec-bases"] });
			onRemoved?.();
		},
		onError: (e) => {
			setConfirmRemove(false);
			reportError(e, { source: translate("onecBase") });
		},
	});

	const hide = useMutation({
		mutationFn: (next: boolean) => withOp(
			{ kind: "update", title: translate(next ? "onecBaseHide" : "onecBaseUnhide"), target: baseKey },
			() => setBaseHidden(baseKey, next),
		),
		onSuccess: () => {
			showToast(translate("saved"), "success");
			void qc.invalidateQueries({ queryKey: ["onec", "bases"] });
			void qc.invalidateQueries({ queryKey: ["onec-bases"] });
		},
		onError: (e) => reportError(e, { source: translate("onecBase") }),
	});

	/**
	 * Удаление мёртвой регистрации — единственное настоящее лечение фантома: скрытие лишь
	 * убирает базу с глаз панели, а запись в кластере продолжает жить и мешать всем
	 * остальным инструментам. Данные не трогаются — их нет; что база действительно мертва,
	 * проверяет САМ АГЕНТ через СУБД и у живой базы отказывает.
	 */
	const dropRunning = useRunningCommand(["CLUSTER_DROP_INFOBASE"], baseKey);
	const drop = useMutation({
		mutationFn: () => withOp(
			{ kind: "delete", title: translate("onecBaseDropRegistration"), target: baseKey },
			() => dropBaseRegistration(baseKey),
		),
		onSuccess: (r) => {
			setConfirmDrop(false);
			// Ответ агента говорит, что именно он сделал, — он точнее любого нашего пересказа.
			// Удалено, а строка ещё видна кластеру (П17) — предупреждение, а не молчаливое «Сохранено».
			const still = r.state?.infobases?.stillListed === true;
			showToast(still ? `${r.note || translate("saved")}. ${translate("onecDropStillListed")}` : (r.note || translate("saved")),
				still ? "warning" : "success");
			void qc.invalidateQueries({ queryKey: ["onec", "bases"] });
			void qc.invalidateQueries({ queryKey: ["onec-bases"] });
		},
		onError: (e) => {
			setConfirmDrop(false);
			reportError(e, { source: translate("onecBase") });
		},
	});

	// Пока с базой всё в порядке и её никто не прятал, раздел молчит: место на экране
	// стоит дороже, чем сообщение «проблем нет».
	if (!ibUnreachableAt && !hidden && !missing) return null;

	return (
		<FormArea title={translate("onecBaseAvailability")}>
			<GroupCol>
				{missing && (
					<Notice inline items={[{ type: "attention", text: translate("onecBaseMissingHint") }]} />
				)}
				{!missing && ibUnreachableAt && (
					<Notice inline items={[{
						type: ibUnreachableReason === "NO_DB" || ibUnreachableReason === "NO_INFOBASE"
							? "attention" : "warning",
						text: unreachableReason({ status, disabled: hidden, ibUnreachableAt, ibUnreachableReason }),
					}]} />
				)}
				{!missing && hidden && (
					<Notice inline items={[{ type: "info", text: translate("onecBaseHiddenHint") }]} />
				)}
				{/* Спрятать базу и удалить её регистрацию — разрушающее: правом «только
				    просмотр» видно причину недоступности, но не трогают саму запись (F5). */}
				{canWrite && missing && <GroupRow>
					<Button icon="trash" variant="danger" disabled={remove.isPending}
						title={translate("onecBaseRemoveFromListHint")}
						onClick={() => setConfirmRemove(true)}>
						{translate("onecBaseRemoveFromList")}
					</Button>
				</GroupRow>}
				{canWrite && !missing && <GroupRow>
					<Button variant={hidden ? "secondary" : "danger"} disabled={hide.isPending}
						title={translate(hidden ? "onecBaseUnhideHint" : "onecBaseHideHint")}
						onClick={() => hide.mutate(!hidden)}>
						<Icon name={hidden ? "restore" : "clear"} />
						{" "}{translate(hidden ? "onecBaseUnhide" : "onecBaseHide")}
					</Button>
					{/* Кнопка только у базы, в которую не войти: у рабочей агент всё равно
					    откажет, и предлагать её значило бы звать на отказ. */}
					{ibUnreachableAt && (
						<Button icon="trash" variant="danger" disabled={drop.isPending || dropRunning}
							title={translate("onecBaseDropRegistrationHint")}
							onClick={() => setConfirmDrop(true)}>
							{translate("onecBaseDropRegistration")}
						</Button>
					)}
				</GroupRow>}
			</GroupCol>

			{confirmRemove && (
				<Modal title={translate("onecBaseRemoveFromList")}
					onClose={() => setConfirmRemove(false)} onApply={() => remove.mutate()}>
					<GroupCol>
						<div>{translate("onecBase")}: {baseKey}</div>
						<Notice inline items={[{ type: "info", text: translate("onecBaseRemoveFromListWarning") }]} />
					</GroupCol>
				</Modal>
			)}

			{confirmDrop && (
				<Modal title={translate("onecBaseDropRegistration")}
					onClose={() => setConfirmDrop(false)} onApply={() => drop.mutate()}>
					<GroupCol>
						<div>{translate("onecBase")}: {baseKey}</div>
						{/* Прямым текстом, без смягчений: восстановить запись можно только
						    вручную, со всеми параметрами подключения. */}
						<Notice inline items={[{ type: "attention", text: translate("onecBaseDropRegistrationWarning") }]} />
					</GroupCol>
				</Modal>
			)}
		</FormArea>
	);
};

export default BaseAvailability;
