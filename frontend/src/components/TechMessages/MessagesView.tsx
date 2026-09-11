/**
 * Технические сообщения — ОДНА ВЕРТИКАЛЬНАЯ КОЛОНКА в оформлении <Table />.
 *
 * ПОЧЕМУ НЕ КОЛОНОЧНАЯ СЕТКА. Сетка требует, чтобы у всех строк были одни и те же колонки
 * одной ширины, — а здесь строки разной природы: строка объекта («Реализации», «Базы 1С»)
 * и строка сообщения, которое занимает три-четыре строки текста. Дата и состояние
 * отдельными колонками отнимали ширину у главного — у самого текста, — и он всё равно не
 * помещался. Ширина принадлежит тексту, уточнения стоят ПОД ним.
 *
 * ПОЧЕМУ ВСЁ-ТАКИ В ЯЗЫКЕ ТАБЛИЦЫ. Человек весь день работает со списками приложения, и
 * список сообщений не должен выглядеть чужим. Отсюда общая с <Table /> оболочка: рамка с
 * внутренней тенью вместо карточек, липкая шапка с названием колонки, строка-группа серой
 * полосой, зебра, подсветка строки под курсором и подвал с итогами. Правила и токены — те
 * же самые (см. Table/_table.base.scss).
 *
 * ВЫСОТЫ РАЗНЫЕ И ЭТО НАМЕРЕННО:
 *   строка объекта — ФИКСИРОВАННАЯ (в одну строку поля): это заголовок, он одинаков для
 *     всех и по нему ведут взглядом сверху вниз;
 *   строка сообщения — ПО СОДЕРЖИМОМУ: текст переносится целиком, потому что обрезанное
 *     сообщение прячет ровно то, ради чего в список и смотрят.
 *
 * ДЕЙСТВИЯ ВНУТРИ СТРОКИ. Кнопки («Открыть», «Повторить», «Скрыть») стоят в самом
 * сообщении, а не в общей командной панели: в панели они относились бы к «выбранной
 * строке», и человеку пришлось бы держать в голове, какая выбрана. Здесь действие рядом
 * с тем, к чему относится.
 */
import { FC, ReactNode, useCallback, useMemo, useState } from "react";
import { translate } from "src/i18";
import { Button } from "src/components/Button";
import { Icon } from "src/components/IconButton/icons";
import { getFormatDate } from "src/utils/datetime";
import { useAppContext } from "src/app/context";
import { openFormByRef, canOpenByRef } from "src/utils/openFormByRef";
import { dismissMessage, type TechMessage } from "./store";
import { groupMessages } from "./grouping";
import styles from "./TechMessages.module.scss";

/** Палитра сообщения словами: цвет — подспорье, а читают текст. */
const TYPE_LABEL: Record<TechMessage["type"], string> = {
	error: "techMsgError",
	attention: "techMsgAttention",
	warning: "techMsgWarning",
	success: "techMsgSuccess",
	info: "techMsgInfo",
};

const Message: FC<{ message: TechMessage; zebra: "even" | "odd" }> = ({ message: m, zebra }) => {
	const { addPane } = useAppContext().windows;
	const canOpen = !!m.ref && canOpenByRef(m.ref.endpoint);

	return (
		<article className={styles.Msg} data-type={m.type} data-zebra={zebra}
			data-past={!m.active || undefined}>
			{/* Ячейка строки: то же место, что у .TableBodyCell, но с переносом текста. */}
			<div className={styles.MsgCell}>
				<div className={styles.MsgText}>{m.text}</div>

				<div className={styles.MsgFoot}>
					{/* Уточнения: тип, источник, когда, актуально ли. Мелкой строкой — они
					    отвечают на вопросы, которые возникают после прочтения, а не вместо. */}
					<div className={styles.MsgMeta}>
						<span className={styles.MsgType}>{translate(TYPE_LABEL[m.type])}</span>
						{m.source && <span>{m.source}</span>}
						<span>{getFormatDate(new Date(m.firstAt).toISOString())}</span>
						<span>{translate(m.active ? "techMsgActive" : "techMsgPast")}</span>
					</div>

					<div className={styles.MsgActions}>
						{canOpen && (
							<Button size="sm" variant="secondary"
								title={`${translate("open")}: ${m.ref?.label ?? ""}`.trim()}
								onClick={() => void openFormByRef(m.ref!, addPane, m.source)}>
								<Icon name="open" /> {m.ref?.label || translate("open")}
							</Button>
						)}
						{/* Действия гаснут, когда повод исчерпан (форму сохранили): нажимать их
						    уже не по чему, но сама запись остаётся — что было, то было. */}
						{m.actions?.map((a, i) => (
							<Button key={i} size="sm" variant="secondary" disabled={m.resolved}
								title={m.resolved ? translate("techMessagesResolved") : a.label}
								onClick={() => { void a.onClick(); dismissMessage(m.id); }}>
								{a.label}
							</Button>
						))}
						<Button size="sm" variant="secondary" title={translate("hide")}
							onClick={() => dismissMessage(m.id)}>
							<Icon name="clear" /> {translate("hide")}
						</Button>
					</div>
				</div>
			</div>
		</article>
	);
};

