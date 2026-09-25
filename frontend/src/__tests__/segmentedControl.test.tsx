// Переключатель вариантов (components/SegmentedControl): все варианты видны, выбор — щелчком и стрелками,
// у варианта — число; для диктора — группа радиокнопок.
import { render, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { SegmentedControl, type SegmentOption } from "src/components/SegmentedControl";

type V = "PENDING" | "APPROVED" | "";
const options: SegmentOption<V>[] = [
	{ value: "PENDING", label: "Ждут решения", tone: "wait", count: 2 },
	{ value: "APPROVED", label: "Одобренные", tone: "ok", count: 0 },
	{ value: "", label: "Все" },
];

const Harness = ({ onChange }: { onChange?: (v: V) => void }) => {
	const [value, setValue] = useState<V>("PENDING");
	return <SegmentedControl name="t" label="Статус" value={value} options={options}
		onChange={(v) => { setValue(v); onChange?.(v); }} />;
};

describe("SegmentedControl", () => {
	it("все варианты на виду; выбранный отмечен, фокус — только на нём", () => {
		const { getAllByRole, getByRole } = render(<Harness />);
		expect(getByRole("radiogroup").getAttribute("aria-label")).toBe("Статус");
		const radios = getAllByRole("radio");
		expect(radios.map((r) => r.textContent)).toEqual(["Ждут решения2", "Одобренные", "Все"]);
		expect(radios.map((r) => r.getAttribute("aria-checked"))).toEqual(["true", "false", "false"]);
		expect(radios.map((r) => r.tabIndex)).toEqual([0, -1, -1]);
	});

	it("выбранный вариант отмечен галочкой, у остальных с цветом состояния — точка", () => {
		const { getAllByRole } = render(<Harness />);
		const [pending, approved, all] = getAllByRole("radio");
		const mark = (el: HTMLElement) => el.querySelector<HTMLElement>("[aria-hidden]")!;
		expect(mark(pending).querySelector("svg")).not.toBeNull();
		expect(mark(approved).querySelector("svg")).toBeNull();
		expect(mark(approved).childElementCount).toBe(1); // точка
		// У «Все» здесь нет цвета состояния — вместо точки нейтральное колечко: значок есть у каждой плашки.
		expect(mark(all).childElementCount).toBe(1);
		expect(mark(all).querySelector("svg")).toBeNull();
		fireEvent.click(all);
		expect(mark(all).querySelector("svg")).not.toBeNull();
		expect(mark(pending).querySelector("svg")).toBeNull();
	});

	it("размер плашки не зависит от выбора: место значка есть всегда, подпись держит ширину жирного начертания", () => {
		const { getAllByRole } = render(<Harness />);
		for (const radio of getAllByRole("radio")) {
			expect(radio.querySelectorAll(":scope > [aria-hidden]")).toHaveLength(1);
			const label = radio.querySelector<HTMLElement>("[data-label]")!;
			expect(label.dataset.label).toBe(label.textContent);
		}
		fireEvent.click(getAllByRole("radio")[1]);
		for (const radio of getAllByRole("radio")) expect(radio.querySelectorAll(":scope > [aria-hidden]")).toHaveLength(1);
	});

	it("щелчок выбирает вариант; повторный щелчок по выбранному ничего не шлёт", () => {
		const onChange = vi.fn();
		const { getAllByRole } = render(<Harness onChange={onChange} />);
		fireEvent.click(getAllByRole("radio")[2]);
		expect(onChange).toHaveBeenLastCalledWith("");
		fireEvent.click(getAllByRole("radio")[2]);
		expect(onChange).toHaveBeenCalledTimes(1);
		expect(getAllByRole("radio")[2].getAttribute("aria-checked")).toBe("true");
	});

	it("стрелки переключают по кругу, Home и End — к крайним", () => {
		const { getAllByRole, getByRole } = render(<Harness />);
		const group = getByRole("radiogroup");
		fireEvent.keyDown(group, { key: "ArrowRight" });
		expect(getAllByRole("radio")[1].getAttribute("aria-checked")).toBe("true");
		fireEvent.keyDown(group, { key: "End" });
		expect(getAllByRole("radio")[2].getAttribute("aria-checked")).toBe("true");
		fireEvent.keyDown(group, { key: "ArrowRight" });
		expect(getAllByRole("radio")[0].getAttribute("aria-checked")).toBe("true");
		fireEvent.keyDown(group, { key: "ArrowLeft" });
		expect(getAllByRole("radio")[2].getAttribute("aria-checked")).toBe("true");
		fireEvent.keyDown(group, { key: "Home" });
		expect(getAllByRole("radio")[0].getAttribute("aria-checked")).toBe("true");
		expect(document.activeElement).toBe(getAllByRole("radio")[0]);
	});

	it("недоступный переключатель не реагирует ни на щелчок, ни на стрелки", () => {
		const onChange = vi.fn();
		const { getAllByRole, getByRole } = render(
			<SegmentedControl name="d" label="Статус" value="PENDING" options={options} onChange={onChange} disabled />,
		);
		fireEvent.click(getAllByRole("radio")[1]);
		fireEvent.keyDown(getByRole("radiogroup"), { key: "ArrowRight" });
		expect(onChange).not.toHaveBeenCalled();
	});
});
