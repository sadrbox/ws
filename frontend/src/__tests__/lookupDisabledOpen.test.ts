import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// В read-only форме (проведённый документ, журнал событий 1С) лукап заблокирован —
// но КАРТОЧКУ связанного объекта открыть нужно: это чтение, а не правка.
// Раньше `if (disabled) return []` скрывал ВСЕ кнопки, включая «Открыть».
// Теперь кнопки из DOM не убираются (иначе поле «прыгает» при сохранении):
// мутации (выбор/список/очистка) получают флаг `disabled`, а «Открыть» — нет.
//
// Проверяем сам контракт в исходнике: поведение кнопок завязано на DOM и AppContext,
// а суть здесь — что «Открыть» доступно всегда, а мутации помечены disabled.
const src = fs.readFileSync(path.resolve(__dirname, "../components/Field/LookupField.tsx"), "utf8");
const acts = src.slice(src.indexOf("const fieldActions = useMemo"), src.indexOf("return acts;"));

/** Извлечь тело push для действия данного типа. */
function pushFor(type: string): string {
	const marker = `type: "${type}"`;
	const start = acts.indexOf(marker);
	if (start < 0) return "";
	return acts.slice(start, acts.indexOf("}", start));
}

describe("LookupField: заблокированное поле", () => {
	it("«Открыть» доступно всегда — без флага disabled", () => {
		const open = pushFor("open");
		expect(open, "действие open должно существовать").toContain('type: "open"');
		expect(open, "open не должен нести disabled").not.toMatch(/disabled/);
	});

	it("мутирующие действия (выбор/список/очистка) помечены disabled", () => {
		for (const t of ["quickselect", "list", "clear"]) {
			expect(pushFor(t), `«${t}» должен нести флаг disabled`).toMatch(/disabled/);
		}
	});

	it("открытие карточки не блокируется флагом disabled", () => {
		const handler = src.slice(src.indexOf("const handleOpenItemForm"), src.indexOf("const handleCreateItem"));
		expect(handler).not.toMatch(/if \(!value \|\| disabled\) return;/);
		expect(handler).not.toMatch(/if \(disabled\) return;/);
	});
});
