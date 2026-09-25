/**
 * МОБИЛЬНАЯ РАСКЛАДКА — одна граница на всё приложение.
 *
 * 768 пикселей — та же ширина, на которой навбар прячет ссылки за бургер (main.module.scss,
 * `@media (max-width: 768px)`). Разные границы у разных частей экрана дали бы окно, где
 * шапка уже телефонная, а рабочее пространство ещё настольное, — и в нём не работало бы
 * ни то, ни другое.
 *
 * Отдельный модуль, а не CSS: раскладку на телефоне меняет не только вёрстка, но и
 * поведение (область сообщений раскрывается на весь экран и помнит своё «раскрыта»
 * отдельно — см. TechMessages/store.ts), а поведение из @media не прочитать.
 */
import { useSyncExternalStore } from "react";

export const MOBILE_MEDIA = "(max-width: 768px)";

/*
 * Запрос создаётся при первом обращении, а не при загрузке модуля: в jsdom `matchMedia` нет,
 * и тесты подставляют его сами — к моменту первого рендера, а не к моменту импорта.
 */
let mql: MediaQueryList | null | undefined;
const media = (): MediaQueryList | null => {
	if (mql === undefined) {
		mql = typeof window !== "undefined" && typeof window.matchMedia === "function"
			? window.matchMedia(MOBILE_MEDIA)
			: null;
	}
	return mql;
};

/** Узкий экран прямо сейчас — для кода вне React (хранилища, обработчики). */
export const isMobileLayout = (): boolean => media()?.matches ?? false;

export function subscribeMobileLayout(listener: () => void): () => void {
	const m = media();
	if (!m) return () => { };
	m.addEventListener("change", listener);
	return () => m.removeEventListener("change", listener);
}

export const useIsMobileLayout = (): boolean =>
	useSyncExternalStore(subscribeMobileLayout, isMobileLayout, () => false);
