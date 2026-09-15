/**
 * Вход в поле ячейки SubTable (Enter, следующее поле, новая строка) не выделяет текст — курсор в конце значения.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { focusAtEnd } from "src/components/SubTable/caret";

describe("focusAtEnd", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		document.body.innerHTML = "";
	});

	it("фокус без выделения: курсор после последнего символа", () => {
		vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { cb(0); return 0; });
		const input = document.createElement("input");
		input.type = "text";
		input.value = "Администрирование 1С";
		document.body.appendChild(input);

		focusAtEnd(input);

		expect(document.activeElement).toBe(input);
		expect(input.selectionStart).toBe(input.value.length);
		expect(input.selectionEnd).toBe(input.value.length);
	});

	it("поле потеряло фокус до перерисовки — курсор не трогаем", () => {
		let frame: FrameRequestCallback | undefined;
		vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { frame = cb; return 0; });
		const input = document.createElement("input");
		input.value = "abc";
		document.body.appendChild(input);
		const spy = vi.spyOn(input, "setSelectionRange");

		focusAtEnd(input);
		input.blur();
		frame?.(0);

		expect(spy).not.toHaveBeenCalled();
	});
});
