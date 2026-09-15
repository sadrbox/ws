/**
 * Поле в ячейке SubTable узнаётся по обёртке data-field: клик в любую его часть — поле, кнопка поля — нет.
 */
import { afterEach, describe, expect, it } from "vitest";
import { controlAt, fieldControl, fieldOf, isControlDisabled } from "src/components/SubTable/fieldDom";

const html = (s: string) => { document.body.innerHTML = s; };
const byId = (id: string) => document.getElementById(id);

describe("поле в ячейке — по обёртке data-field", () => {
  afterEach(() => { document.body.innerHTML = ""; });

  it("клик в любую часть поля — его элемент ввода; кнопка поля — не поле", () => {
    html('<table><tbody><tr><td><div data-field=""><div><span id="prefix">✓</span><input id="inp" /><div><button id="btn">…</button></div></div></div></td></tr></tbody></table>');
    expect(controlAt(byId("prefix"))).toBe(byId("inp"));
    expect(controlAt(byId("inp"))).toBe(byId("inp"));
    expect(fieldOf(byId("btn"))).toBeNull();
    expect(controlAt(byId("btn"))).toBeNull();
  });

  it("поле без input (FieldPeriod): элемент ввода — триггер-список; заблокированный не вход", () => {
    html('<div data-field=""><div id="trig" role="combobox" tabindex="-1" data-disabled="true"><span id="month">Май</span></div></div>');
    const trig = byId("trig") as HTMLElement;
    expect(controlAt(byId("month"))).toBe(trig);
    expect(isControlDisabled(trig)).toBe(true);
  });

  it("голый input вне Field* — по тегу; checkbox и текст ячейки — не поле", () => {
    html('<table><tbody><tr><td><input id="raw" /><input id="cb" type="checkbox" /><span id="txt">x</span><input id="off" disabled /></td></tr></tbody></table>');
    expect(controlAt(byId("raw"))).toBe(byId("raw"));
    expect(controlAt(byId("cb"))).toBeNull();
    expect(controlAt(byId("txt"))).toBeNull();
    expect(isControlDisabled(byId("raw") as HTMLElement)).toBe(false);
    expect(isControlDisabled(byId("off") as HTMLElement)).toBe(true);
    const empty = document.createElement("div");
    empty.setAttribute("data-field", "");
    expect(fieldControl(empty)).toBeNull();
  });
});
