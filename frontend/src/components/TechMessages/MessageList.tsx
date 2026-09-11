/**
 * Список технических сообщений, СГРУППИРОВАННЫЙ ПО ОБЪЕКТУ.
 *
 * Один и тот же список показывают два места: правая область (узкая, рядом с работой) и её
 * полноэкранный вид, открываемый из навигации. Раньше это были два разных экрана с двумя
 * разными представлениями одних данных — и они разошлись: в одном была ссылка на объект,
 * в другом кнопки действий, а «очистить» в каждом чистило своё.
 *
 * ГРУППА — ВИД ОБЪЕКТА (см. grouping.ts): сообщения одной реализации стоят рядом с
 * сообщениями других реализаций, а не вперемешку с состоянием агента 1С. Свёрнутость
 * группы человек выбирает сам; группы без актуальных сообщений свёрнуты сразу — они
 * рассказывают о прошлом.
 */
import { FC, useCallback, useMemo, useState } from "react";
import { translate } from "src/i18";
import { NoticeItems } from "src/components/Notice";
import { Button } from "src/components/Button";
import { Icon } from "src/components/IconButton/icons";
import { getFormatDate } from "src/utils/datetime";
import { useAppContext } from "src/app/context";
import { openFormByRef, canOpenByRef } from "src/utils/openFormByRef";
import { dismissMessage, type TechMessage } from "./store";
import { groupMessages } from "./grouping";
import styles from "./TechMessages.module.scss";

const MessageRow: FC<{ m: TechMessage }> = ({ m }) => {
	const { addPane } = useAppContext().windows;
	const canOpen = !!m.ref && canOpenByRef(m.ref.endpoint);

	return (
		<div className={styles.Row}>
			<div className={styles.RowHead}>
				{/* Заголовок формы, а не вид объекта: вид уже назван группой. */}
				{m.source && <span className={styles.Source}>{m.source}</span>}
				<span className={styles.When}>{getFormatDate(new Date(m.firstAt).toISOString())}</span>
				<button className={styles.Dismiss} type="button"
					title={translate("hide")} aria-label={translate("hide")}
					onClick={() => dismissMessage(m.id)}>✕</button>
			</div>

			<NoticeItems wide items={[{ type: m.type, text: m.text }]} />

			{(canOpen || (m.actions && m.actions.length > 0)) && (
				<div className={styles.RowActions}>
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
				</div>
			)}
		</div>
	);
};

export const MessageList: FC<{ messages: TechMessage[] }> = ({ messages }) => {
	const groups = useMemo(() => groupMessages(messages), [messages]);
	/*
	 * Свёрнутость: по умолчанию открыта группа, где есть АКТУАЛЬНЫЕ сообщения, — она про
	 * «сейчас»; остальные про прошлое и ждут, пока их откроют. Выбор человека сильнее
	 * умолчания, поэтому храним только то, что он переключил сам: новая группа с
	 * актуальными сообщениями раскроется, не спрашивая ни у кого разрешения.
	 */
	const [choice, setChoice] = useState<Record<string, boolean>>({});
	const toggle = useCallback((id: string, now: boolean) =>
		setChoice((prev) => ({ ...prev, [id]: !now })), []);

	if (!groups.length) return <span className={styles.Empty}>{translate("techMessagesNone")}</span>;

	return (
		<>
			{groups.map((g) => {
				const open = choice[g.id] ?? g.active > 0;
				return (
					<section key={g.id} className={styles.MsgGroup}>
						<button className={styles.GroupHead} type="button" onClick={() => toggle(g.id, open)}>
							<span className={open ? styles.CaretOpen : undefined}><Icon name="caretDown" /></span>
							<span className={styles.GroupTitle}>{g.title}</span>
							{/* Счёт: актуальные важнее всего, общее число — для понимания объёма. */}
							{g.active > 0 && <span className={styles.GroupActive}>{g.active}</span>}
							<span className={styles.GroupTotal}>{g.items.length}</span>
						</button>
						{open && (
							<div className={styles.GroupBody}>
								{g.items.map((m) => <MessageRow key={m.id} m={m} />)}
							</div>
						)}
					</section>
				);
			})}
		</>
	);
};

export default MessageList;
