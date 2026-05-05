import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as modalManager from "src/components/Modal/modalManager";

describe("modalManager basic behavior", () => {
	let screenEl: HTMLElement;
	beforeEach(() => {
		// create a fake screen element
		screenEl = document.createElement("div");
		document.body.appendChild(screenEl);
		modalManager.setScreenRef({ current: screenEl });
		// reset body overflow
		document.body.style.overflow = "";
	});

	afterEach(() => {
		modalManager.clearAll();
		try {
			if (screenEl.parentNode) screenEl.parentNode.removeChild(screenEl);
		} catch {
			/* intentional */
		}
		document.body.style.overflow = "";
	});

	it("applies blur and locks body scroll on register and restores on unregister", () => {
		const close = () => {};
		const unregister = modalManager.registerModal(close);

		expect(screenEl.classList.contains("blur5")).toBe(true);
		expect(document.body.style.overflow).toBe("hidden");

		// unregister
		unregister();
		expect(screenEl.classList.contains("blur5")).toBe(false);
		// overflow should be restored (empty string)
		expect(
			document.body.style.overflow === "" ||
				document.body.style.overflow === null,
		).toBe(true);
	});

	it("closeTop calls top modal", () => {
		let called = 0;
		const a = () => {
			called += 1;
		};
		const b = () => {
			called += 10;
		};
		const ua = modalManager.registerModal(a);
		const ub = modalManager.registerModal(b);

		modalManager.closeTop();
		expect(called).toBe(10);

		// unregister last
		ub();
		ua();
	});
});
