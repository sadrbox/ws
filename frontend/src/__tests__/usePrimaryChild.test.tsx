import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

const mockGet = vi.fn();
const mockPut = vi.fn();
vi.mock("src/services/api/client", () => ({
  api: {
    get: (...a: unknown[]) => mockGet(...a),
    put: (...a: unknown[]) => mockPut(...a),
  },
}));

import { usePrimaryChild } from "src/hooks/usePrimaryChild";

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
}

describe("usePrimaryChild", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPut.mockReset();
  });

  it("находит запись с isPrimary=true и возвращает её uuid + displayField", async () => {
    mockGet.mockResolvedValue({
      success: true,
      items: [
        { uuid: "a", iban: "KZ001", isPrimary: false },
        { uuid: "b", iban: "KZ002", isPrimary: true },
      ],
    });
    const { result } = renderHook(
      () =>
        usePrimaryChild({
          endpoint: "bankaccounts",
          displayField: "iban",
          scope: { ownerType: "organization", ownerUuid: "org-1" },
        }),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.primaryUuid).toBe("b");
    expect(result.current.primaryName).toBe("KZ002");
  });

  it("setPrimary шлёт PUT с isPrimary=true", async () => {
    mockGet.mockResolvedValue({ success: true, items: [] });
    mockPut.mockResolvedValue({ success: true });
    const { result } = renderHook(
      () =>
        usePrimaryChild({
          endpoint: "contracts",
          scope: { counterpartyUuid: "cp-1" },
        }),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(async () => {
      await result.current.setPrimary("ct-9");
    });
    expect(mockPut).toHaveBeenCalledWith("/contracts/ct-9", { isPrimary: true });
  });

  it("clearPrimary шлёт PUT с isPrimary=false для текущего primary", async () => {
    mockGet.mockResolvedValue({
      success: true,
      items: [{ uuid: "x", shortName: "Договор", isPrimary: true }],
    });
    mockPut.mockResolvedValue({ success: true });
    const { result } = renderHook(
      () =>
        usePrimaryChild({
          endpoint: "contracts",
          scope: { counterpartyUuid: "cp-1" },
        }),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.primaryUuid).toBe("x"));
    await act(async () => {
      await result.current.clearPrimary();
    });
    expect(mockPut).toHaveBeenCalledWith("/contracts/x", { isPrimary: false });
  });

  it("query disabled когда scope=null", () => {
    mockGet.mockResolvedValue({ success: true, items: [] });
    renderHook(
      () => usePrimaryChild({ endpoint: "bankaccounts", scope: null }),
      { wrapper: makeWrapper() },
    );
    expect(mockGet).not.toHaveBeenCalled();
  });
});
