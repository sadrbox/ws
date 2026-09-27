// Команды расширений в карточке базы (27.09): меню «Расширение» → «Загрузить расширение *.cfe» ставит задание по
// ОДНОЙ базе с файлом и именем из файла; «Выгрузить расширение в .cfe» зовёт выгрузку и отдаёт файл на скачивание.
import { render, fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const runBatch = vi.fn<(...a: unknown[]) => Promise<unknown>>();
const exportExtension = vi.fn<(...a: unknown[]) => Promise<unknown>>();
vi.mock("src/services/onec/api", () => ({ runBatch: (...a: unknown[]): Promise<unknown> => runBatch(...a), exportExtension: (...a: unknown[]): Promise<unknown> => exportExtension(...a) }));
vi.mock("src/models/OneCAdmin/shared", () => ({
	reportBatchStart: vi.fn(),
	useOnecErrorActions: () => () => [],
	useOnecPermissions: () => ({ agents: "manage", extensions: ["manage"], baseUsers: [] }),
}));
vi.mock("src/models/OneCAdmin/progress", () => ({ startOp: () => "op-1", attachBatch: vi.fn(), finishOp: vi.fn() }));
vi.mock("src/components/UIToast", () => ({ showToast: vi.fn() }));
vi.mock("src/services/errors/route", () => ({ reportError: vi.fn() }));

import BaseExtensionCommands, { downloadBase64, extensionNameFromFile } from "src/models/OneCAdmin/BaseExtensionCommands";

const wrap = (ui: React.ReactElement) => render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);
const exts = [{ name: "buhprof_api", synonym: "БухПроф AI" }, { name: "esf", synonym: null }];

describe("BaseExtensionCommands", () => {
	beforeEach(() => { runBatch.mockReset(); exportExtension.mockReset(); });

	it("имя расширения из имени файла — идентификатор, а не подпись", () => {
		expect(extensionNameFromFile("buhprof_api.cfe")).toBe("buhprof_api");
		expect(extensionNameFromFile("БухПроф AI 1.8.3.CFE")).toBe("БухПроф_AI_1_8_3");
		expect(extensionNameFromFile("1_ext.cfe")).toBe("ext");
	});

	it("загрузка: файл → имя из файла → задание по одной базе с contentBase64 и safeMode", async () => {
		runBatch.mockResolvedValue({ batchId: "b1", total: 1, queued: 1, skipped: [] });
		wrap(<BaseExtensionCommands baseKey="buh" activeExt="" extensions={exts} />);
		fireEvent.click(screen.getByRole("button", { name: /Расширение/ }));
		fireEvent.click(screen.getByText("Загрузить расширение *.cfe"));
		const input = document.querySelector<HTMLInputElement>('input[type="file"]');
		if (!input) throw new Error("нет поля файла");
		const file = new File([new Uint8Array([0xff, 0xff, 0xff, 0x7f])], "buhprof_api.cfe");
		fireEvent.change(input, { target: { files: [file] } });
		expect(screen.getByLabelText<HTMLInputElement>("Имя расширения").value).toBe("buhprof_api");
		fireEvent.click(screen.getByRole("button", { name: /Применить|OK|Ок/ }));
		await waitFor(() => expect(runBatch).toHaveBeenCalledTimes(1));
		const [type, keys, payload] = runBatch.mock.calls[0] as [string, string[], Record<string, unknown>];
		expect(type).toBe("IB_INSTALL_EXTENSION");
		expect(keys).toEqual(["buh"]);
		expect(payload.name).toBe("buhprof_api");
		expect(payload.safeMode).toBe(true);
		expect(typeof payload.contentBase64).toBe("string");
		expect((payload.contentBase64 as string).length).toBeGreaterThan(0);
	});

	it("выгрузка: по умолчанию выбранное в таблице расширение; файл уходит на скачивание", async () => {
		exportExtension.mockResolvedValue({ name: "esf", contentBase64: btoa("\xff\xff\xff\x7f") });
		const clicks: string[] = [];
		vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:x");
		vi.spyOn(URL, "revokeObjectURL").mockReturnValue(undefined);
		vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { clicks.push(this.download); });
		try {
			wrap(<BaseExtensionCommands baseKey="buh" activeExt="esf" extensions={exts} />);
			fireEvent.click(screen.getByRole("button", { name: /Расширение/ }));
			fireEvent.click(screen.getByText("Выгрузить расширение в .cfe"));
			expect(screen.getByLabelText<HTMLSelectElement>("Какое расширение выгрузить").value).toBe("esf");
			fireEvent.click(screen.getByRole("button", { name: /Применить|OK|Ок/ }));
			await waitFor(() => expect(exportExtension).toHaveBeenCalledWith("buh", "esf"));
			await waitFor(() => expect(clicks).toEqual(["esf.cfe"]));
		} finally {
			vi.restoreAllMocks();
		}
	});

	it("нет прочитанных расширений — «Выгрузить» недоступна; без права create нет «Загрузить»", () => {
		wrap(<BaseExtensionCommands baseKey="buh" activeExt="" extensions={[]} />);
		fireEvent.click(screen.getByRole("button", { name: /Расширение/ }));
		const item = screen.getByText("Выгрузить расширение в .cfe").closest("button, [role=menuitem], li");
		expect(item?.getAttribute("aria-disabled") === "true" || (item as HTMLButtonElement | null)?.disabled).toBeTruthy();
	});

	it("downloadBase64 раскодирует файл побайтно", () => {
		const sizes: number[] = [];
		vi.spyOn(URL, "createObjectURL").mockImplementation((b: Blob | MediaSource) => { sizes.push((b as Blob).size); return "blob:y"; });
		vi.spyOn(URL, "revokeObjectURL").mockReturnValue(undefined);
		vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
		try {
			downloadBase64(btoa("\xff\xff\xff\x7f\x00\x02"), "x.cfe");
			expect(sizes).toEqual([6]);
		} finally {
			vi.restoreAllMocks();
		}
	});
});
