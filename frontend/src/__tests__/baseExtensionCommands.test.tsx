// Команды расширений в карточке базы (27.09): меню «Расширение» → «Загрузить расширение *.cfe» ставит задание по
// ОДНОЙ базе с файлом и именем из файла; «Выгрузить расширение в .cfe» зовёт выгрузку и отдаёт файл на скачивание.
import { render, fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const runBatch = vi.fn<(...a: unknown[]) => Promise<unknown>>();
const exportExtension = vi.fn<(...a: unknown[]) => Promise<unknown>>();
// Агенты и реестр баз — по ним карточка узнаёт, есть ли выгрузка в сборке агента базы (С5, 28.09).
const fetchAgents = vi.fn<() => Promise<unknown>>();
const fetchBases = vi.fn<() => Promise<unknown>>();
vi.mock("src/services/onec/api", async (importOriginal) => ({
	...(await importOriginal<typeof import("src/services/onec/api")>()),
	runBatch: (...a: unknown[]): Promise<unknown> => runBatch(...a),
	exportExtension: (...a: unknown[]): Promise<unknown> => exportExtension(...a),
	fetchAgents: (): Promise<unknown> => fetchAgents(),
	fetchBases: (): Promise<unknown> => fetchBases(),
}));
vi.mock("src/models/OneCAdmin/shared", () => ({
	reportBatchStart: vi.fn(),
	useOnecErrorActions: () => () => [],
	useOnecPermissions: () => ({ agents: "manage", extensions: ["manage"], baseUsers: [] }),
}));
const finishOp = vi.fn<(...a: unknown[]) => void>();
const showToast = vi.fn<(...a: unknown[]) => void>();
vi.mock("src/models/OneCAdmin/progress", () => ({ startOp: () => "op-1", attachBatch: vi.fn(), finishOp: (...a: unknown[]) => { finishOp(...a); } }));
vi.mock("src/components/UIToast", () => ({ showToast: (...a: unknown[]) => { showToast(...a); } }));
vi.mock("src/services/errors/route", () => ({ reportError: vi.fn() }));

import BaseExtensionCommands, { downloadBase64, extensionNameFromFile } from "src/models/OneCAdmin/BaseExtensionCommands";
import { translate } from "src/i18";

const wrap = (ui: React.ReactElement) => render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);
const exts = [{ name: "buhprof_api", synonym: "БухПроф AI" }, { name: "esf", synonym: null }];

/** Кэш с агентами и реестром баз — как его уже прочитала карточка базы: запросов при монтировании нет. */
const agent = (id: string, serverId: string, missingFeatures: string[]) =>
	({ id, role: "admin", serverId, disabled: false, online: true, capabilities: [], missingFeatures });
const seeded = (agents: unknown[], bases: unknown[]) => {
	const qc = new QueryClient();
	qc.setQueryData(["onec", "agents"], { items: agents });
	qc.setQueryData(["onec", "bases"], { items: bases });
	return qc;
};
const wrapWith = (qc: QueryClient, ui: React.ReactElement) => render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);

describe("BaseExtensionCommands", () => {
	beforeEach(() => {
		runBatch.mockReset(); exportExtension.mockReset(); finishOp.mockReset(); showToast.mockReset();
		fetchAgents.mockReset().mockResolvedValue({ items: [] });
		fetchBases.mockReset().mockResolvedValue({ items: [] });
	});

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

	/*
	 * С5 (28.09): сборка агента без `IB_EXPORT_EXTENSION` — сервис говорит об этом заранее признаком `extensionExport`
	 * в `missingFeatures`. Кнопка гаснет с подсказкой, а не отказывает CAPABILITY_MISSING после нажатия.
	 */
	it("в сборке агента базы нет выгрузки — «Выгрузить» недоступна с подсказкой «обновите агента»", () => {
		wrapWith(seeded([agent("a1", "srv-1", ["extensionExport"])], [{ key: "BUH", serverId: "srv-1" }]),
			<BaseExtensionCommands baseKey="buh" activeExt="esf" extensions={exts} />);
		fireEvent.click(screen.getByRole("button", { name: /Расширение/ }));
		const item = screen.getByText("Выгрузить расширение в .cfe").closest("button") as HTMLButtonElement;
		expect(item.disabled).toBe(true);
		expect(item.title).toBe("Нет в этой сборке агента — обновите агента");
	});

	it("признака нет у агента ЭТОЙ базы (он у агента другого сервера) — «Выгрузить» доступна", () => {
		wrapWith(seeded(
			[agent("a1", "srv-1", []), agent("a2", "srv-2", ["extensionExport"])],
			[{ key: "buh", serverId: "srv-1" }, { key: "other", serverId: "srv-2" }],
		), <BaseExtensionCommands baseKey="buh" activeExt="esf" extensions={exts} />);
		fireEvent.click(screen.getByRole("button", { name: /Расширение/ }));
		const item = screen.getByText("Выгрузить расширение в .cfe").closest("button") as HTMLButtonElement;
		expect(item.disabled).toBe(false);
		expect(item.title).toBe("");
	});

	it("выгрузка: путь исполнения из ответа — в итог операции и в сообщение об успехе (С1)", async () => {
		const answer = { name: "esf", contentBase64: btoa("\xff"), via: "ibcmd" };
		exportExtension.mockResolvedValue(answer);
		vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:x");
		vi.spyOn(URL, "revokeObjectURL").mockReturnValue(undefined);
		vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
		try {
			wrap(<BaseExtensionCommands baseKey="buh" activeExt="esf" extensions={exts} />);
			fireEvent.click(screen.getByRole("button", { name: /Расширение/ }));
			fireEvent.click(screen.getByText("Выгрузить расширение в .cfe"));
			fireEvent.click(screen.getByRole("button", { name: /Применить|OK|Ок/ }));
			// Ответ уходит адаптеру «Прогресса»: путь из него он кладёт в подробность итога.
			await waitFor(() => expect(finishOp).toHaveBeenCalledWith("op-1", {}, answer));
			await waitFor(() => expect(showToast).toHaveBeenCalledWith(
				`${translate("onecExtExported")}: esf. Путь: напрямую через СУБД (ibcmd)`, "success"));
		} finally {
			vi.restoreAllMocks();
		}
	});

	/*
	 * С3 (28.09): через час сервис убирает `contentBase64` из журнала и оставляет `contentDigest`. Это не «нечего
	 * выгружать» — файл был, его уже нет: человеку говорят выгрузить заново, а на скачивание ничего не уходит.
	 */
	it("файл выгрузки уже убран из журнала — «выгрузите заново», а не «нечего выгружать»", async () => {
		exportExtension.mockResolvedValue({ name: "esf", contentDigest: { size: 4, sha256: "ab12" }, via: "com" });
		const clicks: string[] = [];
		vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { clicks.push(this.download); });
		try {
			wrap(<BaseExtensionCommands baseKey="buh" activeExt="esf" extensions={exts} />);
			fireEvent.click(screen.getByRole("button", { name: /Расширение/ }));
			fireEvent.click(screen.getByText("Выгрузить расширение в .cfe"));
			fireEvent.click(screen.getByRole("button", { name: /Применить|OK|Ок/ }));
			await waitFor(() => expect(finishOp).toHaveBeenCalledWith("op-1", expect.objectContaining({
				failed: 1, note: "Файл выгрузки уже удалён из журнала (хранится час) — выгрузите расширение заново",
			})));
			expect(clicks).toEqual([]);
			expect(showToast).not.toHaveBeenCalled();
		} finally {
			vi.restoreAllMocks();
		}
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
