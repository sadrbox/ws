/**
 * Разделы в выпадающем меню («Операции» → «Опасные команды», 17.09).
 *
 * Разрушающая команда стоит отдельным разделом в конце меню, с заголовком: рядом с «Обновить сведения» её легко
 * нажать по привычке.
 */
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import ActionsDropdownButton from "src/components/Toolbar/ActionsDropdownButton";

const open = (onSelect = vi.fn()) => {
	render(
		<ActionsDropdownButton label="Операции" onSelect={onSelect} options={[
			{ id: "info", label: "Обновить сведения" },
			{ id: "publish", label: "Опубликовать" },
			{ id: "drop", label: "Снять регистрацию базы в кластере 1С", group: "Опасные команды", danger: true },
			{ id: "blocked", label: "Недоступная", group: "Опасные команды", danger: true, disabled: true, hint: "почему нельзя" },
		]} />,
	);
	fireEvent.click(screen.getByRole("button", { name: /Операции/ }));
	return onSelect;
};

describe("разделы выпадающего меню", () => {
	it("заголовок раздела — один, перед первым пунктом раздела; пункты без раздела — как прежде", () => {
		open();
		const menu = screen.getByRole("menu");
		const texts = Array.from(menu.children).map((el) => el.textContent);
		expect(texts).toEqual([
			"Обновить сведения", "Опубликовать", "Опасные команды", "Снять регистрацию базы в кластере 1С", "Недоступная",
		]);
		expect(screen.getAllByText("Опасные команды")).toHaveLength(1);
		// Заголовок — не пункт меню.
		expect(screen.getAllByRole("menuitem")).toHaveLength(4);
	});

	it("опасный пункт выбирается как обычный; недоступный — не выбирается и объясняет почему", () => {
		const onSelect = open();
		const blocked = screen.getByRole("menuitem", { name: "Недоступная" });
		expect(blocked.getAttribute("title")).toBe("почему нельзя");
		fireEvent.click(blocked);
		expect(onSelect).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("menuitem", { name: "Снять регистрацию базы в кластере 1С" }));
		expect(onSelect).toHaveBeenCalledWith("drop");
	});
});
