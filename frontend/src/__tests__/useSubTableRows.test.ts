import { describe, it, expect, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useSubTableRows } from "src/components/SubTable/useSubTableRows";
import type { TDataItem } from "src/components/Table/types";

// ── Хелперы ────────────────────────────────────────────────────────────────
type Props = Parameters<typeof useSubTableRows>[0];

const row = (over: Record<string, unknown>): TDataItem => over as unknown as TDataItem;

const makeProps = (over: Partial<Props> = {}): Props => ({
  deferRemoteChanges: true,
  initialPendingRows: undefined,
  parentUuid: "doc-1",
  allItems: [],
  isAnythingLoading: false,
  dataUpdatedAt: 1,
  onItemsChange: undefined,
  onAllItemsChange: undefined,
  ...over,
});

// ВАЖНО: используем форму renderHook(callback, { initialProps }) — при внутренних
// перерисовках (setCacheVersion внутри эффекта) renderHook передаёт ТОТ ЖЕ объект
// props, поэтому ссылки allItems/initialPendingRows стабильны (как у react-query
// в проде). Inline-форма renderHook(() => hook(makeProps())) пересоздавала бы
// allItems каждый рендер → эффект на [allItems] зациклился бы.
const render = (over: Partial<Props> = {}) =>
  renderHook((p: Props) => useSubTableRows(p), { initialProps: makeProps(over) });

// ── Ветка A — мерж initialPendingRows ────────────────────────────────────────
describe("useSubTableRows — Ветка A (мерж initialPendingRows)", () => {
  it("инъектированный режим (parentUuid=''): применяет pending-create, оповещает родителя", () => {
    const onItemsChange = vi.fn();
    const onAllItemsChange = vi.fn();
    const initialPendingRows = [row({ id: -1, uuid: "tmp-1", name: "Новая", _pendingAction: "create" })];

    const { result } = render({ parentUuid: "", initialPendingRows, onItemsChange, onAllItemsChange });

    expect(result.current.rows.map(r => r.uuid)).toEqual(["tmp-1"]);
    expect(result.current.pendingAppliedRef.current).toBe(true);
    expect(onAllItemsChange).toHaveBeenCalled();
    expect(onItemsChange).toHaveBeenCalled();
  });

  it("ждёт серверные данные (guard): parentUuid задан, allItems пуст, идёт загрузка — мерж НЕ применяется", () => {
    const initialPendingRows = [row({ id: -1, uuid: "tmp-1", name: "X", _pendingAction: "create" })];

    const { result, rerender } = render({
      parentUuid: "doc-1", allItems: [], isAnythingLoading: true, initialPendingRows,
    });

    // Загрузка идёт — Branch A возвращается раньше применения
    expect(result.current.rows).toEqual([]);
    expect(result.current.pendingAppliedRef.current).toBe(false);

    // Сервер вернул данные — теперь мерж применяется
    act(() => {
      rerender(makeProps({
        parentUuid: "doc-1",
        allItems: [row({ id: 1, uuid: "a", name: "Серверная" })],
        isAnythingLoading: false,
        dataUpdatedAt: 2,
        initialPendingRows,
      }));
    });

    expect(result.current.pendingAppliedRef.current).toBe(true);
    expect(result.current.rows.map(r => r.uuid)).toEqual(["a", "tmp-1"]);
  });

  it("delete-маркер сохраняется: pending-delete подменяет серверную строку при мерже", () => {
    const initialPendingRows = [row({ id: 1, uuid: "a", _pendingAction: "delete" })];

    const { result } = render({
      parentUuid: "doc-1",
      allItems: [row({ id: 1, uuid: "a", name: "Удаляемая" }), row({ id: 2, uuid: "b", name: "Живая" })],
      initialPendingRows,
    });

    // Обе строки в кэше, но "a" помечена на удаление (displayRows позже её скроет)
    const a = result.current.rows.find(r => r.uuid === "a");
    expect(a?._pendingAction).toBe("delete");
    expect(result.current.rows.map(r => r.uuid)).toEqual(["a", "b"]);
  });
});

// ── Ветка B — синхронизация с серверной выборкой ─────────────────────────────
describe("useSubTableRows — Ветка B (синхронизация с сервером)", () => {
  it("без pending: чистая замена кэша серверными данными", () => {
    const { result } = render({ allItems: [row({ id: 1, uuid: "a" }), row({ id: 2, uuid: "b" })] });
    expect(result.current.rows.map(r => r.uuid)).toEqual(["a", "b"]);
  });

  it("отбрасывает остаточные temp-строки (отрицательный id / uuid 'tmp-') из серверной выборки", () => {
    const { result } = render({
      allItems: [row({ id: 1, uuid: "a" }), row({ id: -5, uuid: "tmp-x" }), row({ id: 2, uuid: "b" })],
    });
    expect(result.current.rows.map(r => r.uuid)).toEqual(["a", "b"]);
  });

  it("dirty pending-create переживает refetch (не теряется при invalidateQueries)", () => {
    const initialPendingRows = [row({ id: -1, uuid: "tmp-1", name: "Черновик", _pendingAction: "create" })];

    const { result, rerender } = render({
      parentUuid: "doc-1",
      allItems: [row({ id: 1, uuid: "a", name: "Серверная" })],
      initialPendingRows,
      dataUpdatedAt: 1,
    });

    // Branch A применился: серверная "a" + локальный черновик "tmp-1"
    expect(result.current.rows.map(r => r.uuid)).toEqual(["a", "tmp-1"]);

    // Refetch: сервер прислал ту же "a" заново (initialPendingRows ещё не очищен — коммита не было)
    act(() => {
      rerender(makeProps({
        parentUuid: "doc-1",
        allItems: [row({ id: 1, uuid: "a", name: "Серверная-обновл" })],
        initialPendingRows,
        dataUpdatedAt: 2,
      }));
    });

    // Черновик не потерян — Branch B смержил dirty-строку с обновлёнными серверными данными
    expect(result.current.rows.map(r => r.uuid)).toEqual(["a", "tmp-1"]);
    expect(result.current.rows.find(r => r.uuid === "tmp-1")?._pendingAction).toBe("create");
  });

  it("guard hasTmpRows: при tmp-строках в кэше и пустом ответе сервера кэш НЕ затирается", () => {
    const { result, rerender } = render({
      parentUuid: "doc-1",
      allItems: [row({ id: 1, uuid: "a" })],
      dataUpdatedAt: 1,
    });
    expect(result.current.cachedRowsRef.current.map(r => r.uuid)).toEqual(["a"]);

    // Имитируем закоммиченную, но ещё не подтверждённую refetch-ем tmp-строку (как делают обработчики)
    act(() => {
      result.current.cachedRowsRef.current = [
        ...result.current.cachedRowsRef.current,
        row({ id: -9, uuid: "tmp-z", _pendingAction: "create" }),
      ];
    });

    // Сервер на мгновение вернул 0 строк (query только что переинициализировалась)
    act(() => {
      rerender(makeProps({ parentUuid: "doc-1", allItems: [], dataUpdatedAt: 2 }));
    });

    // Кэш не затёрт пустым ответом — ждём настоящий refetch
    expect(result.current.cachedRowsRef.current.map(r => r.uuid)).toEqual(["a", "tmp-z"]);
  });
});
