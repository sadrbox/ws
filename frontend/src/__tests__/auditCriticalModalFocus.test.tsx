/**
 * Регрессия аудита критических ошибок 27.09, КР-21: ловушка фокуса модального окна обходит по Tab
 * только видимые узлы без tabIndex=-1. Раньше Tab застревал на скрытом <input type=file> у FieldFile
 * (в окне «Загрузить расширение» было не добраться до имени, переключателя и «Применить») и
 * останавливался на кнопках-действиях полей («Быстрый выбор», «Выбрать из списка»).
 */
import React, { useState } from "react";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, afterEach } from "vitest";
import Modal from "src/components/Modal";
import modalManager from "src/components/Modal/modalManager";
import { Field, FieldFile } from "src/components/Field";
import FieldToggle from "src/components/Field/FieldToggle";

afterEach(() => { cleanup(); modalManager.clearAll(); });

const label = (el: Element | null): string => {
	const h = el as HTMLElement | null;
	return h?.getAttribute("data-testid") || h?.getAttribute("name") || h?.textContent?.trim() || "";
};

async function tabSequence(n: number): Promise<string[]> {
	const user = userEvent.setup();
	const seen: string[] = [];
	for (let i = 0; i < n; i++) {
		await user.tab();
		seen.push(label(document.activeElement));
	}
	return seen;
}

describe("Modal: Tab только по видимым узлам без tabIndex=-1 (КР-21)", () => {
	it("скрытые display:none / visibility:hidden и кнопки полей с tabIndex=-1 пропускаются", async () => {
		render(
			<Modal title="T" onClose={() => { }} onApply={() => { }}>
				<button data-testid="pick">Выбрать файл</button>
				<input type="file" data-testid="file" style={{ display: "none" }} />
				<input data-testid="name" />
				<button data-testid="quick" tabIndex={-1}>Быстрый выбор</button>
				<div style={{ visibility: "hidden" }}><input data-testid="ghost" /></div>
				<div hidden><input data-testid="hidden-attr" /></div>
				<input type="checkbox" data-testid="toggle" style={{ opacity: 0, width: 0, height: 0 }} />
			</Modal>,
		);
		expect(label(document.activeElement)).toBe("pick");
		expect(await tabSequence(5)).toEqual(["name", "toggle", "Применить", "Отмена", "pick"]);
	});

	it("Shift+Tab — в обратном порядке, тоже мимо скрытых", async () => {
		render(
			<Modal title="T" onClose={() => { }}>
				<input data-testid="a" />
				<input type="file" data-testid="file" style={{ display: "none" }} />
				<input data-testid="b" />
			</Modal>,
		);
		const user = userEvent.setup();
		await user.tab({ shift: true });
		expect(label(document.activeElement)).toBe("Отмена");
		await user.tab({ shift: true });
		expect(label(document.activeElement)).toBe("b");
		await user.tab({ shift: true });
		expect(label(document.activeElement)).toBe("a");
	});

	it("фокус на кнопке поля (tabIndex=-1) — Tab продолжает с её места, а не с начала окна", async () => {
		render(
			<Modal title="T" onClose={() => { }}>
				<input data-testid="first" />
				<input data-testid="lookup" />
				<button data-testid="quick" tabIndex={-1}>Быстрый выбор</button>
				<input data-testid="after" />
			</Modal>,
		);
		(screen.getByTestId("quick")).focus();
		expect(await tabSequence(1)).toEqual(["after"]);
		(screen.getByTestId("quick")).focus();
		const user = userEvent.setup();
		await user.tab({ shift: true });
		expect(label(document.activeElement)).toBe("lookup");
	});

	it("окно «Загрузить расширение»: Tab доходит до имени, переключателя и «Применить»", async () => {
		// Состав — как в OneCAdmin/BaseExtensionCommands.tsx: файл, имя, безопасный режим.
		function UploadDialog() {
			const [name, setName] = useState("");
			const [safe, setSafe] = useState(true);
			return (
				<Modal title="Установить расширение" onClose={() => { }} onApply={() => { }}>
					<FieldFile name="bec_file" label="Файл расширения (.cfe)" accept=".cfe" onSelect={() => { }} />
					<Field name="bec_name" label="Имя" value={name} noAutofill onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)} />
					<FieldToggle name="bec_safe" label="Безопасный режим" value={safe} onChange={setSafe} />
				</Modal>
			);
		}
		render(<UploadDialog />);
		// Стили модулей jsdom не грузит: правило .FieldFileHiddenInput { display: none } — вручную.
		(document.querySelector('input[type="file"]') as HTMLInputElement).style.display = "none";
		const seen = await tabSequence(4);
		expect(seen).toEqual(["bec_name", "bec_safe", "Применить", "Отмена"]);
		expect(seen).not.toContain("bec_file");
	});
});
