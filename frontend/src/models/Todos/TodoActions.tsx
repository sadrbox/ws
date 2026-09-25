/**
 * Действия над задачей E17 (СК1) в ряду кнопок формы, после «Закрыть»:
 *   • «Принять в работу» — обращение клиента, ещё не принятое (п. 3: реакция «в моменте»);
 *   • «Нужна помощь» — эскалация главбуху без последствий для сотрудника (п. 40);
 *   • «Действия ▾»: «Клиент напомнил» (п. 2), «Вернуть: не выполнено» (п. 1), «Оценка клиента» (СК7.2).
 *
 * Каждое действие меняет задачу на сервере (статус, счётчики, журнал), после него список задач
 * и доска перечитываются (invalidate ["todos"]), а форма перечитывает запись. Поэтому при
 * несохранённых правках действия недоступны: перечитывание их бы молча выбросило.
 *
 * Ввод (канал, причина, оценка) — в маленьком окне. Отказ по существу (400) остаётся в окне
 * сообщением (<Notice inline />): человек смотрит туда; сбой сети/сервера — тостом и в журнал
 * (routeError). Успех — тостом.
 */
import { FC, useCallback, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { translate } from "src/i18";
import { Button } from "src/components/Button";
import ActionsDropdownButton from "src/components/Toolbar/ActionsDropdownButton";
import Modal from "src/components/Modal";
import Notice, { type NoticeItem } from "src/components/Notice";
import { FieldSelect, FieldTextarea } from "src/components/Field";
import { showToast } from "src/components/UIToast";
import { routeError } from "src/services/errors/route";
import { acceptTodo, helpTodo, rateTodo, remindTodo, returnTodo } from "src/services/quality/api";
import { REMIND_CHANNELS, todoActions, type StatusLike } from "./todoRules";
import styles from "./Todos.module.scss";

type DialogKind = "remind" | "return" | "help" | "rate";

const RATING_OPTIONS = ["5", "4", "3", "2", "1"].map((v) => ({ value: v, label: v }));

/** Окно ввода к действию: поля, сообщение об отказе и кнопки «применить / отмена». */
const ActionDialog: FC<{
	title: string;
	applyLabel: string;
	notices: NoticeItem[];
	onApply: () => void;
	onClose: () => void;
	children: ReactNode;
}> = ({ title, applyLabel, notices, onApply, onClose, children }) => (
	<Modal
		title={title}
		onClose={onClose}
		className={styles.Dialog}
		buttons={[
			{ label: applyLabel, onClick: onApply, variant: "primary" },
			{ label: translate("cancel"), onClick: onClose, variant: "secondary" },
		]}
	>
		<div className={styles.DialogBody}>
			{children}
			{/* В окне сообщение — часть содержимого: отправить его в боковую колонку значило бы
			    оставить окно без ответа, почему действие не прошло. */}
			<Notice inline wide items={notices} />
		</div>
	</Modal>
);

export const TodoActions: FC<{
	uuid: string;
	kind: string;
	status: string;
	acceptedAt: string;
	statuses: readonly StatusLike[];
	/** Форма грузится или пишется — действия ждут. */
	busy: boolean;
	/** Несохранённые правки: действие перечитало бы задачу и выбросило их. */
	dirty: boolean;
	/** Сообщения для формы — отказ «Принять в работу» (своего окна у него нет). */
	onNotices: (items: NoticeItem[]) => void;
	/** Перечитать задачу после действия. */
	onDone: () => Promise<void> | void;
}> = ({ uuid, kind, status, acceptedAt, statuses, busy, dirty, onNotices, onDone }) => {
	const queryClient = useQueryClient();
	const [dialog, setDialog] = useState<DialogKind | null>(null);
	const [running, setRunning] = useState(false);
	const [text, setText] = useState("");
	const [channel, setChannel] = useState(REMIND_CHANNELS[0].value);
	const [rating, setRating] = useState("5");
	const [notices, setNotices] = useState<NoticeItem[]>([]);

	const acts = todoActions({ isSaved: !!uuid, kind, status, acceptedAt, statuses });

	const source = translate("TodosForm");
	const locked = busy || running || dirty;
	const lockTitle = dirty ? translate("todoActionSaveFirst") : undefined;

	/**
	 * После действия: сказать об успехе, перечитать саму задачу, списки и доску. Списки — не
	 * дожидаясь: доска на пятьсот задач не повод держать форму в ожидании.
	 */
	const finish = useCallback(async (message: string, type: "success" | "warning" = "success") => {
		showToast(message, type);
		onNotices([]); // прежний отказ «Принять в работу» больше не о чем
		void queryClient.invalidateQueries({ queryKey: ["todos"] });
		await onDone();
	}, [queryClient, onDone, onNotices]);

	const open = useCallback((kindOfDialog: DialogKind) => {
		setText("");
		setChannel(REMIND_CHANNELS[0].value);
		setRating("5");
		setNotices([]);
		setDialog(kindOfDialog);
	}, []);

	const accept = useCallback(async () => {
		if (locked) return;
		setRunning(true);
		onNotices([]);
		try {
			await acceptTodo(uuid);
			await finish(translate("todoAcceptDone"));
		} catch (e) {
			onNotices(routeError(e, { source }));
		} finally {
			setRunning(false);
		}
	}, [locked, uuid, finish, onNotices, source]);

	const apply = useCallback(async () => {
		if (!dialog || running) return;
		const note = text.trim();
		// Причина возврата обязательна — как на сервере: «вернуть» без того, что не выполнено,
		// исполнителю нечего доделывать.
		if (dialog === "return" && !note) {
			setNotices([{ type: "error", text: translate("todoReturnReasonRequired") }]);
			return;
		}
		setRunning(true);
		setNotices([]);
		try {
			let message = "";
			let tone: "success" | "warning" = "success";
			if (dialog === "remind") {
				await remindTodo(uuid, { channel, note: note || undefined });
				message = translate("todoRemindDone");
			} else if (dialog === "return") {
				await returnTodo(uuid, note);
				message = translate("todoReturnDone");
			} else if (dialog === "help") {
				const r = await helpTodo(uuid, note || undefined);
				// Главбуха у исполнителя может не быть (группы не настроены) — сказать честно,
				// что сигнал никуда не ушёл, а не рапортовать об успехе.
				if ((r?.notified ?? 0) > 0) message = translate("todoHelpDone");
				else { message = translate("todoHelpNobody"); tone = "warning"; }
			} else {
				await rateTodo(uuid, Number(rating), note || undefined);
				message = translate("todoRateDone");
			}
			setDialog(null);
			await finish(message, tone);
		} catch (e) {
			setNotices(routeError(e, { source }));
		} finally {
			setRunning(false);
		}
	}, [dialog, running, text, uuid, channel, rating, finish, source]);

	if (!acts.accept && !acts.help && !acts.remind && !acts.returnBack && !acts.rate) return null;

	const menu = [
		...(acts.remind ? [{ id: "remind", label: translate("todoRemind") }] : []),
		...(acts.returnBack ? [{ id: "return", label: translate("todoReturn") }] : []),
		...(acts.rate ? [{ id: "rate", label: translate("todoClientRating") }] : []),
	];

	const close = () => { if (!running) setDialog(null); };

	return (
		<>
			{acts.accept && (
				<Button disabled={locked} title={lockTitle ?? translate("todoAcceptHint")} onClick={() => void accept()}>
					{translate("todoAccept")}
				</Button>
			)}
			{acts.help && (
				<Button disabled={locked} title={lockTitle ?? translate("todoHelpHint")} onClick={() => open("help")}>
					{translate("todoHelp")}
				</Button>
			)}
			{menu.length > 0 && (
				<ActionsDropdownButton
					label={translate("todoActions")}
					options={menu}
					disabled={locked}
					title={lockTitle}
					onSelect={(id) => open(id as DialogKind)}
				/>
			)}

			{dialog === "remind" && (
				<ActionDialog title={translate("todoRemind")} applyLabel={translate("todoRemindApply")} notices={notices} onApply={() => void apply()} onClose={close}>
					<p className={styles.DialogHint}>{translate("todoRemindHint")}</p>
					{/* ПРОВЕРИТЬ ПОТОМ: каналы обращений клиентов — решение владельца №2 (см. REMIND_CHANNELS). */}
					<FieldSelect name={`todo_${uuid}_remind_channel`} label={translate("todoRemindChannel")} value={channel}
						options={REMIND_CHANNELS.map((c) => ({ value: c.value, label: translate(c.key) }))}
						onChange={(e) => setChannel(e.target.value)} disabled={running}
						hint={translate("todoRemindChannelCheckLater")} />
					<FieldTextarea name={`todo_${uuid}_remind_note`} label={translate("comment")} value={text}
						onChange={(e) => setText(e.target.value)} disabled={running} width="100%" rows={3} />
				</ActionDialog>
			)}
			{dialog === "return" && (
				<ActionDialog title={translate("todoReturn")} applyLabel={translate("todoReturnApply")} notices={notices} onApply={() => void apply()} onClose={close}>
					<p className={styles.DialogHint}>{translate("todoReturnHint")}</p>
					<FieldTextarea name={`todo_${uuid}_return_reason`} label={translate("todoReturnReason")} value={text} required
						onChange={(e) => setText(e.target.value)} disabled={running} width="100%" rows={4} />
				</ActionDialog>
			)}
			{dialog === "help" && (
				<ActionDialog title={translate("todoHelp")} applyLabel={translate("todoHelpApply")} notices={notices} onApply={() => void apply()} onClose={close}>
					<p className={styles.DialogHint}>{translate("todoHelpDialogHint")}</p>
					<FieldTextarea name={`todo_${uuid}_help_note`} label={translate("todoHelpNote")} value={text}
						onChange={(e) => setText(e.target.value)} disabled={running} width="100%" rows={4} />
				</ActionDialog>
			)}
			{dialog === "rate" && (
				<ActionDialog title={translate("todoClientRating")} applyLabel={translate("todoRateApply")} notices={notices} onApply={() => void apply()} onClose={close}>
					<p className={styles.DialogHint}>{translate("todoRateHint")}</p>
					<FieldSelect name={`todo_${uuid}_rating`} label={translate("todoRatingScale")} value={rating}
						options={RATING_OPTIONS} onChange={(e) => setRating(e.target.value)} disabled={running} />
					<FieldTextarea name={`todo_${uuid}_rating_note`} label={translate("comment")} value={text}
						onChange={(e) => setText(e.target.value)} disabled={running} width="100%" rows={3} />
				</ActionDialog>
			)}
		</>
	);
};
TodoActions.displayName = "TodoActions";

export default TodoActions;
