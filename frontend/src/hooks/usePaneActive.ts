/**
 * usePaneActive — «панель на экране»: активна ли панель, в которой живёт компонент, и видна ли
 * вкладка браузера. Нужен опросам по расписанию (О4 аудита 26.09).
 *
 * ЗАЧЕМ. Все панели смонтированы разом, неактивные просто скрыты. `refetchInterval` у react-query
 * не знает о панелях: `refetchIntervalInBackground: false` останавливает опрос только в скрытой
 * вкладке браузера, а в скрытой ПАНЕЛИ он шёл дальше. У администратора 1С с десятком панелей это
 * 60–70 фоновых запросов в минуту ради экранов, на которые никто не смотрит.
 *
 * КАК. Корень панели оборачивает содержимое в `PaneActiveProvider` со своим uniqId; всё внутри
 * спрашивает `usePaneActive()`. Вне провайдера (модальное окно, тест) панель считается активной —
 * опрос ведёт себя как раньше. Провайдер подписан на список панелей, но перерисовывается только
 * он сам: содержимое получает новое значение, лишь когда меняется активность ИМЕННО этой панели.
 *
 * Модуль без JSX и с не-компонентными экспортами — поэтому .ts (Fast Refresh: см. памятку о хабах).
 */
import { createContext, createElement, useContext, useSyncExternalStore, type FC, type PropsWithChildren } from "react";
import { useAppPanes } from "src/app/context";

/**
 * Признак активности панели. Экспортирован для оболочки панелей: если PaneItem (components/UI)
 * станет давать его сам (`<PaneActiveContext.Provider value={isActive}>`), обёртки в корнях панелей
 * станут лишними, но не вредными — внутреннее значение совпадёт.
 */
export const PaneActiveContext = createContext<boolean | null>(null);

/**
 * Содержимое панели `uniqId` узнаёт, активна ли она. Без uniqId (компонент встроен в чужую панель,
 * например список баз во вкладке «Кластеры») — признак наследуется от внешней панели, а вне всякой
 * панели — «активна».
 */
export const PaneActiveProvider: FC<PropsWithChildren<{ uniqId?: string }>> = ({ uniqId, children }) => {
	const { activePane } = useAppPanes();
	const outer = useContext(PaneActiveContext);
	const active = uniqId ? activePane === uniqId : (outer ?? true);
	return createElement(PaneActiveContext.Provider, { value: active }, children);
};

/** Активна ли панель, в которой смонтирован компонент (вне панели — да). */
export function usePaneActive(): boolean {
	return useContext(PaneActiveContext) ?? true;
}

const subscribeVisibility = (onChange: () => void) => {
	if (typeof document === "undefined") return () => { };
	document.addEventListener("visibilitychange", onChange);
	return () => document.removeEventListener("visibilitychange", onChange);
};
const pageVisible = () => typeof document === "undefined" || document.visibilityState !== "hidden";

/** Видна ли вкладка браузера. */
export function usePageVisible(): boolean {
	return useSyncExternalStore(subscribeVisibility, pageVisible, () => true);
}

/** Панель активна и вкладка браузера видна — опрашивать есть для кого. */
export function usePaneOnScreen(): boolean {
	const active = usePaneActive();
	const visible = usePageVisible();
	return active && visible;
}

/**
 * Интервал опроса для react-query: `ms`, пока панель на экране, иначе `false`.
 *
 * Возвращает ФУНКЦИЮ, а не число: для «Прогресса» (TechMessages/fetchLabels) опрашиваемый запрос —
 * тот, у наблюдателя которого задан refetchInterval; функция остаётся заданной и в скрытой панели,
 * поэтому её редкое перечитывание (после команды) не выглядит как «ждём данных».
 */
export function usePanePollInterval(ms: number | false): () => number | false {
	const value = usePaneOnScreen() ? ms : false;
	// react-query сравнивает ВЫЧИСЛЕННОЕ значение: таймер пересоздаётся, только когда оно сменилось.
	return () => value;
}
