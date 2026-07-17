import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { SerialNumbersCell } from "src/components/DocumentItemsTable/SerialNumbersCell";
import { BatchNumbersCell } from "src/components/DocumentItemsTable/BatchNumbersCell";

const getMock = vi.fn();
const postMock = vi.fn();

vi.mock("src/services/api/client", () => ({
  __esModule: true,
  default: {
    get: (...args: unknown[]) => getMock(...args),
    post: (...args: unknown[]) => postMock(...args),
  },
}));

vi.mock("src/i18", () => ({
  translate: (key: string) => key,
}));

vi.mock("src/app/context", () => ({
  useAppContext: () => ({ windows: { addPane: vi.fn() } }),
}));

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe("serial and batch UI cells", () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
  });

  it("renders serial numbers cell and opens the serial modal", async () => {
    getMock.mockImplementation(async (url: string) => {
      if (url === "products/prod-serial") {
        return { data: { item: { trackSerialNumbers: true, serialTrackingSince: "2020-01-01T00:00:00.000Z" } } };
      }
      if (url === "serialnumbers/available") {
        return { data: { items: [{ uuid: "sn-1", serialNumber: "SN-1", issueDocUuid: null }] } };
      }
      return { data: { items: [] } };
    });

    renderWithClient(
      <SerialNumbersCell
        productUuid="prod-serial"
        quantity={1}
        docType="sale"
        docUuid="doc-serial"
        mode="issue"
        organizationUuid="org-1"
        warehouseUuid="wh-1"
        documentDate="2026-07-15"
      />,
    );

    expect(await screen.findByRole("button")).toBeTruthy();

    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => expect(screen.getByText(/serialNumbers — quantity/i)).toBeTruthy());
  });

  it("renders batch cell and opens the batch modal", async () => {
    getMock.mockImplementation(async (url: string) => {
      if (url === "products/prod-batch") {
        return { data: { item: { trackBatches: true, batchTrackingSince: "2020-01-01T00:00:00.000Z" } } };
      }
      if (url === "productbatches/available") {
        return { data: { items: [{ uuid: "batch-1", batchNumber: "B-1", quantity: 2, expiryDate: "2026-08-01", receipt: null }] } };
      }
      if (url === "productbatches/batch-1") {
        return { data: { item: { uuid: "batch-1", batchNumber: "B-1", expiryDate: "2026-08-01" } } };
      }
      return { data: { items: [] } };
    });

    renderWithClient(
      <BatchNumbersCell
        productUuid="prod-batch"
        mode="issue"
        batchUuid="batch-1"
        onChange={() => undefined}
        organizationUuid="org-1"
        warehouseUuid="wh-1"
        documentDate="2026-07-15"
      />,
    );

    expect(await screen.findByRole("button")).toBeTruthy();

    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => expect(screen.getByText("batchIssueTitle")).toBeTruthy());
  });
});
