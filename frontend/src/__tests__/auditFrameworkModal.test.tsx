/**
 * Регрессия аудита 26.09 (Б7, И14, И17): окно подтверждения, модальные окна, useConfirm.
 */
import React, { useState } from "react";
import { render, screen, fireEvent, act, renderHook, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, afterEach } from "vitest";
import Modal from "src/components/Modal";
import modalManager from "src/components/Modal/modalManager";
import ConfirmModal from "src/components/ConfirmModal";
import { useConfirm } from "src/hooks/useConfirm";

afterEach(() => { cleanup(); modalManager.clearAll(); });

describe("ConfirmModal (Б7)", () => {
	it("сообщение выводится текстом: разметка из имени файла не исполняется", () => {
		const evil = `Удалить файл «<img src=x onerror="window.__xss=1">»?\nДействие необратимо.`;
		render(<ConfirmModal isOpen message={evil} onConfirm={() => { }} onCancel={() => { }} />);
		const p = screen.getByTestId("confirm-message");
		expect(p.textContent).toBe(evil);
		expect(p.querySelector("img")).toBeNull();
		expect(document.querySelector("img[src='x']")).toBeNull();
	});

	it("Tab доходит до «Да»/«Отмена», Enter на «Да» подтверждает (И14)", async () => {
		const user = userEvent.setup();
		const onConfirm = vi.fn();
		render(<ConfirmModal isOpen message="Удалить?" onConfirm={onConfirm} onCancel={() => { }} />);
		await user.tab();
		expect(document.activeElement?.textContent).toBe("Да");
		await user.tab();
		expect(document.activeElement?.textContent).toBe("Отмена");
		await user.tab();
		expect(document.activeElement?.textContent).toBe("Да");
		await user.keyboard("{Enter}");
		expect(onConfirm).toHaveBeenCalledTimes(1);
	});
});

