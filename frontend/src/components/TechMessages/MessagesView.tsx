/**
 * Технические сообщения — ЖУРНАЛ СО ШКАЛОЙ ВРЕМЕНИ (вариант «B», выбран 2026-09-12).
 *
 * УСТРОЙСТВО СТРОКИ. Слева узкая колонка времени моноширинными цифрами, рядом вертикальная
 * линия с точкой цвета сообщения, дальше — текст во всю оставшуюся ширину и целиком, без
 * обрезки. Обрезанное сообщение прячет ровно то, ради чего в список и смотрят, поэтому
 * ширина принадлежит тексту, а уточнения (тип, объект, источник) стоят ПОД ним мелкой
 * строкой: они отвечают на вопросы, которые возникают после прочтения, а не вместо.
 *
 * ПОЧЕМУ ШКАЛА. Вопрос к такому списку почти всегда про ход событий: «отказ в 14:02, следом
 * замолчал агент в 14:07». Колонка времени и линия отвечают на него, не заставляя читать
 * текст: взгляд ведёт по цифрам, а не по абзацам.
 *
 * ГРУППИРОВКА — ТРИ РЕЖИМА (grouping.ts), переключатель над списком: по объекту, по дате,
 * без группировки. Выбор — настройка рабочего места и переживает перезагрузку. Колонка
 * времени сама подстраивается: под днём хватает «чч:мм», а в остальных режимах в строке
 * показывается и дата — иначе «17:32» без дня вводит в заблуждение.
 *
 * ГРУППЫ СВОРАЧИВАЮТСЯ. Заголовок группы — кнопка на всю ширину: попадать курсором в
 * стрелку 10×10 — работа, а не действие. По умолчанию раскрыта группа с АКТУАЛЬНЫМИ
 * сообщениями (она про «сейчас»), а в режиме дней — ещё и самый свежий день, даже если
 * актуального в нём нет: свёрнутый сверху донизу список выглядел бы пустым. Храним только
 * то, что человек переключил сам.
 *
 * ЕДИНИЦА ВЫСОТЫ — $heightFieldInput (плюс-минус пара пикселей): заголовок группы, строка
 * сообщения в одну строку текста и подвал ростом ровно с поле ввода. Список стоит рядом с
 * формами, и его ритм должен быть их ритмом; растёт строка только от самого текста.
 *
 * ДЕЙСТВИЯ ВНУТРИ СТРОКИ. Кнопки («Открыть», «Повторить», «Скрыть») стоят в самом
 * сообщении, а не в общей командной панели: в панели они относились бы к «выбранной
 * строке», и человеку пришлось бы держать в голове, какая выбрана.
 */
import { FC, ReactNode, useCallback, useMemo, useState } from "react";
import { translate } from "src/i18";
import { Button } from "src/components/Button";
import IconButton from "src/components/IconButton/IconButton";
import { Icon } from "src/components/IconButton/icons";
import { getFormatDateOnly, getFormatTimeOnly } from "src/utils/datetime";
import { useAppContext } from "src/app/context";
import { openFormByRef, canOpenByRef } from "src/utils/openFormByRef";
import { dismissMessage, type TechMessage } from "./store";
import ProgressSection from "./ProgressSection";
import {
	GROUP_MODES, GROUP_MODE_LABEL, groupMessages, groupTitleOf, type GroupMode,
} from "./grouping";
import styles from "./TechMessages.module.scss";

/** Палитра сообщения словами: цвет — подспорье, а читают текст. */
const TYPE_LABEL: Record<TechMessage["type"], string> = {
	error: "techMsgError",
	attention: "techMsgAttention",
	warning: "techMsgWarning",
	success: "techMsgSuccess",
	info: "techMsgInfo",
};

/** Как разложен список — настройка рабочего места, переживает перезагрузку. */
const MODE_KEY = "tech_messages_group";

const readMode = (): GroupMode => {
	try {
		const v = localStorage.getItem(MODE_KEY);
		return GROUP_MODES.includes(v as GroupMode) ? (v as GroupMode) : "object";
	} catch { return "object"; }
};

