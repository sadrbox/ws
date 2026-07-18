/**
 * Регрессия: колонки «Серии»/«Партии» не появлялись в таблице строк документа.
 *
 * Причина была в SubTable: состав колонок снимался один раз ленивым useState, а проп
 * columnsJson дальше игнорировался. Колонки НДС/скидки работали лишь потому, что их
 * переключение меняет key={taxSig} и перемонтирует таблицу; серии/партии в эту
 * сигнатуру не входят, поэтому обновлённый состав до таблицы не доезжал.
 *
 * Здесь проверяется примитив слияния: новый состав применяется, но пользовательские
 * ширины/видимость и служебные колонки не теряются.
 */
import { describe, it, expect } from "vitest";
import { mergeColumnDefs } from "src/components/SubTable/rowModel";
import type { TColumn } from "src/components/Table/types";

const col = (identifier: string, extra: Partial<TColumn> = {}): TColumn =>
  ({ identifier, type: "string", visible: true, width: "100px", ...extra }) as TColumn;

describe("mergeColumnDefs", () => {
  it("добавляет появившуюся колонку «Серии»", () => {
    const prev = [col("product"), col("quantity")];
    const next = [col("product"), col("quantity"), col("serials", { width: "130px" })];

    const merged = mergeColumnDefs(prev, next);

    expect(merged.map((c) => c.identifier)).toEqual(["product", "quantity", "serials"]);
    // Новая колонка приходит с дефолтами из JSON-определения
    expect(merged.find((c) => c.identifier === "serials")?.width).toBe("130px");
  });

  it("убирает колонку, когда учёта по партиям в строках больше нет", () => {
    const prev = [col("product"), col("batch")];
    const merged = mergeColumnDefs(prev, [col("product")]);

    expect(merged.map((c) => c.identifier)).toEqual(["product"]);
  });

  it("сохраняет ширину и видимость, настроенные пользователем", () => {
    // Пользователь растянул «Товар» и скрыл «Количество»
    const prev = [col("product", { width: "420px" }), col("quantity", { visible: false })];
    const next = [col("product"), col("quantity"), col("serials")];

    const merged = mergeColumnDefs(prev, next);

    expect(merged.find((c) => c.identifier === "product")?.width).toBe("420px");
    expect(merged.find((c) => c.identifier === "quantity")?.visible).toBe(false);
  });

  it("не теряет служебные колонки — их нет в JSON-определениях", () => {
    const prev = [col("product"), col("__rowActions")];
    const merged = mergeColumnDefs(prev, [col("product"), col("serials")]);

    expect(merged.map((c) => c.identifier)).toEqual(["product", "serials", "__rowActions"]);
  });
});
