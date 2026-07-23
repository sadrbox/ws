import { describe, it, expect } from "vitest";
import {
	refFromRestore,
	formatRefToken,
	parseRefSegments,
	hasRefToken,
} from "src/utils/objectRef";

describe("objectRef — универсальные ссылки на объекты", () => {
	it("строит ссылку на форму документа из рецепта панели", () => {
		const ref = refFromRestore(
			{ kind: "form", endpoint: "sales", uuid: "u-1" },
			"Реализация № 12",
		);
		expect(ref.code).toBe("f~sales~u-1");
		expect(ref.label).toBe("Реализация № 12");
	});

	it("форматирует и разбирает токен туда-обратно", () => {
		const ref = refFromRestore({ kind: "form", endpoint: "products", uuid: "p-9" }, "Товар А");
		const token = formatRefToken(ref);
		expect(token).toBe("[[ref:f~products~p-9|Товар А]]");

		const segments = parseRefSegments(token);
		expect(segments).toHaveLength(1);
		expect(segments[0]).toEqual({ type: "ref", ref: { code: "f~products~p-9", label: "Товар А" } });
	});

	it("разбирает текст со ссылками на сегменты, сохраняя порядок", () => {
		const ref = refFromRestore({ kind: "form", endpoint: "sales", uuid: "u-1" }, "Реализация № 12");
		const text = `Смотри ${formatRefToken(ref)} — оплачено`;

		const segments = parseRefSegments(text);
		expect(segments.map((s) => s.type)).toEqual(["text", "ref", "text"]);
		expect(segments[0]).toEqual({ type: "text", text: "Смотри " });
		expect(segments[2]).toEqual({ type: "text", text: " — оплачено" });
	});

	it("поддерживает несколько ссылок в одном тексте", () => {
		const a = formatRefToken(refFromRestore({ kind: "form", endpoint: "sales", uuid: "a" }, "А"));
		const b = formatRefToken(refFromRestore({ kind: "report", key: "sales-report" }, "Отчёт"));

		const segments = parseRefSegments(`${a} и ${b}`);
		expect(segments.filter((s) => s.type === "ref")).toHaveLength(2);
	});

	it("текст без ссылок возвращается одним сегментом", () => {
		const segments = parseRefSegments("обычное сообщение");
		expect(segments).toEqual([{ type: "text", text: "обычное сообщение" }]);
		expect(hasRefToken("обычное сообщение")).toBe(false);
	});

	it("подпись очищается от символов, ломающих разбор", () => {
		const ref = refFromRestore({ kind: "form", endpoint: "sales", uuid: "u" }, "Счёт [12] | копия");
		expect(ref.label).toBe("Счёт 12 копия");
		// Токен с такой подписью по-прежнему разбирается целиком.
		expect(parseRefSegments(formatRefToken(ref))).toHaveLength(1);
	});

	it("битый токен не считается ссылкой", () => {
		expect(hasRefToken("[[ref:нет-разделителя]]")).toBe(false);
		expect(parseRefSegments("[[ref:нет-разделителя]]")[0].type).toBe("text");
	});
});
