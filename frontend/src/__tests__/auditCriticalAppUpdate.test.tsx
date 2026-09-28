/**
 * Регрессия аудита критических ошибок 27.09, КР-10: после деплоя вкладки не перезагружаются без
 * спроса. Новый Service Worker ждёт; без спроса вкладка обновляется, только когда в ней нет
 * несохранённого и человек её не видит (скрыта или только что открыта), иначе — уведомление
 * «Доступна новая версия» с кнопкой. В Tauri SW по-прежнему не регистрируется.
 */
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { render, screen, fireEvent, cleanup, act, renderHook } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
// Статически — для проверок UIToast: словарь переводов лежит в исходном экземпляре i18.
import UIToast from "src/components/UIToast";
import * as appUpdate from "src/services/appUpdate";

// ── Поддельный Service Worker API ─────────────────────────────────────────────

class FakeWorker extends EventTarget {
	state = "installed";
	postMessage = vi.fn();
}
class FakeRegistration extends EventTarget {
	waiting: FakeWorker | null = null;
	installing: FakeWorker | null = null;
	scope = "/";
}
class FakeContainer extends EventTarget {
	controller: object | null;
	registration = new FakeRegistration();
	register = vi.fn(() => Promise.resolve(this.registration));
	getRegistrations = vi.fn(() => Promise.resolve([]));
	constructor(controlled: boolean) {
		super();
		this.controller = controlled ? {} : null;
	}
}

const reload = vi.fn();
let visibility: DocumentVisibilityState = "visible";
const realLocation = window.location;

function install(controlled: boolean): FakeContainer {
	const c = new FakeContainer(controlled);
	Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: c });
	return c;
}

/** Свежие модули: у registerSW состояние на уровне модуля (время открытия страницы, регистрация). */
async function load() {
	vi.resetModules();
	const sw = await import("src/services/registerSW");
	const upd = await import("src/services/appUpdate");
	return { sw, upd };
}

beforeEach(() => {
	reload.mockReset();
	visibility = "visible";
	Object.defineProperty(window, "location", { configurable: true, value: { href: "http://localhost/", reload } });
	Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
	vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
});
afterEach(() => {
	cleanup();
	vi.useRealTimers();
	Object.defineProperty(window, "location", { configurable: true, value: realLocation });
	delete (navigator as unknown as Record<string, unknown>).serviceWorker;
	delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
	document.querySelectorAll("[data-modal-root]").forEach((n) => n.remove());
});

/** Человек уже работает: прошло больше 30 с с загрузки страницы. */
const workLater = () => vi.setSystemTime(Date.now() + 60_000);

describe("sw.js (КР-10)", () => {
	it("установка не включает новую версию сама; SKIP_WAITING от вкладки — включает", async () => {
		const src = fs.readFileSync(path.resolve(__dirname, "../../public/sw.js"), "utf8");
		const handlers: Record<string, (e: unknown) => void> = {};
		const self = {
			addEventListener: (t: string, fn: (e: unknown) => void) => { handlers[t] = fn; },
			skipWaiting: vi.fn(() => Promise.resolve()),
			clients: { claim: vi.fn(() => Promise.resolve()) },
			location: { origin: "http://localhost" },
		};
		const caches = {
			open: vi.fn(() => Promise.resolve({ addAll: vi.fn(() => Promise.resolve()) })),
			keys: vi.fn(() => Promise.resolve([])),
			delete: vi.fn(() => Promise.resolve(true)),
		};
		// Скрипт воркера — в поддельном окружении: self, caches и console подменены.
		// eslint-disable-next-line @typescript-eslint/no-implied-eval
		const runWorker = new Function("self", "caches", "console", src) as (s: unknown, c: unknown, con: unknown) => void;
		runWorker(self, caches, { info() { } });
		let installed: Promise<unknown> | undefined;
		handlers.install({ waitUntil: (p: Promise<unknown>) => { installed = p; } });
		vi.useRealTimers();
		await installed;
		expect(caches.open).toHaveBeenCalled();
		expect(self.skipWaiting).not.toHaveBeenCalled();
		handlers.message({ data: { type: "SKIP_WAITING" } });
		expect(self.skipWaiting).toHaveBeenCalledTimes(1);
	});
});

