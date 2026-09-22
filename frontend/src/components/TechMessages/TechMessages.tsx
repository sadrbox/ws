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
import { FC, Suspense, lazy, useEffect, useRef, useState } from "react";
import { translate } from "src/i18";
import { Button } from "src/components/Button";
import IconButton from "src/components/IconButton/IconButton";
import { Icon } from "src/components/IconButton/icons";
import { useAppContext } from "src/app/context";
import {
	APP_SCOPE, clearNoticeHistory, isClearable, setTechMessagesOpen, setTechMessagesPlacement,
	TECH_DOCK_TITLES, useScopedNotices, useTechDockView, useTechMessagesOpen,
	useTechMessagesPlacement, type TechMessage,
} from "./store";
import DockViewMenu from "./DockViewMenu";
import { clearFinished, useOps } from "./operations";
import MessagesView from "./MessagesView";
import styles from "./TechMessages.module.scss";

/*
 * ВИДЫ-СПУТНИКИ ЗАГРУЖАЮТСЯ ПО ТРЕБОВАНИЮ. Журнал сообщений нужен всегда и лежит здесь же, а
 * переписка, помощник, задачи и заметки — это целые разделы приложения со своими запросами и
 * таблицами. Тянуть их в общий кусок ради переключателя, которым воспользуются не все и не
 * сразу, значит удлинять загрузку каждому. React.lazy заодно снимает вопрос круговых импортов:
 * список задач тянет ModelList, а тот — половину каркаса.
 */
const CommunicationsPanel = lazy(() => import("src/models/Communications"));
const ChatList = lazy(() => import("src/models/Chat").then((m) => ({ default: m.ChatList })));
const AiAssistantList = lazy(() => import("src/models/AiAssistant"));
const TodosList = lazy(() => import("src/models/Todos").then((m) => ({ default: m.TodosList })));
const OrgNotes = lazy(() => import("src/components/Notes/OrgNotes"));

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
	/*
	 * ЧТО ПОКАЗЫВАЕТ ОБЛАСТЬ. Место справа (или внизу) одно, а спутников основного экрана
	 * несколько; переключатель в шапке меняет содержимое, не трогая ни размер, ни место.
	 * Выбор живёт в общем состоянии, а не здесь: его же читает свёрнутая полоса, подписываясь
	 * тем, что человек оставил открытым.
	 */
	const view = useTechDockView();
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
	const ops = useOps();
	const running = ops.filter((o) => o.state === "running").length;
	const active = messages.filter((n) => n.active).length;
	// Сколько записей держат открытые формы: именно они остаются после очистки.
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

	const viewTitle = translate(TECH_DOCK_TITLES[view]);

	if (!open) {
		return (
			<>
			<Announcer />
			<aside className={styles.Rail} data-place={placement} aria-label={viewTitle}>
				<IconButton
					size="md"
					title={`${viewTitle}${active ? `: ${active}` : ""}`}
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
				{/* Подпись — то, что человек оставил открытым: свернув «Задачи», он ищет глазами их. */}
				<span className={styles.RailTitle}>{viewTitle}</span>
			</aside>
			</>
		);
	}

	return (
		<>
		<Announcer />
		<aside className={styles.Dock} data-place={placement} aria-label={viewTitle}>
			{/*
			  * ШАПКА — ДВЕ ОБЛАСТИ, А НЕ ОДИН РЯД. Слева то, ЧТО показано (выбор вида и признак
			  * идущей работы), справа — что сделать с самой областью (где держать, свернуть).
			  * Разные обязанности не должны сходиться в одну строку впритык: растянутый на всю
			  * ширину список упирался в кнопки, и на узкой колонке было не понять, где кончается
			  * выбор и начинается управление.
			  */}
			<div className={styles.Head}>
				<div className={styles.HeadLeft}>
					{/*
					  * ЗАГОЛОВОК ОН ЖЕ ВЫБОР. Название области называет то, что под ним, — и оно же
					  * переключает содержимое. Поле ввода (FieldSelect) здесь читалось как «что-то
					  * вводят в шапке», поэтому вид у кнопки заголовочный, а меню выезжает порталом
					  * (см. DockViewMenu) — иначе его обрезала бы узкая колонка у края экрана.
					  */}
					<DockViewMenu />
					{running > 0 && (
						<span className={styles.HeadRunning} title={translate("techMsgProgress")}>
							<span className={styles.Spinner} />
							{running}
						</span>
					)}
				</div>
				<div className={styles.HeadRight}>
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
			</div>

			<div className={styles.Body}>
				{/*
				  * СОДЕРЖИМОЕ ПО ВЫБОРУ. Виды-спутники подгружаются по требованию, поэтому нужен
				  * Suspense: без него первое переключение показало бы пустоту вместо «загружаю».
				  * Каждый вид монтируется заново — состояние переписки и списков живёт в их
				  * собственных хранилищах (react-query, SSE), а не в этой области.
				  */}
				{view !== "messages" && (
					/*
					  * ОБЁРТКА ВИДА. Она даёт чужой панели тот же каркас, что и журналу сообщений
					  * (см. .Panel), а `data-dock-view` — зацепка, по которой каждый вид ужимает
					  * СЕБЯ в своём же модуле стилей: правила про Коммуникации не должны лежать
					  * в файле области сообщений.
					  */
					<div className={styles.Panel} data-dock-view={view}>
						<Suspense fallback={<div className={styles.Empty}>{translate("loading")}</div>}>
							{view === "communications" && <CommunicationsPanel />}
							{view === "chat" && <ChatList />}
							{view === "assistant" && <AiAssistantList />}
							{view === "tasks" && <TodosList variant="embedded" />}
							{view === "notes" && <OrgNotes />}
						</Suspense>
					</div>
				)}
				{/* Переключатели и очистка — команды ВСЕГО списка, поэтому стоят над ним.
				    Действия по отдельному сообщению живут в самом сообщении. */}
				{view === "messages" && <MessagesView
					messages={messages}
					pane={scope === APP_SCOPE ? undefined : scope}
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
							  * Гаснет только при пустом списке: очистка убирает всё видимое, и сообщения
							  * открытых форм тоже — до изменения их состояния (store.hidden).
							  */}
							<Button icon="clear" size="sm" variant="secondary"
								disabled={!clearable}
								title={clearable
									? translate("techMessagesHistoryClear")
									: translate("techMessagesHistoryEmpty")}
								onClick={() => { clearNoticeHistory(scope); clearFinished(); }}>
								{translate("techMessagesHistoryClear")}
							</Button>
						</>
					)}
				/>}
			</div>
		</aside>
		</>
	);
};

export default TechMessages;
