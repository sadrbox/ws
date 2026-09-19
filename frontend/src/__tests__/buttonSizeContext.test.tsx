/**
 * Кнопки тулбара пейна — маленькие (19.09).
 *
 * Тулбар собирают разные компоненты: FormPanel («Сохранить», «Закрыть»), кнопки форм через afterClose («Операции»
 * карточки базы), тулбары списков. Размер задаёт область (ButtonSizeContext), а не каждая кнопка: иначе одна
 * забытая оказывается крупнее соседей. Явный size — главнее; вне области — прежний md.
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
	it("вне тулбара — прежний md", () => {
		render(<Button>Закрыть</Button>);
		expect(cls("Закрыть")).toContain(styles.sizeMd);
	});

	it("в тулбаре пейна — sm без проставления в каждой кнопке", () => {
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
 * Дропдауны тулбара (DropdownWrap) — того же роста, что соседние кнопки: и с подписью («Операции»), и иконкой
 * («Печать ▾», «Сохранить ▾»).
 */
describe("дропдауны в тулбаре пейна", () => {
	const opts = [{ id: "a", label: "Пункт" }];

	it("дропдаун с подписью — sm в тулбаре", () => {
		render(
			<ButtonSizeContext.Provider value="sm">
				<ToolbarDropdown options={opts} onSelect={() => {}} triggerVariant="button" triggerLabel="Операции" />
			</ButtonSizeContext.Provider>,
		);
		expect(screen.getByRole("button", { name: /Операции/ }).className).toContain(styles.sizeSm);
	});

	it("дропдаун-иконка — sm в тулбаре и md вне его", () => {
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
