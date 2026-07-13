import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// В read-only форме (проведённый документ, журнал событий 1С) лукап заблокирован —
// но КАРТОЧКУ связанного объекта открыть нужно: это чтение, а не правка.
// Раньше `if (disabled) return []` скрывал ВСЕ кнопки, включая «Открыть», и ссылка
// на организацию/контрагента становилась мёртвой.
//
// Проверяем сам контракт в исходнике: поведение кнопок завязано на DOM и AppContext,
// а суть здесь — что ветка disabled оставляет ровно "open" и ничего больше.
const src = fs.readFileSync(path.resolve(__dirname, "../components/Field/LookupField.tsx"), "utf8");

describe("LookupField: заблокированное поле", () => {
	it("в disabled остаётся действие «Открыть»", () => {
		const branch = src.slice(src.indexOf("if (disabled) {"), src.indexOf("if (show(\"quickselect\")"));
		expect(branch).toContain('type: "open"');
	});

	it("в disabled НЕТ мутирующих действий (выбор/список/очистка)", () => {
		const branch = src.slice(src.indexOf("if (disabled) {"), src.indexOf("if (show(\"quickselect\")"));
		for (const forbidden of ["quickselect", "list", "clear"]) {
			expect(branch, `в disabled не должно быть «${forbidden}»`).not.toContain(`type: "${forbidden}"`);
		}
	});

	it("открытие карточки не блокируется флагом disabled", () => {
		const handler = src.slice(src.indexOf("const handleOpenItemForm"), src.indexOf("const handleCreateItem"));
		expect(handler).not.toMatch(/if \(!value \|\| disabled\) return;/);
		expect(handler).toMatch(/if \(!value\) return;/);
	});
});
