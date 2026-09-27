/**
 * Разделение контекста приложения (аудит 26.09, О3).
 *
 * Переключение вкладки меняет состояние панелей. Раньше контекст был один, и вместе с ним
 * перерисовывались все его потребители — каждая открытая панель целиком. Проверяем:
 *  1. потребитель стабильных действий (useAppActions) не перерисовывается от смены панелей;
 *  2. потребитель состояния панелей (useAppPanes) — перерисовывается;
 *  3. при переключении активной панели содержимое НЕ затронутых панелей не перерисовывается
 *     (memo(PaneItem) + стабильный onClose).
 */
import React from "react";
import { render, act } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { AppContextProvider, useAppActions, useAppPanes, useAppAuth } from "src/app/context";
import type { TPane, TypeAppContextProps } from "src/app/types";
import { Panes } from "src/components/UI";

function makeValue(panes: TPane[], activePane: string | null, fns: TypeAppContextProps["windows"] | null = null): TypeAppContextProps {
	const windows = fns ?? {
		panes,
		paneOrder: panes.map((p) => p.uniqId),
		activePane,
		addPane: vi.fn(),
		requestClose: vi.fn(async () => { }),
		reloadPane: vi.fn(async () => { }),
		setActivePane: vi.fn(),
		updatePaneLabel: vi.fn(),
		registerBeforeClose: vi.fn(() => () => { }),
	};
	return {
		screenRef: { current: null },
		windows: { ...windows, panes, paneOrder: panes.map((p) => p.uniqId), activePane },
		actions: { confirm: vi.fn(() => Promise.resolve(true)) },
		navbar: { props: [], setProps: vi.fn() },
		auth: { user: null, logout: vi.fn() },
	};
}

describe("разделённый контекст приложения", () => {
	it("действия стабильны: смена панелей не перерисовывает их потребителя", () => {
		let actionsRenders = 0;
		let panesRenders = 0;
		let authRenders = 0;
		const seenActions: unknown[] = [];
		const ActionsConsumer = React.memo(() => {
			actionsRenders++;
			seenActions.push(useAppActions());
			return null;
		});
		const PanesConsumer = React.memo(() => {
			panesRenders++;
			useAppPanes();
			return null;
		});
		const AuthConsumer = React.memo(() => {
			authRenders++;
			useAppAuth();
			return null;
		});
		const first = makeValue([], null);
		const tree = (v: TypeAppContextProps) => (
			<AppContextProvider value={v}>
				<ActionsConsumer />
				<PanesConsumer />
				<AuthConsumer />
			</AppContextProvider>
		);
		const { rerender } = render(tree(first));
		const pane = { uniqId: "a", label: "A", component: () => null } as TPane;
		// Новое значение с теми же функциями, но другими панелями — как после переключения вкладки.
		// Объекты navbar и auth пересобираются, как в App, но их поля те же.
		rerender(tree({ ...makeValue([pane], "a", first.windows), screenRef: first.screenRef, actions: first.actions, navbar: { ...first.navbar }, auth: { ...first.auth } }));
		expect(panesRenders).toBe(2);
		expect(actionsRenders).toBe(1);
		expect(authRenders).toBe(1);
		// getPanes читает актуальный список на момент вызова, а не на момент рендера.
		const actions = seenActions[0] as ReturnType<typeof useAppActions>;
		expect(actions.windows.getPanes().map((p) => p.uniqId)).toEqual(["a"]);
		expect(actions.windows.getActivePane()).toBe("a");
	});

	it("переключение вкладки не перерисовывает содержимое остальных панелей", () => {
		const renders: Record<string, number> = { a: 0, b: 0, c: 0 };
		const make = (id: string) => {
			const C = () => {
				renders[id]++;
				return <div>{id}</div>;
			};
			C.displayName = `Pane_${id}`;
			return C;
		};
		const panes = ["a", "b", "c"].map((id) => ({ uniqId: id, label: id.toUpperCase(), component: make(id) }) as TPane);
		const base = makeValue(panes, "a");
		const tree = (v: TypeAppContextProps) => (
			<AppContextProvider value={v}>
				<Panes />
			</AppContextProvider>
		);
		const { rerender } = render(tree(base));
		const before = { ...renders };
		act(() => {
			rerender(tree({ ...base, windows: { ...base.windows, activePane: "b" } }));
		});
		// a и b сменили isActive — их панели перерисовываются; c не затронута.
		expect(renders.c).toBe(before.c);
	});
});
