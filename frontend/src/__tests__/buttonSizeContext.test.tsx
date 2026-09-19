/**
 * Кнопки в шапке панели (PaneItemHeaderToolbar) — маленькие (19.09).
 *
 * Шапку наполняют разные формы через usePaneHeaderActions («Печать», «Заметки», «Показать в списке»). Размер задаёт
 * область (ButtonSizeContext), а не каждая кнопка: иначе одна забытая оказывается крупнее соседей. Явный size —
 * главнее; вне области (в том числе ряд под шапкой, PaneItemToolbar) — прежний md.
 */
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Button } from "src/components/Button";
import { ButtonSizeContext } from "src/components/Button/sizeContext";
import styles from "src/components/Button/Button.module.scss";
import iconStyles from "src/components/IconButton/IconButton.module.scss";
import ToolbarDropdown from "src/components/Toolbar/ToolbarDropdown";

const cls = (name: string) => screen.getByRole("button", { name }).className;

describe("размер кнопок по области", () => {
	it("вне шапки — прежний md", () => {
		render(<Button>Закрыть</Button>);
		expect(cls("Закрыть")).toContain(styles.sizeMd);
	});

	it("в шапке панели — sm без проставления в каждой кнопке", () => {
		render(
			<ButtonSizeContext.Provider value="sm">
				<Button>Закрыть</Button>
				<Button variant="primary">Сохранить</Button>
			</ButtonSizeContext.Provider>,
		);
		expect(cls("Закрыть")).toContain(styles.sizeSm);
		expect(cls("Сохранить")).toContain(styles.sizeSm);
		expect(cls("Закрыть")).not.toContain(styles.sizeMd);
	});

	it("явный size у кнопки главнее области", () => {
		render(
			<ButtonSizeContext.Provider value="sm">
				<Button size="lg">Крупная</Button>
			</ButtonSizeContext.Provider>,
		);
		expect(cls("Крупная")).toContain(styles.sizeLg);
	});
});

/**
 * Дропдауны в шапке (DropdownWrap) — того же роста, что соседние кнопки: и с подписью, и иконкой
 * («Печать ▾», «Сохранить ▾»).
 */
describe("дропдауны в шапке панели", () => {
	const opts = [{ id: "a", label: "Пункт" }];

	it("дропдаун с подписью — sm в шапке", () => {
		render(
			<ButtonSizeContext.Provider value="sm">
				<ToolbarDropdown options={opts} onSelect={() => {}} triggerVariant="button" triggerLabel="Операции" />
			</ButtonSizeContext.Provider>,
		);
		expect(screen.getByRole("button", { name: /Операции/ }).className).toContain(styles.sizeSm);
	});

	it("дропдаун-иконка — sm в шапке и md вне её", () => {
		const { unmount } = render(
			<ButtonSizeContext.Provider value="sm">
				<ToolbarDropdown options={opts} onSelect={() => {}} title="Печать" trigger={<span>P</span>} />
			</ButtonSizeContext.Provider>,
		);
		expect(screen.getByRole("button", { name: "Печать" }).className).toContain(iconStyles.sm);
		unmount();
		render(<ToolbarDropdown options={opts} onSelect={() => {}} title="Печать" trigger={<span>P</span>} />);
		expect(screen.getByRole("button", { name: "Печать" }).className).toContain(iconStyles.md);
	});
});
