/**
 * Метки состояния в карточке: ответ до чтения.
 *
 * С вопросом «что с ней сейчас» карточку и открывают, а в списке реквизитов ответ стоял
 * третьей строкой наравне с именем сервера. Метка отвечает раньше: её видно боковым
 * зрением. Тест держит главное — СЛОВО в метке говорит то же, что и цвет: тот, кто не
 * различает красный и зелёный, читает тот же ответ.
 */
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { StateChip, StateChips } from "src/components/StateChip";

describe("Метки состояния", () => {
	it("тон — отдельный признак, а смысл несёт текст", () => {
		render(
			<StateChips>
				<StateChip tone="ok">Доступна</StateChip>
				<StateChip tone="bad">Не опубликована</StateChip>
				<StateChip tone="unknown">Не проверялась</StateChip>
			</StateChips>,
		);
		expect(screen.getByText("Доступна").getAttribute("data-tone")).toBe("ok");
		expect(screen.getByText("Не опубликована").getAttribute("data-tone")).toBe("bad");
		expect(screen.getByText("Не проверялась").getAttribute("data-tone")).toBe("unknown");
	});

	it("нажимать нечего: это не кнопка", () => {
		// Метка сообщает состояние; сделать её похожей на кнопку — обещать действие,
		// которого нет (та же ошибка, что и выключенное поле ввода вместо значения).
		const { container } = render(<StateChips><StateChip>Доступна</StateChip></StateChips>);
		expect(container.querySelectorAll("button,a,input")).toHaveLength(0);
	});

	it("подсказка объясняет, почему состояние такое", () => {
		render(<StateChips><StateChip tone="bad" title="Базы нет в СУБД">Нет в СУБД</StateChip></StateChips>);
		expect(screen.getByText("Нет в СУБД").getAttribute("title")).toBe("Базы нет в СУБД");
	});
});
