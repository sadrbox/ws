/**
 * Список «подпись — значение»: плотный вид (18.09).
 *
 * Карточка базы 1С показывает десяток реквизитов, которые правит кластер, а не человек. В обычном виде шаг строки
 * задаёт высота поля ввода — и реквизиты занимали всю вкладку. Плотный вид включается пропом, чтобы прежние формы
 * (где рядом настоящие поля) остались с прежним ритмом.
 */
import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { ValueList, ValueRow } from "src/components/ValueList";

const show = (dense?: boolean) => render(
	<ValueList columns={2} dense={dense} labelWidth="170px">
		<ValueRow label="Имя в кластере" value="_transition" />
		<ValueRow label="Сервер 1С" value="SERVER" />
		<ValueRow label="Конфигурация" value="" />
	</ValueList>,
);

describe("ValueList: плотный вид", () => {
	it("включается пропом и не трогает прежние списки", () => {
		expect(show(true).container.querySelector("dl")?.getAttribute("data-dense")).toBe("1");
		expect(show().container.querySelector("dl")?.getAttribute("data-dense")).toBeNull();
	});

	it("столбцы и ширина подписи остаются как были", () => {
		const dl = show(true).container.querySelector("dl")!;
		expect(dl.getAttribute("data-cols")).toBe("2");
		expect(dl.getAttribute("style")).toContain("--value-label: 170px");
	});

	it("пустое значение по-прежнему «—»: пустое место читается как «не нарисовалось»", () => {
		expect(show(true).getByText("—")).toBeTruthy();
	});
});
