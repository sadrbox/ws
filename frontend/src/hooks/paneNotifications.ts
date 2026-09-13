/**
 * Уведомления панелей — ТОНКАЯ НАДСТРОЙКА над «Техническими сообщениями».
 *
 * ЧТО БЫЛО. Здесь жила своя карта уведомлений по пейнам, свой журнал в localStorage и своя
 * рассылка подписчикам. Рядом жил `<Notice />` со своим выводом внутри форм, колокольчик в
 * шапке со своим всплывающим списком и пейн «Центр уведомлений» со своим чтением журнала.
 * Четыре механизма об одном и том же — это четыре места, которые обязаны совпадать, а они
 * расходятся: уведомление пропадало из одного и оставалось в другом.
 *
 * ЧТО СТАЛО. Хранилище одно (components/TechMessages/store). Здесь остались только имена,
 * которыми пользуется форма: завести уведомление по пейну, снять, погасить «сетевые»,
 * пометить неактуальными после сохранения. Область видимости уведомления — идентификатор
 * пейна, ровно как у `<Notice />`, поэтому и показываются они вместе.
 *
 * ВСПЛЫВАЮЩЕЕ СООБЩЕНИЕ остаётся: <UIToast /> отвечает на вопрос «что сейчас произошло»,
 * а область — на вопрос «что вообще происходило». Это разные вопросы (см. памятку
 * «Notice vs Toast»).
 */
import { useMemo } from "react";
import {
	dismissByKey, dismissMessage, clearScope, notify, resolveMessages,
	useScopedNotices, type TechMessage,
} from "src/components/TechMessages/store";

export interface PaneNotificationAction {
	label: string;
	onClick: () => void | Promise<void>;
}

export interface PaneNotification {
	id: string;
	type: "info" | "warning" | "error";
	text: string;
	timestamp: number;
	actions?: PaneNotificationAction[];
	/** Уведомление неактуально (форма сохранена/обновлена) — действия заблокированы */
	resolved?: boolean;
	/** Ссылка на объект-источник уведомления — для перехода к форме документа. */
	ref?: { endpoint: string; uuid: string; label?: string };
}

/** Запись хранилища → уведомление панели: имена полей прежние, источник один. */
const toNote = (m: TechMessage): PaneNotification => ({
	id: m.id,
	// В хранилище палитра шире (info/success/warning/attention/error); у уведомлений
	// панелей исторически три состояния, и «attention» ближе всего к ошибке.
	type: m.type === "error" || m.type === "attention" ? "error" : m.type === "warning" ? "warning" : "info",
	text: m.text,
	timestamp: m.firstAt,
	actions: m.actions,
	resolved: m.resolved,
	ref: m.ref,
});

/** Добавить уведомление к панели. */
export function addPaneNotification(
	uniqId: string,
	type: PaneNotification["type"],
	text: string,
	/** Контекст: заголовок панели и ссылка на объект. */
	context?: {
		paneLabel?: string;
		ref?: { endpoint: string; uuid: string; label?: string };
		/** Ключ склейки повторов (например NETWORK_KEY): одна запись «×N» вместо десятка. */
		key?: string;
	},
	/** Кнопки-действия внутри уведомления. */
	actions?: PaneNotificationAction[],
): void {
	// Тост и запись — два показа одного события (см. notify): тост отвечает «что сейчас
	// произошло», область — «что вообще происходило». Запись активна: уведомление панели
	// ждёт человека («Повторить», «нет связи») и снимается явно.
	notify({
		scope: uniqId,
		severity: type,
		text,
		source: context?.paneLabel ?? "",
		ref: context?.ref,
		actions,
		active: true,
		toastTitle: context?.paneLabel,
		key: context?.key,
	});
}

/** Удалить конкретное уведомление. */
export function dismissPaneNotification(_uniqId: string, noteId: string): void {
	dismissMessage(noteId);
}

/**
 * Ключ «сетевых» уведомлений: нет связи, сервер недоступен, данные из кэша, сохранено
 * локально. Одно на панель — последнее состояние связи, повторы склеиваются.
 */
export const NETWORK_KEY = "network";

/**
 * Удалить из панели «сетевые» уведомления (offline / нет связи / локальный кэш).
 * Вызывается после успешного online-обращения к серверу, чтобы устаревшие
 * предупреждения не вводили пользователя в заблуждение.
 *
 * По КЛЮЧУ, а не по тексту: прежняя регулярка знала четыре формулировки и пропускала пятую
 * («Сервер временно недоступен»), а любая правка текста молча ломала снятие.
 */
export function dismissNetworkNotifications(uniqId: string): void {
	dismissByKey(uniqId, NETWORK_KEY);
}

/** Очистить все уведомления панели. */
export function clearPaneNotifications(uniqId: string): void {
	clearScope(uniqId);
}

/**
 * Пометить уведомления панели неактуальными (resolved). Сами уведомления остаются
 * видимыми, но действия (кнопки) блокируются: повод для них исчерпан.
 */
export function resolvePaneNotifications(uniqId: string): void {
	resolveMessages(uniqId);
}

/**
 * Хук: уведомления конкретной панели — на случай, если форме понадобится показать их у
 * себя. Сейчас их показывает область «Технические сообщения», поэтому потребителей нет;
 * оставлен как единственный законный способ прочитать уведомления пейна, чтобы следующая
 * форма не завела вместо него собственную карту.
 */
export function usePaneNotifications(uniqId: string): PaneNotification[] {
	const all = useScopedNotices(uniqId);
	return useMemo(() => all.filter((m) => m.active).map(toNote), [all]);
}
