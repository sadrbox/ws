import { describe, it, expect } from "vitest";
import { applyEditMarker } from "src/components/SubTable";

// Чистая серверная строка документа (без _pendingAction).
function serverRow(over: Record<string, unknown> = {}) {
  return {
    id: 10,
    uuid: "srv-1",
    purchaseUuid: "doc-1",
    productUuid: "prod-1",
    product: { uuid: "prod-1", name: "Товар" }, // relation-объект — в сравнении не участвует
    quantity: "10.000", // Decimal-строки с сервера
    price: "100.00",
    vatRate: "12.00",
    amount: "1000.00", // производное поле — исключается из сравнения
    ...over,
  };
}

describe("applyEditMarker — no-op правка не оставляет строку Dirty", () => {
  it("правка значения помечает строку update", () => {
    const r = serverRow();
    const next = applyEditMarker(r as any, { quantity: "15" });
    expect(next._pendingAction).toBe("update");
    expect(next._baseline).toBeDefined();
    expect(next.quantity).toBe("15");
  });

  it("возврат значения к исходному снимает маркер (нет ложного Dirty)", () => {
    const r = serverRow();
    const edited = applyEditMarker(r as any, { quantity: "15" });
    const reverted = applyEditMarker(edited, { quantity: "10" }); // 10 == "10.000"
    expect(reverted._pendingAction).toBeUndefined();
    expect(reverted._baseline).toBeUndefined();
  });

  it("числовой формат не мешает: '100.00' исходное, ввод 100 → чисто", () => {
    const r = serverRow();
    const edited = applyEditMarker(r as any, { price: "250" });
    const reverted = applyEditMarker(edited, { price: 100 });
    expect(reverted._pendingAction).toBeUndefined();
  });

  it("производное поле (amount) расходится, но не влияет на распознавание возврата", () => {
    const r = serverRow();
    // правим количество (recalc меняет amount), затем возвращаем количество —
    // amount при этом «другой» по округлению, но не учитывается.
    const edited = applyEditMarker(r as any, { quantity: "15", amount: "1500.00" });
    const reverted = applyEditMarker(edited, { quantity: "10", amount: 1000 });
    expect(reverted._pendingAction).toBeUndefined();
  });

  it("реальное изменение остаётся update", () => {
    const r = serverRow();
    const edited = applyEditMarker(r as any, { quantity: "15" });
    expect(edited._pendingAction).toBe("update");
  });

  it("строки create всегда остаются create (не на сервере)", () => {
    const draft = { id: -1, uuid: "tmp-1", productUuid: "p", quantity: 5, _pendingAction: "create" as const };
    const next = applyEditMarker(draft as any, { quantity: 7 });
    expect(next._pendingAction).toBe("create");
    expect(next.quantity).toBe(7);
  });

  it("смена ссылки (productUuid) и возврат — снимает маркер; relation-объект игнорируется", () => {
    const r = serverRow();
    const edited = applyEditMarker(r as any, { productUuid: "prod-2", product: { name: "Другой" } });
    expect(edited._pendingAction).toBe("update");
    const reverted = applyEditMarker(edited, { productUuid: "prod-1", product: { name: "Товар" } });
    expect(reverted._pendingAction).toBeUndefined();
  });
});
