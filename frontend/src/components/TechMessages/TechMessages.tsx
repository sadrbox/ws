/**
 * «Технические сообщения» — правая область приложения, куда выводятся ВСЕ `<Notice />`.
 *
 * ОДНО МЕСТО НА ВСЁ. Раньше сообщение рисовалось там, где его создали: в одной форме
 * справа внизу, в другой над таблицей, в третьей между областями. Появление двигало
 * разметку под курсором, исчезновение двигало обратно, а искать его приходилось заново в
 * каждой форме. Теперь место одно и то же, и разметка форм не меняется никогда.
 *
 * ДВЕ ЧАСТИ, ПОТОМУ ЧТО ВОПРОСЫ РАЗНЫЕ:
 *   «Сейчас»  — то, что не так прямо в эту минуту: не заполнено обязательное поле, агент
 *               не на связи, запрос отказал. Видно всегда, без раскрытия.
 *   «История» — то, что было и прошло: итоги операций, ушедшие ошибки. Свёрнута, потому
 *               что нужна не постоянно, а когда спрашивают «а что это было?».
 *
 * ДВА СРЕЗА ПО ИСТОЧНИКУ. По умолчанию показываем сообщения ТЕКУЩЕГО пейна: у человека
 * открыто до десятка форм, и «не заполнено обязательное поле» из соседнего документа
 * сбивает с толку. Переключатель «Все» показывает всё приложение — для случая «где-то
 * что-то отказало, а где — непонятно».
 *
 * СВОРАЧИВАНИЕ — ШИРИНОЙ, А НЕ НАКЛАДКОЙ. Область живёт в том же флекс-ряду, что и пейны:
 * свёрнутая занимает узкую полосу, раскрытая — свою долю. Никакого `position: absolute`:
 * накладка закрывала бы содержимое формы ровно там, где с ним работают, и печатать под
 * всплывшей панелью нельзя.
 */
import { FC, useState } from "react";
import { translate } from "src/i18";
import { NoticeItems } from "src/components/Notice";
import { Button } from "src/components/Button";
import IconButton from "src/components/IconButton/IconButton";
import { Icon } from "src/components/IconButton/icons";
import { getFormatDate } from "src/utils/datetime";
import { useAppContext } from "src/app/context";
import { APP_SCOPE, clearNoticeHistory, useScopedNotices } from "./store";
import styles from "./TechMessages.module.scss";

/** Ключ хранения: состояние области переживает перезагрузку — это настройка рабочего места. */
const OPEN_KEY = "tech_messages_open";
const ALL_KEY = "tech_messages_all";

const readFlag = (key: string, fallback: boolean): boolean => {
	try {
		const v = localStorage.getItem(key);
		return v === null ? fallback : v === "1";
	} catch {
		return fallback;
	}
};

const writeFlag = (key: string, v: boolean): void => {
	try { localStorage.setItem(key, v ? "1" : "0"); } catch { /* приватный режим — не беда */ }
};

export const TechMessages: FC = () => {
	const { activePane } = useAppContext().windows;
	const [open, setOpen] = useState(() => readFlag(OPEN_KEY, false));
	const [showAll, setShowAll] = useState(() => readFlag(ALL_KEY, false));
	const [openHistory, setOpenHistory] = useState(false);

	// Пока область свёрнута, всё равно подписаны: счётчик на полосе обязан быть живым,
	// иначе сворачивание означало бы «не знать о новых сообщениях».
	const mine = useScopedNotices(showAll ? APP_SCOPE : (activePane || APP_SCOPE));
	const active = mine.filter((n) => n.active);
	const history = mine.filter((n) => !n.active);

	const toggle = (v: boolean) => { setOpen(v); writeFlag(OPEN_KEY, v); };
	const toggleAll = (v: boolean) => { setShowAll(v); writeFlag(ALL_KEY, v); };

	if (!open) {
		return (
			<aside className={styles.Rail} aria-label={translate("techMessages")}>
				<IconButton
					size="md"
					title={`${translate("techMessages")}${active.length ? `: ${active.length}` : ""}`}
					aria-label={translate("techMessagesOpen")}
					onClick={() => toggle(true)}
				>
					<Icon name="caretDown" />
				</IconButton>
				{/* Счётчик актуальных: свёрнутая область не должна означать «не знать». */}
				{active.length > 0 && <span className={styles.RailCount}>{active.length}</span>}
				<span className={styles.RailTitle}>{translate("techMessages")}</span>
			</aside>
		);
	}

	return (
		<aside className={styles.Dock} aria-label={translate("techMessages")}>
			<div className={styles.Head}>
				<span className={styles.Title}>{translate("techMessages")}</span>
				<IconButton
					size="md"
					title={translate("techMessagesClose")}
					aria-label={translate("techMessagesClose")}
					onClick={() => toggle(false)}
				>
					<Icon name="close" />
				</IconButton>
			</div>

			<div className={styles.Tools}>
				{/* Чьи сообщения: текущей формы или всего приложения. */}
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
			</div>

			<div className={styles.Body}>
				{!active.length && !openHistory && (
					<span className={styles.Empty}>{translate("techMessagesNone")}</span>
				)}

				{active.map((n) => (
					<div key={n.id} className={styles.Row}>
						{n.source && <span className={styles.Source}>{n.source}</span>}
						<NoticeItems wide items={[{ type: n.type, text: n.text }]} />
					</div>
				))}

				{openHistory && history.map((n) => (
					<div key={n.id} className={styles.Row}>
						<span className={styles.Source}>
							{[n.source, getFormatDate(new Date(n.firstAt).toISOString())].filter(Boolean).join(" · ")}
						</span>
						<NoticeItems wide items={[{ type: n.type, text: n.text }]} />
					</div>
				))}
			</div>

			<div className={styles.Foot}>
				<Button size="sm" variant="secondary" active={openHistory} disabled={!history.length}
					title={history.length ? translate("techMessagesHistoryHint") : translate("techMessagesHistoryEmpty")}
					onClick={() => setOpenHistory((v) => !v)}>
					<span className={openHistory ? styles.CaretOpen : undefined}><Icon name="caretDown" /></span>
					{translate("techMessagesHistory")} ({history.length})
				</Button>
				{openHistory && history.length > 0 && (
					<Button size="sm" variant="secondary"
						title={translate("techMessagesHistoryClear")}
						onClick={() => clearNoticeHistory(showAll ? APP_SCOPE : (activePane || APP_SCOPE))}>
						<Icon name="clear" /> {translate("techMessagesHistoryClear")}
					</Button>
				)}
			</div>
		</aside>
	);
};

export default TechMessages;