export const MessagesView: FC<{
	messages: TechMessage[];
	/** Команды всего списка: чьи сообщения показывать, очистка истории. */
	toolbar?: ReactNode;
}> = ({ messages, toolbar }) => {
	const groups = useMemo(() => groupMessages(messages), [messages]);
	const active = useMemo(() => messages.filter((m) => m.active).length, [messages]);
	/*
	 * Свёрнутость: по умолчанию раскрыт объект, у которого есть АКТУАЛЬНЫЕ сообщения, —
	 * он про «сейчас»; остальные про прошлое и ждут, пока их откроют. Храним только то,
	 * что человек переключил сам: новый объект с актуальным сообщением раскроется, не
	 * спрашивая ни у кого разрешения.
	 */
	const [choice, setChoice] = useState<Record<string, boolean>>({});
	const toggle = useCallback((id: string, now: boolean) =>
		setChoice((prev) => ({ ...prev, [id]: !now })), []);

	/*
	 * Зебра считается СКВОЗНО по видимым строкам, а не внутри группы: чередование — помощь
	 * глазу вести строку до конца, и оно не должно сбрасываться на каждом заголовке.
	 */
	let row = 0;

	return (
		<div className={styles.View}>
			{toolbar && <div className={styles.ViewTools}>{toolbar}</div>}

			<div className={styles.Frame}>
				{/* Шапка — как у таблицы: называет колонку и держится сверху при прокрутке. */}
				<div className={styles.ListHead}>
					<span className={styles.ListHeadTitle}>{translate("subject")}</span>
					{active > 0 && (
						<span className={styles.ListHeadCount}>
							{translate("techMsgActive")}: {active}
						</span>
					)}
				</div>

				<div className={styles.Rows}>
					{!groups.length && <span className={styles.Empty}>{translate("techMessagesNone")}</span>}

					{groups.map((g) => {
						const open = choice[g.id] ?? g.active > 0;
						return (
							<section key={g.id} className={styles.Obj}>
								{/* Строка-заголовок объекта — фиксированной высоты: по ней ведут
								    взглядом, и прыгающая высота мешала бы этому больше, чем помогала. */}
								<button type="button" className={styles.ObjHead} onClick={() => toggle(g.id, open)}>
									<span className={open ? styles.CaretOpen : undefined}>
										<Icon name="caretDown" />
									</span>
									<span className={styles.ObjTitle}>{g.title}</span>
									{g.active > 0 && <span className={styles.ObjActive}>{g.active}</span>}
									<span className={styles.ObjTotal}>{g.items.length}</span>
								</button>

								{open && (
									<div className={styles.ObjBody}>
										{g.items.map((m) => (
											<Message key={m.id} message={m} zebra={row++ % 2 ? "odd" : "even"} />
										))}
									</div>
								)}
							</section>
						);
					})}
				</div>

				{/* Подвал — итоги, как <tfoot>: сколько записей всего и сколько из них актуальны. */}
				{!!messages.length && (
					<div className={styles.ListFoot}>
						<span>{translate("techMsgActive")}: {active}</span>
						<span>{translate("total")}: {messages.length}</span>
					</div>
				)}
			</div>
		</div>
	);
};

export default MessagesView;