describe("registerSW: новая версия (КР-10)", () => {
	it("есть несохранённое — SKIP_WAITING не шлём, перезагрузки нет; «Обновить» — включает и перезагружает", async () => {
		const c = install(true);
		const w = new FakeWorker();
		c.registration.waiting = w;
		const { sw, upd } = await load();
		workLater();
		const off = upd.registerReloadBlocker(() => true);
		await sw.registerServiceWorker();
		expect(w.postMessage).not.toHaveBeenCalled();
		expect(upd.getAppUpdateState()).toBe("ready");
		expect(reload).not.toHaveBeenCalled();
		// Кнопка «Обновить».
		upd.applyAppUpdate();
		expect(w.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
		c.dispatchEvent(new Event("controllerchange"));
		expect(reload).toHaveBeenCalledTimes(1);
		off();
	});

	it("новую версию включила другая вкладка: здесь несохранённое — ждём; вкладку скрыли без несохранённого — обновляемся", async () => {
		const c = install(true);
		const { sw, upd } = await load();
		workLater();
		let unsaved = true;
		upd.registerReloadBlocker(() => unsaved);
		await sw.registerServiceWorker();
		c.dispatchEvent(new Event("controllerchange"));
		expect(reload).not.toHaveBeenCalled();
		expect(upd.getAppUpdateState()).toBe("activated");
		// Скрыли, но несохранённое есть — ждём дальше.
		visibility = "hidden";
		document.dispatchEvent(new Event("visibilitychange"));
		expect(reload).not.toHaveBeenCalled();
		// Записали, снова скрыли — перезагрузка.
		unsaved = false;
		document.dispatchEvent(new Event("visibilitychange"));
		expect(reload).toHaveBeenCalledTimes(1);
	});

	it("человек работает, несохранённого нет — не перезагружаем на глазах: уведомление, обновление при скрытии", async () => {
		const c = install(true);
		const { sw, upd } = await load();
		workLater();
		await sw.registerServiceWorker();
		const w = new FakeWorker();
		w.state = "installing";
		c.registration.installing = w;
		c.registration.dispatchEvent(new Event("updatefound"));
		w.state = "installed";
		w.dispatchEvent(new Event("statechange"));
		expect(w.postMessage).not.toHaveBeenCalled();
		expect(upd.getAppUpdateState()).toBe("ready");
		visibility = "hidden";
		document.dispatchEvent(new Event("visibilitychange"));
		expect(w.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
		c.dispatchEvent(new Event("controllerchange"));
		expect(reload).toHaveBeenCalledTimes(1);
	});

	it("только что открытая вкладка без несохранённого обновляется сразу", async () => {
		const c = install(true);
		const w = new FakeWorker();
		c.registration.waiting = w;
		const { sw } = await load();
		await sw.registerServiceWorker();
		expect(w.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
		c.dispatchEvent(new Event("controllerchange"));
		expect(reload).toHaveBeenCalledTimes(1);
	});

	it("первая установка (страница не под SW): смена контроллера — не повод перезагружаться", async () => {
		const c = install(false);
		const { sw } = await load();
		workLater();
		await sw.registerServiceWorker();
		c.controller = {};
		c.dispatchEvent(new Event("controllerchange"));
		expect(reload).not.toHaveBeenCalled();
	});

	it("повторный вызов не регистрирует второй раз и не удваивает обработчики", async () => {
		const c = install(true);
		const { sw } = await load();
		await sw.registerServiceWorker();
		await sw.registerServiceWorker();
		expect(c.register).toHaveBeenCalledTimes(1);
	});

	it("Tauri: SW не регистрируется", async () => {
		const c = install(false);
		(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
		const { sw } = await load();
		expect(await sw.registerServiceWorker()).toBeNull();
		expect(c.register).not.toHaveBeenCalled();
	});
});

describe("что считается несохранённым (КР-10)", () => {
	it("открытое модальное окно", async () => {
		const { upd } = await load();
		expect(upd.hasUnsavedWork()).toBe(false);
		const m = document.createElement("div");
		m.setAttribute("data-modal-root", "true");
		document.body.appendChild(m);
		expect(upd.hasUnsavedWork()).toBe(true);
	});

	it("терминал: товары в корзине или идёт оплата", async () => {
		// api-клиент терминала при загрузке читает настоящий window.location.
		Object.defineProperty(window, "location", { configurable: true, value: realLocation });
		vi.resetModules();
		const upd = await import("src/services/appUpdate");
		const { useTerminalReloadBlock } = await import("src/models/SalesTerminal/terminalSale");
		const { rerender, unmount } = renderHook(({ busy }: { busy: boolean }) => useTerminalReloadBlock(busy), { initialProps: { busy: true } });
		expect(upd.hasUnsavedWork()).toBe(true);
		rerender({ busy: false });
		expect(upd.hasUnsavedWork()).toBe(false);
		rerender({ busy: true });
		unmount();
		expect(upd.hasUnsavedWork()).toBe(false);
	});
});

describe("UIToast: «Доступна новая версия» (КР-10)", () => {
	beforeEach(() => {
		vi.useRealTimers();
		appUpdate.resetAppUpdateForTests();
	});

	it("кнопка «Обновить»; при несохранённом первое нажатие предупреждает, второе — обновляет", () => {
		const apply = vi.fn();
		render(<UIToast />);
		act(() => appUpdate.setAppUpdateState("ready", apply));
		expect(screen.getByText("Доступна новая версия приложения.")).toBeTruthy();
		appUpdate.registerReloadBlocker(() => true);
		fireEvent.click(screen.getByText("Обновить"));
		expect(apply).not.toHaveBeenCalled();
		expect(screen.getByText(/Есть несохранённые изменения/)).toBeTruthy();
		fireEvent.click(screen.getByText("Всё равно обновить"));
		expect(apply).toHaveBeenCalledTimes(1);
	});

	it("несохранённого нет — «Обновить» обновляет с первого нажатия", () => {
		const apply = vi.fn();
		render(<UIToast />);
		act(() => appUpdate.setAppUpdateState("ready", apply));
		fireEvent.click(screen.getByText("Обновить"));
		expect(apply).toHaveBeenCalledTimes(1);
	});

	it("закрытое крестиком не показывается, пока нет новой новости", () => {
		render(<UIToast />);
		act(() => appUpdate.setAppUpdateState("activated", vi.fn()));
		expect(screen.getByText(/Приложение обновлено в другой вкладке/)).toBeTruthy();
		fireEvent.click(screen.getByLabelText("Закрыть"));
		expect(screen.queryByText(/Приложение обновлено в другой вкладке/)).toBeNull();
		expect(appUpdate.hasPendingAppUpdate()).toBe(true);
	});
});

// Без импорта React eslint считал бы его неиспользуемым — JSX выше его требует.
void React;
