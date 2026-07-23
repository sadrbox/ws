import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { useTodoStatuses } from "src/hooks/useTodoStatuses";

const getMock = vi.fn();
vi.mock("src/services/api/client", () => ({
  __esModule: true,
  apiClient: { get: (...args: unknown[]) => getMock(...args) },
  default: { get: (...args: unknown[]) => getMock(...args) },
}));

const wrapper = ({ children }: { children: ReactNode }) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
};

describe("useTodoStatuses — статусы задач из справочника (E9.5)", () => {
  beforeEach(() => getMock.mockReset());

  it("отдаёт статусы справочника: варианты выбора и коды завершающих", async () => {
    getMock.mockResolvedValue({
      data: {
        items: [
          { uuid: "1", code: "todo", name: "К выполнению", sortOrder: 10, isFinal: false },
          { uuid: "2", code: "archived", name: "В архиве", sortOrder: 20, isFinal: true },
        ],
      },
    });
    const { result } = renderHook(() => useTodoStatuses(), { wrapper });

    await waitFor(() => expect(result.current.statuses).toHaveLength(2));
    expect(result.current.options).toEqual([
      { value: "todo", label: "К выполнению" },
      { value: "archived", label: "В архиве" },
    ]);
    // По finalCodes считается просрочка — завершающие в неё не попадают.
    expect([...result.current.finalCodes]).toEqual(["archived"]);
  });

  it("пустой справочник → базовый набор, а не пустой список", async () => {
    // Иначе форма и доска остались бы вообще без статусов.
    getMock.mockResolvedValue({ data: { items: [] } });
    const { result } = renderHook(() => useTodoStatuses(), { wrapper });

    await waitFor(() => expect(result.current.statuses.length).toBeGreaterThan(0));
    const codes = result.current.statuses.map((s) => s.code);
    expect(codes).toContain("new");
    expect(codes).toContain("done");
    expect([...result.current.finalCodes].sort()).toEqual(["cancelled", "done"]);
  });

  it("ответ без тела не оставляет интерфейс без статусов", async () => {
    // Сервер ответил, но items отсутствуют — уходим в тот же фолбэк.
    getMock.mockResolvedValue({ data: undefined });
    const { result } = renderHook(() => useTodoStatuses(), { wrapper });

    await waitFor(() => expect(result.current.statuses.length).toBeGreaterThan(0));
    expect(result.current.options.length).toBeGreaterThan(0);
  });
});
