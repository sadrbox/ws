import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

// Мок API-клиента: возвращает результат, заданный per-test.
const mockGet = vi.fn();
vi.mock("src/services/api/client", () => ({
  api: {
    get: (...args: unknown[]) => mockGet(...args),
  },
}));

import useOrgAccountingSettings, { type OrgAccountingSettingItem } from "src/hooks/useOrgAccountingSettings";

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
    },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
}

const buildItem = (
  overrides: Partial<OrgAccountingSettingItem> = {},
): OrgAccountingSettingItem => ({
  id: 1,
  uuid: "u-1",
  organizationUuid: null,
  startDate: "2026-01-01",
  useVat: false,
  vatRateUuid: null,
  useDiscount: false,
  updatedAt: "2026-05-05T00:00:00Z",
  deletedAt: null,
  vatRateRef: null,
  ...overrides,
});

describe("useOrgAccountingSettings", () => {
  beforeEach(() => {
    mockGet.mockReset();
  });

  it("показывает isLoading пока данные не загрузились", () => {
    mockGet.mockImplementation(
      () => new Promise(() => { }) /* never resolves */,
    );
    const { result } = renderHook(() => useOrgAccountingSettings(), {
      wrapper: makeWrapper(),
    });
    expect(result.current.isLoading).toBe(true);
    expect(result.current.item).toBeNull();
    expect(result.current.useVat).toBe(false);
    expect(result.current.isVatEnabled).toBe(false);
    expect(result.current.vatRate).toBeNull();
    expect(result.current.vatRateUuid).toBeNull();
    expect(result.current.useDiscount).toBe(false);
    expect(result.current.vatCalculationMethod).toBe("INCLUDED");
  });

  it("isVatEnabled=true когда useVat=true и задан vatRateUuid", async () => {
    mockGet.mockResolvedValue({
      success: true,
      item: buildItem({
        useVat: true,
        vatRateUuid: "vat-12",
        vatRateRef: { uuid: "vat-12", shortName: "НДС 12%", rate: 12, calculationMethod: "INCLUDED" },
      }),
    });
    const { result } = renderHook(() => useOrgAccountingSettings(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.useVat).toBe(true);
    expect(result.current.isVatEnabled).toBe(true);
    expect(result.current.vatRateUuid).toBe("vat-12");
    expect(result.current.vatRate?.shortName).toBe("НДС 12%");
    expect(result.current.vatCalculationMethod).toBe("INCLUDED");
  });

  it("isVatEnabled=false когда useVat=false (даже если vatRateUuid задан)", async () => {
    mockGet.mockResolvedValue({
      success: true,
      item: buildItem({
        useVat: false,
        vatRateUuid: "vat-12",
        vatRateRef: { uuid: "vat-12", shortName: "НДС 12%", rate: 12, calculationMethod: "INCLUDED" },
      }),
    });
    const { result } = renderHook(() => useOrgAccountingSettings(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.useVat).toBe(false);
    expect(result.current.isVatEnabled).toBe(false);
    expect(result.current.vatRate).toBeNull();
    expect(result.current.vatRateUuid).toBeNull();
  });

  it("isVatEnabled=false когда useVat=true но vatRateUuid отсутствует", async () => {
    mockGet.mockResolvedValue({
      success: true,
      item: buildItem({ useVat: true, vatRateUuid: null }),
    });
    const { result } = renderHook(() => useOrgAccountingSettings(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.useVat).toBe(true);
    expect(result.current.isVatEnabled).toBe(false);
  });

  it("vatCalculationMethod корректно читается из vatRateRef.calculationMethod", async () => {
    mockGet.mockResolvedValue({
      success: true,
      item: buildItem({
        useVat: true,
        vatRateUuid: "vat-12",
        vatRateRef: { uuid: "vat-12", shortName: "НДС 12%", rate: 12, calculationMethod: "ADDED" },
      }),
    });
    const { result } = renderHook(() => useOrgAccountingSettings(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.vatCalculationMethod).toBe("ADDED");
  });

  it("useDiscount пробрасывается из item", async () => {
    mockGet.mockResolvedValue({
      success: true,
      item: buildItem({ useDiscount: true }),
    });
    const { result } = renderHook(() => useOrgAccountingSettings(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.useDiscount).toBe(true);
  });

  it("вызывает GET /organization-accounting-settings/active с organizationUuid", async () => {
    mockGet.mockResolvedValue({ success: true, item: null });
    renderHook(() => useOrgAccountingSettings("org-uuid-1"), { wrapper: makeWrapper() });

    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    expect(mockGet).toHaveBeenCalledWith("/organization-accounting-settings/active", {
      params: { organizationUuid: "org-uuid-1" },
    });
  });

  it("вызывает GET /organization-accounting-settings/active без params когда organizationUuid не задан", async () => {
    mockGet.mockResolvedValue({ success: true, item: null });
    renderHook(() => useOrgAccountingSettings(), { wrapper: makeWrapper() });

    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    expect(mockGet).toHaveBeenCalledWith("/organization-accounting-settings/active", {
      params: {},
    });
  });

  it("item=null когда сервер вернул null (нет настроек)", async () => {
    mockGet.mockResolvedValue({ success: true, item: null });
    const { result } = renderHook(() => useOrgAccountingSettings(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.item).toBeNull();
    expect(result.current.useVat).toBe(false);
    expect(result.current.isVatEnabled).toBe(false);
    expect(result.current.vatCalculationMethod).toBe("INCLUDED");
  });
});
