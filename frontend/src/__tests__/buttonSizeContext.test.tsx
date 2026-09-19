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