const Message: FC<{ message: TechMessage; mode: GroupMode }> = ({ message: m, mode }) => {
	const { addPane } = useAppContext().windows;
	const canOpen = !!m.ref && canOpenByRef(m.ref.endpoint);
	const at = new Date(m.firstAt).toISOString();
	// Под заголовком дня дата известна и в строке не нужна; в остальных режимах — нужна.
	const withDate = mode !== "date";
	/*
	 * ОБЪЕКТ И ИСТОЧНИК — РАЗНЫЕ ПОДПИСИ ТОЛЬКО ПОКА ОНИ РАЗНЫЕ.
	 *
	 * У записи без ссылки на объект заголовком объекта служит сам источник (groupTitleOf),
	 * и строка получала две одинаковые подписи подряд: «Пользователь базы: Иванов —
	 * Пользователь базы: Иванов». Заметнее всего это было без группировки, где объект
	 * называется в каждой строке, — но повтор бессмысленен в любом режиме. Поэтому подпись
	 * ставится один раз: совпали — показываем одну.
	 */
	const objectTitle = groupTitleOf(m).title;
	const sameTitle = objectTitle === m.source;
	// В режиме объектов источник, равный заголовку группы, повторял бы её в каждой строке.
	const showSource = !!m.source && !(mode === "object" && sameTitle);
	/*
	 * ПРЕДСТАВЛЕНИЕ ОБЪЕКТА И ЕСТЬ ССЫЛКА НА НЕГО.
	 *
	 * Раньше строка называла объект трижды: видом («Реализация»), представлением
	 * («Реализация ТМЗ и услуг: № 3 - 05.03.2026») и ещё раз — подписью кнопки «Открыть».
	 * Вид ничего не добавляет к представлению, с которого он и начинается, а кнопка
	 * повторяла уже написанное рядом и занимала целый ряд под текстом. Осталось одно:
	 * представление, по которому и открывают.
	 */
	const linkText = m.source || m.ref?.label || "";

	return (
		<article className={styles.Row} data-type={m.type} data-past={!m.active || undefined}>
			{/*
			  * ЧТО ЭТО ЗА СООБЩЕНИЕ — под датой и временем, а не в подстрочнике.
			  *
			  * Род сообщения («Ошибка», «Сведения») отвечает на тот же вопрос, что и цвет
			  * точки на шкале: насколько это важно. Читают его вместе со временем — взглядом
			  * по левой колонке, — а не после текста, где он стоял первым среди уточнений и
			  * отодвигал то, что действительно уточняет: объект и источник.
			  */}
			<div className={styles.RowTime}>
				{withDate && <span className={styles.RowDay}>{getFormatDateOnly(at)}</span>}
				<span>{getFormatTimeOnly(at)}</span>
				<span className={styles.MsgType}>{translate(TYPE_LABEL[m.type])}</span>
			</div>

			{/* Линия со точкой — шкала времени: по ней видно, что за чем шло. */}
			<div className={styles.RowRail} aria-hidden="true">
				<span className={styles.RowDot} />
			</div>

			<div className={styles.RowBody}>
				<div className={styles.MsgText}>{m.text}</div>

				<div className={styles.MsgActions}>
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
				<div className={styles.MsgMeta}>
					{showSource && (canOpen ? (
						<button type="button" className={styles.MsgLink}
							title={`${translate("open")}: ${linkText}`}
							onClick={() => void openFormByRef(m.ref!, addPane, m.source)}>
							{linkText}
						</button>
					) : <span>{linkText}</span>)}
					{/*
					  * «Неактуально» здесь больше не пишется, и вот почему. Пометка имела смысл,
					  * пока сообщение формы, перестав звучать, оставалось в списке историей: она
					  * отличала «так сейчас» от «так было». Теперь состояние, которого больше
					  * нет, из списка уходит (см. reportNotices), и все оставшиеся записи без
					  * признака «актуально» — это разовые СОБЫТИЯ: «операция выполнена», «нет
					  * связи». Событие не бывает неактуальным — оно случилось, и пометка о
					  * неактуальности сообщала о нём неправду.
					  */}
					{/*
					  * ЧЬЁ ЭТО СООБЩЕНИЕ. Запись живого источника — текущее состояние открытой
					  * формы, а не запись в журнале: она держится, пока форма так считает, и
					  * очистка её не берёт. Без этой пометки «Очистить историю» выглядела
					  * сломанной: нажал — а сообщения остались.
					  */}
					{m.fromSource && m.active && <span>{translate("techMsgFromForm")}</span>}
					{/* Повторы склеены в одну запись (notify, key): сколько раз — сказано числом. */}
					{(m.repeat ?? 1) > 1 && (
						<span title={`${translate("techMsgRepeated")}: ${m.repeat}`}>×{m.repeat}</span>
					)}
				</div>


			</div>

			{/*
			  * «СКРЫТЬ» — В ПРАВОМ ВЕРХНЕМ УГЛУ СТРОКИ, а не в ряду действий.
			  *
			  * Это не действие по сообщению, а уборка самой строки, и место у неё то же, что
			  * у крестика любого закрываемого блока, — угол. В ряду с «Открыть» и «Повторить»
			  * она читалась как равная им, а у длинного текста уезжала вниз, под абзац, и
			  * искать её приходилось глазами. Подпись одна и та же на каждой строке, поэтому
			  * кнопка-иконка: повторённое сорок раз слово отнимает место у текста.
			  *
			  * У ЖИВОГО СООБЩЕНИЯ КНОПКИ НЕТ ВОВСЕ. Скрыть его нельзя: форма сообщает своё
			  * состояние заново, и запись возвращается через секунду. Кнопка, обещающая то,
			  * чего не может, хуже отсутствующей; вместо неё в подстрочнике сказано, кто это
			  * сообщает.
			  */}
			<div className={styles.RowClose}>
				{!(m.fromSource && m.active) && (
					<IconButton size="sm" title={translate("hide")}
						aria-label={translate("hide")}
						onClick={() => dismissMessage(m.id)}>
						<Icon name="clear" />
					</IconButton>
				)}
			</div>
		</article>
	);
};

