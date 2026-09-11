/**
 * Доска сообщений — нижняя часть правой области панели.
 *
 * Слот занимает своё место ВСЕГДА, пустой он или нет: в этом весь смысл. Сообщение,
 * появляющееся над таблицей, сдвигает её вниз под курсором — здесь сдвигать нечего.
 *
 * Две части, потому что вопросы разные:
 *   «Сейчас»  — то, что не так прямо в эту минуту: агент не на связи, запрос отказал.
 *               Видно всегда, без раскрытия.
 *   «История» — то, что было и прошло: итоги операций, отказы, ушедшие ошибки. Свёрнута,
 *               потому что нужна не постоянно, а когда спрашивают «а что это было?».
 */
import { FC, useState } from "react";
import { translate } from "src/i18";
import Notice from "src/components/Notice";
import { Button } from "src/components/Button";
import { Icon } from "src/components/IconButton/icons";
import { getFormatDate } from "src/utils/datetime";
import { PANEL_SCOPE, clearNoticeHistory, useScopedNotices } from "./notices";
import styles from "./OneCAdmin.module.scss";

export const NoticeBoard: FC<{
	/** Чья доска: панель видит всё, карточка — только свои сообщения. */
	scope?: string;
	/** Полоса внизу карточки: та же доска, но ниже — форме нужно место. */
	compact?: boolean;
}> = ({ scope = PANEL_SCOPE, compact }) => {
	const all = useScopedNotices(scope);
	const [openHistory, setOpenHistory] = useState(false);

	const active = all.filter((n) => n.active);
	const history = all.filter((n) => !n.active);

	return (
		<div className={[styles.NoticeBoard, compact ? styles.NoticeBoardCompact : null].filter(Boolean).join(" ")}>
			<div className={styles.NoticeBoardHead}>
				<span className={styles.NoticeBoardTitle}>{translate("onecNoticeBoard")}</span>
				<Button size="sm" variant="secondary" active={openHistory}
					disabled={!history.length}
					title={history.length ? translate("onecNoticeHistoryHint") : translate("onecNoticeHistoryEmpty")}
					onClick={() => setOpenHistory((v) => !v)}>
					{/* Одна стрелка на оба состояния: раскрытая — перевёрнутая (см. .CaretOpen). */}
					<span className={openHistory ? styles.CaretOpen : undefined}><Icon name="caretDown" /></span>
					{translate("onecNoticeHistory")} ({history.length})
				</Button>
				{openHistory && history.length > 0 && (
					<Button size="sm" variant="secondary" onClick={() => clearNoticeHistory(scope)}
						title={translate("onecNoticeHistoryClear")}>
						<Icon name="clear" /> {translate("onecNoticeHistoryClear")}
					</Button>
				)}
			</div>

			<div className={styles.NoticeBoardBody}>
				{!active.length && !openHistory && (
					<span className={styles.NoticeBoardEmpty}>{translate("onecNoticeNone")}</span>
				)}

				{active.map((n) => (
					<div key={n.id} className={styles.NoticeRow}>
						<span className={styles.NoticeSource}>{n.source}</span>
						<Notice wide items={[{ type: n.type, text: n.text }]} />
					</div>
				))}

				{openHistory && history.map((n) => (
					<div key={n.id} className={styles.NoticeRow}>
						<span className={styles.NoticeSource}>
							{n.source} · {getFormatDate(new Date(n.firstAt).toISOString())}
						</span>
						<Notice wide items={[{ type: n.type, text: n.text }]} />
					</div>
				))}
			</div>
		</div>
	);
};

export default NoticeBoard;