describe("Modal (И14)", () => {
	it("role=dialog, aria-modal и подпись по заголовку", () => {
		render(<Modal title="Заголовок" onClose={() => { }}><div /></Modal>);
		const dlg = screen.getByRole("dialog");
		expect(dlg.getAttribute("aria-modal")).toBe("true");
		expect(dlg.getAttribute("aria-labelledby")).toBeTruthy();
		expect(document.getElementById(dlg.getAttribute("aria-labelledby")!)?.textContent).toBe("Заголовок");
	});

	it("Tab проходит поля тела и кнопки шапки", async () => {
		const user = userEvent.setup();
		render(
			<Modal title="T" onClose={() => { }} onApply={() => { }}>
				<input data-testid="i1" />
				<input data-testid="i2" />
			</Modal>,
		);
		const seen: string[] = [];
		for (let i = 0; i < 4; i++) {
			await user.tab();
			const el = document.activeElement as HTMLElement;
			seen.push(el.getAttribute("data-testid") || el.textContent || "");
		}
		expect(seen).toEqual(["i2", "Применить", "Отмена", "i1"]);
	});

	it("асинхронное тело: Tab работает и после появления полей", async () => {
		const user = userEvent.setup();
		const Owner = () => {
			const [ready, setReady] = useState(false);
			React.useEffect(() => { setTimeout(() => setReady(true), 0); }, []);
			return <Modal title="T" onClose={() => { }}>{ready ? <input data-testid="a" /> : "loading"}</Modal>;
		};
		render(<Owner />);
		await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
		await user.tab();
		expect((document.activeElement as HTMLElement).getAttribute("data-testid")).toBe("a");
	});

	it("Escape в поле с открытым списком не закрывает окно", () => {
		const onClose = vi.fn();
		render(
			<Modal title="T" onClose={onClose}>
				<input role="combobox" aria-expanded="true" data-testid="lk" />
			</Modal>,
		);
		const lk = screen.getByTestId("lk");
		lk.focus();
		fireEvent.keyDown(lk, { key: "Escape" });
		expect(onClose).not.toHaveBeenCalled();
		// Список закрыт — теперь Escape закрывает окно.
		lk.setAttribute("aria-expanded", "false");
		fireEvent.keyDown(lk, { key: "Escape" });
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it("инлайн-onClose внешней модалки не перерегистрирует её поверх вложенной", () => {
		const outerClose = vi.fn();
		const innerClose = vi.fn();
		const Owner = () => {
			const [inner, setInner] = useState(false);
			const [, bump] = useState(0);
			return (
				<Modal title="Outer" onClose={() => { outerClose(); }}>
					<button onClick={() => setInner(true)}>open</button>
					<button onClick={() => bump((n) => n + 1)}>bump</button>
					{inner ? <Modal title="Inner" onClose={() => { innerClose(); setInner(false); }}><input /></Modal> : null}
				</Modal>
			);
		};
		render(<Owner />);
		fireEvent.click(screen.getByText("open"));
		// Владелец перерисовался (новый инлайн-onClose) — порядок в стеке не меняется.
		fireEvent.click(screen.getByText("bump"));
		fireEvent.keyDown(document.activeElement || document.body, { key: "Escape" });
		expect(innerClose).toHaveBeenCalledTimes(1);
		expect(outerClose).not.toHaveBeenCalled();
	});

	it("двойной щелчок «Применить» вызывает onApply один раз", async () => {
		vi.useFakeTimers();
		try {
			const onApply = vi.fn();
			render(<Modal title="T" onClose={() => { }} onApply={onApply}><div /></Modal>);
			const btn = screen.getByText("Применить");
			fireEvent.click(btn);
			fireEvent.click(btn);
			expect(onApply).toHaveBeenCalledTimes(1);
			await act(async () => { await Promise.resolve(); vi.advanceTimersByTime(1000); });
			fireEvent.click(btn);
			expect(onApply).toHaveBeenCalledTimes(2);
		} finally {
			vi.useRealTimers();
		}
	});

	it("«Применить» с промисом заблокирована до его завершения", async () => {
		let resolve: () => void = () => { };
		const onApply = vi.fn(() => new Promise<void>((r) => { resolve = r; }));
		render(<Modal title="T" onClose={() => { }} onApply={onApply}><div /></Modal>);
		const btn = screen.getByText("Применить").closest("button")!;
		fireEvent.click(btn);
		expect(btn.disabled).toBe(true);
		fireEvent.click(btn);
		expect(onApply).toHaveBeenCalledTimes(1);
		await act(async () => { resolve(); await Promise.resolve(); });
		expect(btn.disabled).toBe(false);
	});

	it("отпускание кнопки над фоном после выделения текста не закрывает окно", () => {
		const onClose = vi.fn();
		render(<Modal title="T" onClose={onClose}><input data-testid="in" /></Modal>);
		const backdrop = screen.getByRole("dialog").parentElement!;
		// Нажали в поле, отпустили над фоном: click достаётся общему предку — фону.
		fireEvent.mouseDown(screen.getByTestId("in"));
		fireEvent.click(backdrop);
		expect(onClose).not.toHaveBeenCalled();
		// Настоящий щелчок по фону — закрывает.
		fireEvent.mouseDown(backdrop);
		fireEvent.click(backdrop);
		expect(onClose).toHaveBeenCalledTimes(1);
	});
});

describe("useConfirm (И17)", () => {
	it("второй вызов не подвешивает первый: первый получает false", async () => {
		const { result } = renderHook(() => useConfirm());
		let first: Promise<boolean> | undefined;
		let second: Promise<boolean> | undefined;
		act(() => { first = result.current.confirm("Первый?"); });
		act(() => { second = result.current.confirm("Второй?"); });
		await expect(first!).resolves.toBe(false);
		expect(result.current.confirmState.message).toBe("Второй?");
		act(() => { result.current.confirmState.onConfirm(); });
		await expect(second!).resolves.toBe(true);
	});
});
