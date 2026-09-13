/**
 * «Технические сообщения» — правая область приложения и ЕДИНСТВЕННОЕ место вывода
 * сообщений: и `<Notice />` из форм, и уведомлений панелей.
 *
 * ОДИН МЕХАНИЗМ. Раньше об одном и том же рассказывали четыре поверхности: колокольчик
 * уведомлений панелей со своим всплывающим списком, второй колокольчик со своим журналом,
 * пейн «Центр уведомлений» и `<Notice />` внутри каждой формы. Четыре места, которые
 * обязаны совпадать, — это четыре места, которые расходятся. Теперь данные одни, а
 * показывают их два вида одного и того же списка: эта область и её полноэкранный вид.
 *
 * ВИД — ОДНА ВЕРТИКАЛЬНАЯ КОЛОНКА (MessagesView): заголовок объекта фиксированной высоты,
 * сообщения под ним — по содержимому. Колоночная сетка требует одинаковых колонок у всех
 * строк, а здесь строки разной природы, и дата с состоянием отнимали ширину у главного —
 * у текста. `<Notice />` для показа здесь не используется (решение 2026-09-11).
 *
 * ДВА СРЕЗА ПО ИСТОЧНИКУ. По умолчанию — сообщения ТЕКУЩЕЙ формы: у человека открыто до
 * десятка пейнов, и «не заполнено обязательное поле» из соседнего документа сбивает с
 * толку. Переключатель «Все» показывает всё приложение — для случая «где-то что-то
 * отказало, а где — непонятно».
 *
 * СВОРАЧИВАНИЕ — ШИРИНОЙ, А НЕ НАКЛАДКОЙ. Область живёт в том же флекс-ряду, что и пейны:
 * свёрнутая занимает узкую полосу, раскрытая — свою долю. Никакого `position: absolute`:
 * накладка закрывала бы содержимое формы ровно там, где с ним работают.
 */
import { FC, useEffect, useRef, useState } from "react";
import { translate } from "src/i18";
import { Button } from "src/components/Button";
import IconButton from "src/components/IconButton/IconButton";
import { Icon } from "src/components/IconButton/icons";
import { useAppContext } from "src/app/context";
import {
	APP_SCOPE, clearNoticeHistory, isClearable, setTechMessagesOpen, setTechMessagesPlacement,
	useScopedNotices, useTechMessagesOpen, useTechMessagesPlacement, type TechMessage,
} from "./store";
import { clearFinished, useOnecOps } from "src/models/OneCAdmin/progress";
import MessagesView from "./MessagesView";
import styles from "./TechMessages.module.scss";

/** Чьи сообщения показывать — настройка рабочего места, переживает перезагрузку. */
const ALL_KEY = "tech_messages_all";

const readAll = (): boolean => {
	try { return localStorage.getItem(ALL_KEY) === "1"; } catch { return false; }
};

const announceLine = (m: TechMessage): string => `${m.source ? `${m.source}: ` : ""}${m.text}`;

/**
 * ОБЪЯВИТЬ НОВОЕ ТЕМ, КТО НЕ ВИДИТ ЭКРАН (M17).
 *
 * Тост объявляет себя сам (UIToast: role="alert"/"status"). Но итог фоновой работы, отказ
 * команды и сообщение формы приходят без тоста — и при свёрнутой области человек со
 * скринридером не узнавал о них вовсе. Поэтому здесь объявляется ровно то, о чём тост не
 * сказал: ошибки — срочно, остальные события — вежливо. Состояния форм, кроме ошибок, не
 * объявляются: сводка «правок: 6, 7, 6…» при каждом нажатии превратилась бы в диктовку.
 *
 * Объявляется только ПОЯВИВШЕЕСЯ после монтирования: история из хранилища — не новость.
 * Слушает всё приложение, а не срез: переключение «Текущие/Все» не должно зачитывать
 * чужое старое как новое. Живёт вне ветки «раскрыта/свёрнута» — объявлять важно в обеих.
 */