export const MessagesView: FC<{
	messages: TechMessage[];
	/** Команды всего списка: чьи сообщения показывать, очистка истории. */
	toolbar?: ReactNode;
	/** Пейн среза «Текущая форма»: операции других пейнов скрыты. Нет — всё приложение. */
	pane?: string;
}> = ({ messages, toolbar, pane }) => {
	const [mode, setMode] = useState<GroupMode>(readMode);
	/*
	 * ПОИСК — по тексту и источнику. Предел журнала 200 записей, и при десятке объектов
	 * нужное сообщение искалось глазами: группировка отвечает «чьё это», но не «где то,
	 * про lock-файл». Отбор «только ошибки» — второй частый вопрос: остальное в этот момент
	 * только мешает.
	 */
	const [needle, setNeedle] = useState("");
	const [errorsOnly, setErrorsOnly] = useState(false);
	const shown = useMemo(() => {
		const q = needle.trim().toLowerCase();
		return messages.filter((m) => {
			if (errorsOnly && m.type !== "error" && m.type !== "attention") return false;
			if (!q) return true;
			return m.text.toLowerCase().includes(q) || (m.source ?? "").toLowerCase().includes(q);
		});
	}, [messages, needle, errorsOnly]);
	const groups = useMemo(() => groupMessages(shown, mode), [shown, mode]);
	const active = useMemo(() => messages.filter((m) => m.active).length, [messages]);

	/*
	 * Свёрнутость. Ключи групп в разных режимах разные («ref:sales» и «day:12.09.2026»),
	 * поэтому один словарь обслуживает все три: переключение режима не путает состояния.
	 */
	const [choice, setChoice] = useState<Record<string, boolean>>({});
	const toggle = useCallback((id: string, now: boolean) =>
		setChoice((prev) => ({ ...prev, [id]: !now })), []);

	const pickMode = useCallback((v: GroupMode) => {
		setMode(v);
		try { localStorage.setItem(MODE_KEY, v); } catch { /* не беда */ }
	}, []);

	/** Раскрыта ли группа по умолчанию — см. шапку файла. */
	const openByDefault = (g: (typeof groups)[number], i: number) =>
		g.active > 0 || (mode === "date" && i === 0) || mode === "none";

	const isOpen = (g: (typeof groups)[number], i: number) => choice[g.id] ?? openByDefault(g, i);
	// «Свернуть все» показываем, пока есть что сворачивать, иначе — «Развернуть все».
	const anyOpen = groups.some((g, i) => isOpen(g, i));
	const setAll = useCallback((open: boolean) =>
		setChoice(Object.fromEntries(groups.map((g) => [g.id, open]))), [groups]);

	return (
		<div className={styles.View}>
			{/*
			  * СЧЁТЧИКИ — В КОМАНДНОЙ ПАНЕЛИ, а не подвалом списка. Подвал занимал целую
			  * строку у самого низа области — там, где и так тесно, — и повторял то, что
			  * рядом с кнопками читается заодно с ними: сколько всего и сколько сейчас. А
			  * зависят от этих чисел именно кнопки («Очистить историю» гаснет, когда чистить
			  * нечего), и стоять им лучше рядом.
			  */}
			{(toolbar || !!messages.length) && (
				<div className={styles.ViewTools}>
					{toolbar}
					{!!messages.length && (
						<>
							<input
								className={styles.Search}
								type="search"
								value={needle}
								placeholder={translate("search")}
								aria-label={translate("search")}
								onChange={(e) => setNeedle(e.target.value)}
							/>
							<Button size="sm" variant="secondary" active={errorsOnly}
								title={translate("techMsgErrorsOnlyHint")}
								onClick={() => setErrorsOnly((v) => !v)}>
								{translate("techMsgErrorsOnly")}
							</Button>
							{/* Когда отбор что-то отсёк, счётчик говорит об этом: «12 из 200».
							    Иначе человек считает, что видит всё. */}
							<span className={styles.ViewCount}>
								{translate("techMsgActive")}: {active} · {translate("total")}: {
									shown.length === messages.length
										? messages.length
										: `${shown.length} / ${messages.length}`
								}
							</span>
						</>
					)}
				</div>
			)}

			{/* Как разложен список — команда всего списка, поэтому стоит над ним. */}
			<div className={styles.ViewGroupBar}>
				<span className={styles.GroupBarLabel}>{translate("techMsgGroup")}</span>
				{GROUP_MODES.map((v) => (
					<Button key={v} size="sm" variant="secondary" active={mode === v}
						onClick={() => pickMode(v)}>
						{translate(GROUP_MODE_LABEL[v])}
					</Button>
				))}
				{mode !== "none" && groups.length > 1 && (
					/* Обёртка, а не класс на кнопке: <Button /> расстилает props поверх своего
						 className, и переданный класс стёр бы оформление кнопки целиком. */
					<span className={styles.GroupBarAll}>
						<Button size="sm" variant="secondary" onClick={() => setAll(!anyOpen)}>
							{translate(anyOpen ? "techMsgCollapseAll" : "techMsgExpandAll")}
						</Button>
					</span>
				)}
			</div>

			{/*
			  * СЕТКА СКВОЗНАЯ. Ширина колонки времени и шкалы задана здесь, а не в каждой
			  * строке: при `auto` каждая строка меряла свою колонку сама, и текст соседних
			  * строк начинался на разных вертикалях — список рассыпался на лесенку. Под
			  * заголовком дня в колонке одно «чч:мм», в остальных режимах ещё и дата,
			  * поэтому ширин две и выбирает их режим.
			  */}
			<div className={styles.Frame} data-mode={mode}>
				{/*
				  * ЖУРНАЛ ДЛЯ ВСПОМОГАТЕЛЬНЫХ ТЕХНОЛОГИЙ (M17) — по смыслу, но без собственного
				  * озвучивания: живой регион на весь список читал бы вслух каждую перерисовку
				  * (секунды «идёт уже 40 с», раскрытие группы). Новое объявляет Announcer в
				  * области, и только то, о чём не сказал тост.
				  */}
				<div className={styles.Rows} role="log" aria-live="off" aria-label={translate("techMessages")}>
					{/* Идущая работа — над случившимся: она про «сейчас», и она меняется. */}
					<ProgressSection mode={mode} needle={needle} errorsOnly={errorsOnly} pane={pane} />

					{!groups.length && (
						<span className={styles.Empty}>
							{/* «Ничего не нашлось» и «сообщений нет» — разные ответы: первый
							    значит, что отбор можно снять, второй — что всё в порядке. */}
							{messages.length ? translate("techMsgNothingFound") : translate("techMessagesNone")}
						</span>
					)}

					{groups.map((g, i) => {
						const open = isOpen(g, i);
						return (
							<section key={g.id} className={styles.Group}>
								{/* Без группировки заголовка нет: одна пачка не нуждается в имени. */}
								{g.kind !== "none" && (
									<button type="button" className={styles.GroupHead} data-kind={g.kind}
										aria-expanded={open} onClick={() => toggle(g.id, open)}>
										{/* Стрелка занимает колонку шкалы, а заголовок начинается там же, где
										    текст сообщений: одна вертикаль на весь список. */}
										<span className={`${styles.GroupCaret}${open ? ` ${styles.CaretOpen}` : ""}`}>
											<Icon name="caretDown" />
										</span>
										<span className={styles.GroupTitle}>{g.title}</span>
										{g.kind === "object" && g.active > 0 && (
											<span className={styles.GroupActive}>{g.active}</span>
										)}
										<span className={styles.GroupTotal}>{g.items.length}</span>
									</button>
								)}

								{open && (
									<div className={styles.GroupBody}>
										{g.items.map((m) => <Message key={m.id} message={m} mode={mode} />)}
									</div>
								)}
							</section>
						);
					})}
				</div>
			</div>
		</div>
	);
};

export default MessagesView;
