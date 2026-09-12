/**
 * Список «подпись — значение»: показ того, что не редактируется.
 *
 * ЗАЧЕМ. В карточке базы 1С править нечего — реестр наполняют кластер и агент. Показывать
 * такие реквизиты выключенными полями ввода значит обещать правку, которой нет: по полю
 * щёлкают, ничего не происходит, и человек идёт искать, где она включается.
 *
 * СКВОЗНОЕ ВЫРАВНИВАНИЕ держится на одной переменной ширины подписи на весь список — иначе
 * колонка значений гуляет от группы к группе.
 */
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { ValueList, ValueRow } from "src/components/ValueList";

describe("Список «подпись — значение»", () => {
	it("не содержит полей ввода: править нечего", () => {
		const { container } = render(
			<ValueList>
				<ValueRow label="Имя базы" value="abdali" />
			</ValueList>,
		);
		expect(container.querySelectorAll("input,textarea,select")).toHaveLength(0);
		expect(screen.getByText("abdali")).toBeTruthy();
	});

	it("подпись и значение связаны как термин и описание", () => {
		const { container } = render(
			<ValueList>
				<ValueRow label="Сервер" value="SERVER" />
			</ValueList>,
		);
		// dl/dt/dd даёт связь «что это ↔ чему равно» без единого aria-атрибута.
		expect(container.querySelector("dl")).toBeTruthy();
		expect(container.querySelector("dt")?.textContent).toBe("Сервер");
		expect(container.querySelector("dd")?.textContent).toBe("SERVER");
	});

	it("пустое значение показано прочерком, а не пустотой", () => {
		// Пустое место читается как «поле не нарисовалось»; прочерк говорит «значения нет».
		const { container } = render(
			<ValueList>
				<ValueRow label="Имя" value="" />
				<ValueRow label="Версия" value={null} />
			</ValueList>,
		);
		expect(Array.from(container.querySelectorAll("dd")).map((d) => d.textContent)).toEqual(["—", "—"]);
	});

	it("ширина колонки подписей — одна на весь список", () => {
		const { container } = render(
			<ValueList labelWidth="200px">
				<ValueRow label="Долгая подпись длиной в несколько слов" value="1" />
				<ValueRow label="Имя" value="2" />
			</ValueList>,
		);
		// Значения стоят по одной линии, потому что ширину задаёт список, а не строка.
		expect((container.querySelector("dl") as HTMLElement).style.getPropertyValue("--value-label")).toBe("200px");
	});

	it("в два столбца строки текут слева направо, а на узком месте складываются в один", () => {
		// Семь реквизитов в один столбец занимали высоту всей вкладки, а правая половина
		// ширины пустовала. Признак раскладки — на самом списке: сжимать подпись со
		// значением до многоточия ради второй колонки нельзя, и столбцы схлопываются сами.
		const { container } = render(
			<ValueList columns={2}>
				<ValueRow label="Имя базы" value="akacapital" />
				<ValueRow label="Сервер 1С" value="SERVER" />
			</ValueList>,
		);
		expect(container.querySelector("dl")?.getAttribute("data-cols")).toBe("2");
		// Порядок разметки — он же порядок чтения.
		expect(Array.from(container.querySelectorAll("dt")).map((d) => d.textContent))
			.toEqual(["Имя базы", "Сервер 1С"]);
	});

	it("по умолчанию столбец один: признака раскладки нет", () => {
		const { container } = render(<ValueList><ValueRow label="Имя" value="a" /></ValueList>);
		expect(container.querySelector("dl")?.getAttribute("data-cols")).toBeNull();
	});
});