const Announcer: FC = () => {
	const all = useScopedNotices(APP_SCOPE);
	const seen = useRef<Set<string> | null>(null);
	const [said, setSaid] = useState({ urgent: "", calm: "" });

	useEffect(() => {
		if (!seen.current) {
			seen.current = new Set(all.map((m) => m.id));
			return;
		}
		const known = seen.current;
		const fresh = all.filter((m) => !known.has(m.id));
		if (!fresh.length) return;
		for (const m of fresh) known.add(m.id);

		const quiet = fresh.filter((m) => !m.toastAt);
		const urgent = quiet.filter((m) => m.type === "error" || m.type === "attention");
		const calm = quiet.filter((m) => !urgent.includes(m) && !m.fromSource);
		if (!urgent.length && !calm.length) return;
		setSaid({ urgent: urgent.map(announceLine).join(". "), calm: calm.map(announceLine).join(". ") });
	}, [all]);

	return (
		<>
			<span className={styles.VisuallyHidden} aria-live="assertive" aria-atomic="true" data-announce="urgent">
				{said.urgent}
			</span>
			<span className={styles.VisuallyHidden} aria-live="polite" aria-atomic="true" data-announce="calm">
				{said.calm}
			</span>
		</>
	);
};

export const TechMessages: FC = () => {
	const { activePane } = useAppContext().windows;
	const open = useTechMessagesOpen();
	/*
	 * ГДЕ СТОИТ ОБЛАСТЬ — справа или внизу. Разметку задаёт рабочее пространство (оно одно
	 * знает про обе области), а области нужно знать только своё место: у правой колонки
	 * граница слева и подпись боком, у нижней полосы — граница сверху и подпись как обычно.
	 */
	const placement = useTechMessagesPlacement();
	const [showAll, setShowAll] = useState(readAll);

	const scope = showAll ? APP_SCOPE : (activePane || APP_SCOPE);
	// Подписаны и в свёрнутом виде: счётчик на полосе обязан быть живым, иначе
	// сворачивание означало бы «не знать о новых сообщениях».
	const messages = useScopedNotices(scope);
	/*
	 * ПРИЗНАК ИДУЩЕЙ РАБОТЫ — и на свёрнутой полосе тоже. Счётчик сообщений говорит о
	 * случившемся, а проверка сотни баз идёт минутами и не сообщает о себе ничего, пока не
	 * кончится: свернув область, человек переставал знать, работает ли что-нибудь вообще.
	 */
	const ops = useOnecOps();
	const running = ops.filter((o) => o.state === "running").length;
	const active = messages.filter((n) => n.active).length;
	// Сколько записей держат открытые формы: именно они остаются после очистки.
	const live = messages.filter((n) => n.active && n.fromSource).length;
	/*
	 * ОЧИСТКА — ВСЕГО, ЧТО ВИДНО, А НЕ ТОЛЬКО СООБЩЕНИЙ.
	 *
	 * Операции живут в своём реестре (progress.ts), и прежде очистка его не касалась: список
	 * пустел, а секция «Прогресс запросов и команд» с давно законченной работой оставалась —
	 * будто кнопка сработала наполовину. Уходят только ЗАВЕРШЁННЫЕ: идущую работу убрать с
	 * экрана значило бы перестать знать, что она идёт. Операции не привязаны к форме, и
	 * секция показывает их при любом срезе, поэтому и чистятся они при любом срезе.
	 */
	const finished = ops.length - running;
	const clearable = isClearable(messages) || finished > 0;

	const toggleAll = (v: boolean) => {
		setShowAll(v);
		try { localStorage.setItem(ALL_KEY, v ? "1" : "0"); } catch { /* не беда */ }
	};

	if (!open) {
		return (
			<>
			<Announcer />
			<aside className={styles.Rail} data-place={placement} aria-label={translate("techMessages")}>
				<IconButton
					size="md"
					title={`${translate("techMessages")}${active ? `: ${active}` : ""}`}
					aria-label={translate("techMessagesOpen")}
					onClick={() => setTechMessagesOpen(true)}
				>
					<Icon name="caretDown" />
				</IconButton>
				{/* Счётчик и спиннер — словами для скринридера: «3» и вращение сами ничего не говорят. */}
				{running > 0 && (
					<span className={styles.Spinner} role="img"
						title={translate("techMsgProgress")}
						aria-label={`${translate("techMsgProgress")}: ${running}`} />
				)}
				{active > 0 && (
					<span className={styles.RailCount} aria-label={`${translate("techMsgActive")}: ${active}`}>
						{active}
					</span>
				)}
				<span className={styles.RailTitle}>{translate("techMessages")}</span>
			</aside>
			</>
		);
	}

	return (
		<>
		<Announcer />
		<aside className={styles.Dock} data-place={placement} aria-label={translate("techMessages")}>
			<div className={styles.Head}>
				<span className={styles.Title}>{translate("techMessages")}</span>
				{running > 0 && (
					<span className={styles.HeadRunning} title={translate("techMsgProgress")}>
						<span className={styles.Spinner} />
						{running}
					</span>
				)}
				{/*
				  * ГДЕ ДЕРЖАТЬ ОБЛАСТЬ — решает тот, кто работает. Длинной ошибке нужна
				  * ширина: в узкой колонке справа абзац превращается в лесенку из двух слов.
				  * Широкой форме, наоборот, жалко четверти экрана вбок — ей область уместнее
				  * внизу полосой. Два состояния — две кнопки: нажатая показывает текущее.
				  */}
				<IconButton
					size="md"
					active={placement === "right"}
					title={translate("techMessagesDockRight")}
					aria-label={translate("techMessagesDockRight")}
					onClick={() => setTechMessagesPlacement("right")}
				>
					<Icon name="dockRight" />
				</IconButton>
				<IconButton
					size="md"
					active={placement === "bottom"}
					title={translate("techMessagesDockBottom")}
					aria-label={translate("techMessagesDockBottom")}
					onClick={() => setTechMessagesPlacement("bottom")}
				>
					<Icon name="dockBottom" />
				</IconButton>
				{/*
				  * СВЕРНУТЬ — НЕ ЗАКРЫТЬ. Крестик означает «убрать совсем», а область никуда
				  * не девается: она складывается в полосу, из которой её тем же жестом
				  * достают обратно. Поэтому стрелка — и смотрит она туда, куда область
				  * уедет: вправо у боковой колонки, вниз у нижней полосы. Та же стрелка на
				  * свёрнутой полосе смотрит обратно (см. .Rail): одно движение, два конца.
				  */}
				<IconButton
					size="md"
					className={placement === "bottom" ? styles.CollapseDown : styles.CollapseRight}
					title={translate("techMessagesClose")}
					aria-label={translate("techMessagesClose")}
					onClick={() => setTechMessagesOpen(false)}
				>
					<Icon name="caretDown" />
				</IconButton>
			</div>

			<div className={styles.Body}>
				{/* Переключатели и очистка — команды ВСЕГО списка, поэтому стоят над ним.
				    Действия по отдельному сообщению живут в самом сообщении. */}
				<MessagesView
					messages={messages}
					toolbar={(
						<>
							<Button size="sm" variant="secondary" active={!showAll}
								title={translate("techMessagesCurrentHint")}
								onClick={() => toggleAll(false)}>
								{translate("techMessagesCurrent")}
							</Button>
							<Button size="sm" variant="secondary" active={showAll}
								title={translate("techMessagesAllHint")}
								onClick={() => toggleAll(true)}>
								{translate("techMessagesAll")}
							</Button>
							{/*
							  * Гаснет ровно тогда, когда чистить нечего, — но молча гаснущая кнопка
							  * при непустом списке выглядит сломанной. Подсказка называет, что
							  * осталось и почему: это не мусор, а то, что открытые формы сообщают
							  * прямо сейчас; уберёшь — вернётся.
							  */}
							<Button size="sm" variant="secondary"
								disabled={!clearable}
								title={clearable
									? translate("techMessagesHistoryClear")
									: `${translate("techMessagesOnlyLive")}: ${live}`}
								onClick={() => { clearNoticeHistory(scope); clearFinished(); }}>
								<Icon name="clear" /> {translate("techMessagesHistoryClear")}
							</Button>
						</>
					)}
				/>
			</div>
		</aside>
		</>
	);
};

export default TechMessages;
