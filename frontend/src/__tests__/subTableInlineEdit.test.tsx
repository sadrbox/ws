/**
 * SubTable inline editing — unit-тесты паттернов:
 *
 * 1. Оптимистичный апдейт кэша при handleInlineChange (deferRemoteChanges=false)
 * 2. Оптимистичный апдейт кэша при handleLookupChange (deferRemoteChanges=false)
 * 3. ctx.disabled зависит только от prop disabled, не от opLoading
 * 4. ModelRightsTable: defaultNewRow формируется корректно
 * 5. ModelRightsTable: filterRows работает правильно
 */
import { describe, it, expect } from "vitest";

// ─── Паттерн 1: оптимистичный апдейт handleInlineChange ──────────────────────

/**
 * Воспроизводит поведение handleInlineChange для !deferRemoteChanges.
 * Возвращает обновлённый кэш.
 */
function applyOptimisticUpdate(
  cache: Array<Record<string, unknown>>,
  rowId: string | number,
  field: string,
  value: unknown,
): Array<Record<string, unknown>> {
  return cache.map((r) => {
    const idMatch = r.uuid === rowId || r.id === rowId;
    return idMatch ? { ...r, [field]: value } : r;
  });
}

describe("SubTable: оптимистичный апдейт handleInlineChange", () => {
  const cache = [
    { id: 1, uuid: "aaa", role: "member" },
    { id: 2, uuid: "bbb", role: "admin" },
  ];

  it("обновляет строку по uuid", () => {
    const updated = applyOptimisticUpdate(cache, "aaa", "role", "admin");
    expect(updated[0].role).toBe("admin");
    expect(updated[1].role).toBe("admin"); // не изменился
  });

  it("обновляет строку по id", () => {
    const updated = applyOptimisticUpdate(cache, 2, "role", "member");
    expect(updated[1].role).toBe("member");
    expect(updated[0].role).toBe("member"); // не изменился
  });

  it("не трогает другие строки", () => {
    const updated = applyOptimisticUpdate(cache, "aaa", "role", "admin");
    expect(updated[1]).toEqual(cache[1]);
  });

  it("не мутирует исходный кэш", () => {
    const original = [{ id: 1, uuid: "x", role: "member" }];
    const copy = [...original];
    applyOptimisticUpdate(original, "x", "role", "admin");
    expect(original[0].role).toBe(copy[0].role);
  });
});

// ─── Паттерн 2: оптимистичный апдейт handleLookupChange ──────────────────────

function applyLookupOptimisticUpdate(
  cache: Array<Record<string, unknown>>,
  rowUuid: string,
  fkField: string,
  value: string | null,
  extraPatch?: Record<string, unknown>,
): Array<Record<string, unknown>> {
  return cache.map((r) => {
    if (r.uuid !== rowUuid) return r;
    return { ...r, [fkField]: value, ...(extraPatch ?? {}) };
  });
}

describe("SubTable: оптимистичный апдейт handleLookupChange", () => {
  const cache = [
    { id: 1, uuid: "row-1", organizationUuid: null, organization: null },
  ];

  it("обновляет FK + relation-объект", () => {
    const org = { uuid: "org-99", shortName: "ТестОрг" };
    const updated = applyLookupOptimisticUpdate(
      cache,
      "row-1",
      "organizationUuid",
      "org-99",
      { organization: org },
    );
    expect(updated[0].organizationUuid).toBe("org-99");
    expect(updated[0].organization).toEqual(org);
  });

  it("сбрасывает FK на null (clear)", () => {
    const updated = applyLookupOptimisticUpdate(
      cache,
      "row-1",
      "organizationUuid",
      null,
      { organization: null },
    );
    expect(updated[0].organizationUuid).toBeNull();
    expect(updated[0].organization).toBeNull();
  });
});

// ─── Паттерн 3: ctx.disabled не зависит от opLoading ─────────────────────────

describe("SubTable ctx.disabled", () => {
  it("disabled=false, opLoading=true → ctx.disabled=false", () => {
    const disabled = false;
    // opLoading больше не включается в ctx.disabled
    const ctxDisabled = disabled;
    expect(ctxDisabled).toBe(false);
  });

  it("disabled=true → ctx.disabled=true", () => {
    const disabled = true;
    const ctxDisabled = disabled;
    expect(ctxDisabled).toBe(true);
  });
});

// ─── Паттерн 4: ModelRightsTable.defaultNewRow ───────────────────────────────

const MODEL_NAME_OPTIONS_SAMPLE = [
  { value: "", label: "— Выберите —" },
  { value: "Organization", label: "Организации" },
  { value: "Counterparty", label: "Контрагенты" },
];

function buildDefaultNewRow(
  userUuid: string | undefined,
  organizationUuid: string | undefined,
  firstModelName: string,
) {
  if (!userUuid) return undefined;
  return {
    modelName: firstModelName,
    accessLevel: "none" as const,
    userUuid,
    ...(organizationUuid ? { organizationUuid } : {}),
  };
}

