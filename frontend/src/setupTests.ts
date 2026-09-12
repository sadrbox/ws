import '@testing-library/jest-dom';
import { setTranslations } from 'src/i18';
import ru from 'src/i18/translations.json';

// Словарь в приложении грузится отдельным файлом по активному языку (см. i18/index.ts), а
// translate() синхронный: словарь обязан лечь до первого обращения. В тестах языка нет и
// ждать нечего — кладём русский сразу, иначе проверки, сравнивающие подписи, видели бы
// сырые ключи.
setTranslations(ru as Record<string, string>);

// jsdom не реализует ResizeObserver, а таблица подписывается на него, чтобы знать
// высоту области прокрутки. Заглушка ничего не сообщает: в тестах раскладки нет,
// проверяются разметка и состояние.
if (typeof globalThis.ResizeObserver === "undefined") {
	globalThis.ResizeObserver = class {
		observe() { }
		unobserve() { }
		disconnect() { }
	} as unknown as typeof ResizeObserver;
}

// scrollIntoView в jsdom тоже нет — таблица центрирует активную строку.
if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
	Element.prototype.scrollIntoView = function scrollIntoView() { };
}

// Optional: any global test setup can go here
