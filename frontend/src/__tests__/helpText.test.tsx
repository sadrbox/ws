import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { HelpText } from "src/components/HelpBox";

// Стили — CSS-модуль, в тестах не нужен.
vi.mock("src/components/HelpBox/HelpBox.module.scss", () => ({
  default: { Ok: "ok", Add: "add", Warn: "warn" },
}));

describe("HelpText — разметка справочной прозы из словаря (U3)", () => {
  it("выделяет **жирный**, не показывая сами звёздочки", () => {
    render(<HelpText text="Нажмите **Заполнить** и ждите" />);
    const bold = screen.getByText("Заполнить");
    expect(bold.tagName).toBe("B");
    // Звёздочки не должны просочиться в текст.
    expect(document.body.textContent).toBe("Нажмите Заполнить и ждите");
  });

  it("подставляет значения по индексам {0}/{1}", () => {
    render(<HelpText text="Укажите {0} и {1}." values={["Тип цены", "Дату"]} />);
    expect(document.body.textContent).toBe("Укажите Тип цены и Дату.");
  });

  it("рендерит цветные маркеры {ok}/{add}/{warn} символами", () => {
    render(<HelpText text="{ok} обновлено, {add} создано, {warn} без товара" />);
    const text = document.body.textContent ?? "";
    expect(text).toContain("✓");
    expect(text).toContain("＋");
    expect(text).toContain("⚠");
  });

  it("текст без разметки выводится как есть", () => {
    render(<HelpText text="Обычная строка без токенов" />);
    expect(document.body.textContent).toBe("Обычная строка без токенов");
  });

  it("отсутствующее значение подстановки не ломает вывод", () => {
    // values короче, чем индексов в строке — остаток просто пустой.
    render(<HelpText text="A {0} B {1} C" values={["X"]} />);
    expect(document.body.textContent).toBe("A X B  C");
  });

  it("сохраняет порядок смешанных фрагментов", () => {
    render(<HelpText text="До **жир** {0} после" values={["ЗНАЧ"]} />);
    expect(document.body.textContent).toBe("До жир ЗНАЧ после");
  });
});