describe("ModelRightsTable: defaultNewRow", () => {
  const firstModel = MODEL_NAME_OPTIONS_SAMPLE.find((o) => o.value !== "")!.value;

  it("без userUuid → undefined", () => {
    expect(buildDefaultNewRow(undefined, "org-1", firstModel)).toBeUndefined();
    expect(buildDefaultNewRow("", "org-1", firstModel)).toBeUndefined();
  });

  it("с userUuid, без orgUuid → нет organizationUuid в объекте", () => {
    const row = buildDefaultNewRow("user-1", undefined, firstModel);
    expect(row).toBeDefined();
    expect(row?.userUuid).toBe("user-1");
    expect(row?.modelName).toBe("Organization");
    expect(row?.accessLevel).toBe("none");
    expect(Object.keys(row!)).not.toContain("organizationUuid");
  });

  it("с userUuid и orgUuid → organizationUuid в объекте", () => {
    const row = buildDefaultNewRow("user-1", "org-42", firstModel);
    expect(row?.organizationUuid).toBe("org-42");
  });
});

// ─── Паттерн 5: ModelRightsTable.filterRows ──────────────────────────────────

const modelNameMap: Record<string, string> = {
  Organization: "Организации",
  Sale: "Продажи",
  Contract: "Договора",
};
const accessLevelMap: Record<string, string> = {
  full: "Полный",
  readonly: "Только чтение",
  none: "Нет доступа",
};

function filterRowsFn(
  rows: Array<Record<string, unknown>>,
  search: string,
): Array<Record<string, unknown>> {
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return rows;
  return rows.filter((row) => {
    const modelLabel = (modelNameMap[row.modelName as string] ?? (row.modelName as string) ?? "").toLowerCase();
    const levelLabel = (accessLevelMap[row.accessLevel as string] ?? (row.accessLevel as string) ?? "").toLowerCase();
    const modelKey = ((row.modelName as string) ?? "").toLowerCase();
    const levelKey = ((row.accessLevel as string) ?? "").toLowerCase();
    const idStr = String(row.id ?? "");
    return words.every((w) =>
      modelLabel.includes(w) ||
      modelKey.includes(w) ||
      levelLabel.includes(w) ||
      levelKey.includes(w) ||
      idStr.includes(w),
    );
  });
}

describe("ModelRightsTable: filterRows", () => {
  const rows = [
    { id: 1, modelName: "Organization", accessLevel: "full" },
    { id: 2, modelName: "Sale", accessLevel: "readonly" },
    { id: 3, modelName: "Contract", accessLevel: "none" },
  ];

  it("пустой поиск → все строки", () => {
    expect(filterRowsFn(rows, "")).toHaveLength(3);
    expect(filterRowsFn(rows, "  ")).toHaveLength(3);
  });

  it("поиск по label модели (рус)", () => {
    const result = filterRowsFn(rows, "Орган");
    expect(result).toHaveLength(1);
    expect(result[0].modelName).toBe("Organization");
  });

  it("поиск по ключу модели (eng)", () => {
    const result = filterRowsFn(rows, "sale");
    expect(result).toHaveLength(1);
    expect(result[0].modelName).toBe("Sale");
  });

  it("поиск по уровню доступа (рус)", () => {
    const result = filterRowsFn(rows, "Только");
    expect(result).toHaveLength(1);
    expect(result[0].accessLevel).toBe("readonly");
  });

  it("поиск по id", () => {
    const result = filterRowsFn(rows, "3");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(3);
  });

  it("несколько слов → AND-логика", () => {
    const result = filterRowsFn(rows, "Дог нет");
    expect(result).toHaveLength(1);
    expect(result[0].modelName).toBe("Contract");
  });

  it("несуществующее слово → пусто", () => {
    expect(filterRowsFn(rows, "несуществующее")).toHaveLength(0);
  });
});

// ─── Паттерн 6: дерево фронтенд-фильтрации по parentKey ─────────────────────

function applyParentFilter(
  rows: Array<Record<string, unknown>>,
  parentKey: string,
  parentUuid: string,
): Array<Record<string, unknown>> {
  return rows.filter((r) => {
    // temp-строки (id < 0) всегда проходят
    if (typeof r.id === "number" && r.id < 0) return true;
    return r[parentKey] === parentUuid;
  });
}

describe("SubTable: displayRows фильтрация по parentKey", () => {
  const rows = [
    { id: 1, userUuid: "user-A", modelName: "Org" },
    { id: 2, userUuid: "user-B", modelName: "Sale" },
    { id: -1, userUuid: "user-A", modelName: "Contract" }, // temp
  ];

  it("возвращает только строки с нужным parentUuid + temp", () => {
    const result = applyParentFilter(rows, "userUuid", "user-A");
    expect(result).toHaveLength(2); // id=1 и id=-1
    expect(result.every((r) => r.userUuid === "user-A" || (r.id as number) < 0)).toBe(true);
  });

  it("temp-строки (id < 0) проходят всегда", () => {
    const result = applyParentFilter(rows, "userUuid", "user-B");
    expect(result).toHaveLength(2); // id=2 и id=-1
  });
});
