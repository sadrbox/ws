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
 * ВИД — ТАБЛИЦА (MessagesTable): группа — объект, вложенные строки — сами сообщения.
 * Список карточек читался как лента: в нём нельзя было ни отсортировать по времени, ни
 * отобрать поиском, ни сравнить два объекта — а спрашивают у технических сообщений почти
 * всегда именно это. `<Notice />` для показа здесь не используется (решение 2026-09-11).
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
import { FC, useState } from "react";
import { translate } from "src/i18";
import { Button } from "src/components/Button";
import IconButton from "src/components/IconButton/IconButton";
import { Icon } from "src/components/IconButton/icons";
import { useAppContext } from "src/app/context";
import {
	APP_SCOPE, clearNoticeHistory, setTechMessagesOpen, useScopedNotices, useTechMessagesOpen,
} from "./store";
import MessagesTable from "./MessagesTable";
import styles from "./TechMessages.module.scss";

/** Чьи сообщения показывать — настройка рабочего места, переживает перезагрузку. */
const ALL_KEY = "tech_messages_all";

const readAll = (): boolean => {
	try { return localStorage.getItem(ALL_KEY) === "1"; } catch { return false; }
};

export const TechMessages: FC = () => {
	const { activePane } = useAppContext().windows;
	const open = useTechMessagesOpen();
	const [showAll, setShowAll] = useState(readAll);

	const scope = showAll ? APP_SCOPE : (activePane || APP_SCOPE);
	// Подписаны и в свёрнутом виде: счётчик на полосе обязан быть живым, иначе
	// сворачивание означало бы «не знать о новых сообщениях».
	const messages = useScopedNotices(scope);
	const active = messages.filter((n) => n.active).length;

	const toggleAll = (v: boolean) => {
		setShowAll(v);
		try { localStorage.setItem(ALL_KEY, v ? "1" : "0"); } catch { /* не беда */ }
	};

	if (!open) {
		return (
			<aside className={styles.Rail} aria-label={translate("techMessages")}>
				<IconButton
					size="md"
					title={`${translate("techMessages")}${active ? `: ${active}` : ""}`}
					aria-label={translate("techMessagesOpen")}
					onClick={() => setTechMessagesOpen(true)}
				>
					<Icon name="caretDown" />
				</IconButton>
				{active > 0 && <span className={styles.RailCount}>{active}</span>}
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
					onClick={() => setTechMessagesOpen(false)}
				>
					<Icon name="close" />
				</IconButton>
			</div>

			<div className={styles.Body}>
				{/* Переключатели и очистка живут в командной панели таблицы: свой ряд
				    кнопок над ней ломал бы ритм — тот же довод, что и в остальных экранах. */}
				<MessagesTable
					componentName="TechMessages_dock"
					messages={messages}
					extraButtons={(
						<>
							<Button variant="secondary" active={!showAll}
								title={translate("techMessagesCurrentHint")}
								onClick={() => toggleAll(false)}>
								{translate("techMessagesCurrent")}
							</Button>
							<Button variant="secondary" active={showAll}
								title={translate("techMessagesAllHint")}
								onClick={() => toggleAll(true)}>
								{translate("techMessagesAll")}
							</Button>
							<Button variant="secondary"
								disabled={messages.every((m) => m.active)}
								title={translate("techMessagesHistoryClear")}
								onClick={() => clearNoticeHistory(scope)}>
								<Icon name="clear" /> {translate("techMessagesHistoryClear")}
							</Button>
						</>
					)}
				/>
			</div>
		</aside>
	);
};

export default TechMessages;
