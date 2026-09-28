/**
 * Задача агента 28.09 (docs/TASK_SERVICE_FROM_AGENT_AUDIT_2026-09-28.md), часть панели.
 *
 * С1 — ПУТЬ ИСПОЛНЕНИЯ `via`. У команд расширений два пути с разными отказами и разными лекарствами: COM упирается во
 * вход в базу и блокировку сеансов, ibcmd — в монопольный доступ. Путь виден в «Прогрессе», в итоге операции в
 * журнале и в строке «Заданий»; незнакомое значение не показывается вовсе.
 *
 * С2 — `IB_SESSIONS_DENIED`. Вход закрыт блокировкой начала сеансов: подсказка «что делать» стоит везде, где виден
 * отказ, «Повторить» не предлагается (тот же отказ), а «Показать сеансы» заменено «Открыть карточку базы».
 *
 * С5 — «нет в этой сборке»: признак `extensionExport` словами и выбор агента базы по её серверу.
 * С3 — файл выгрузки, уже убранный сервисом из журнала, отличается от «нечего выгружать».
 */
import { describe, it, expect, beforeEach } from "vitest";
import { act, render, renderHook, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import { TestWrapper } from "./utils/TestWrapper";
import {
	SESSIONS_DENIED_CODE, codeHint, commandVia, failureText, viaText, withCodeHint,
} from "src/services/onec/commandFacts";
import { AiServiceError } from "src/services/ai/endpoint";
import { errorText } from "src/services/errors/route";
import { finishOp, getOps, mergeBatch, startOp, withOp, onecFinish } from "src/models/OneCAdmin/progress";
import { resetOps } from "src/components/TechMessages/operations";
import MessagesView from "src/components/TechMessages/MessagesView";
import { APP_SCOPE, getMessages, useScopedNotices } from "src/components/TechMessages/store";
import { itemOutcome } from "src/models/OneCAdmin/BatchesTab";
import { useOnecErrorActions } from "src/models/OneCAdmin/shared";
import { takeBaseTab } from "src/models/OneCBases/openAt";
import { featureLabels } from "src/models/OneCAdmin/agentHealth";
import { agentLacks, baseAgentOf } from "src/models/OneCAdmin/baseAgent";
import { readExportAnswer } from "src/models/OneCAdmin/extensionExport";
import type { BatchProgress, OnecAgent } from "src/services/onec/api";

const COM = "Путь: соединение с базой (COM)";
const IBCMD = "Путь: напрямую через СУБД (ibcmd)";
const HINT = "Вход в базу закрыт блокировкой начала сеансов. Снимите блокировку в карточке базы или проверьте права "
	+ "служебного администратора ИБ; если блокировку поставили в самой 1С — снимите её там";

/** Отказ агента «вход закрыт блокировкой» через COM — как его отдаёт сервис одиночной команды. */
const denied = (retryable = false) => new AiServiceError(
	"через COM: вход в базу запрещён блокировкой начала сеансов", 422, SESSIONS_DENIED_CODE, { via: "com" }, retryable,
);

describe("С1: разбор пути исполнения", () => {
	it("результат — `via`, отказ — `details.via`, объект ошибки сервиса — тоже", () => {
		expect(commandVia({ ok: true, name: "esf", via: "com" })).toBe("com");
		expect(commandVia({ ok: true, via: "ibcmd" })).toBe("ibcmd");
		expect(commandVia({ code: "IB_ERROR", message: "ibcmd …", details: { via: "ibcmd" } })).toBe("ibcmd");
		expect(commandVia(denied())).toBe("com");
	});

	it("незнакомое значение и мусор — ничего", () => {
		expect(commandVia({ via: "odbc" })).toBeNull();
		expect(commandVia({ details: { via: 5 } })).toBeNull();
		expect(commandVia({ ok: true })).toBeNull();
		expect(commandVia("com")).toBeNull();
		expect(commandVia(null)).toBeNull();
		expect(commandVia(undefined)).toBeNull();
	});

	it("подпись: один путь, оба пути (COM первым), ни одного", () => {
		expect(viaText({ via: "com" })).toBe(COM);
		expect(viaText({ via: "ibcmd" }, null)).toBe(IBCMD);
		expect(viaText({ details: { via: "ibcmd" } }, { via: "com" }, { via: "com" }))
			.toBe("Путь: соединение с базой (COM); напрямую через СУБД (ibcmd)");
		expect(viaText({ via: "?" }, undefined)).toBe("");
	});
});

describe("С1: путь в «Прогрессе» и в итоге операции", () => {
	beforeEach(() => {
		act(() => resetOps());
		getMessages().length = 0;
		localStorage.setItem("tech_messages_group", "object");
		// Завершённые операции видны с «Историей» (аудит 14.09, T6).
		localStorage.setItem("tech_messages_history", "1");
	});

	it("успех одиночной операции: путь из ответа — подробностью итога, в строке «Прогресса» и в журнале", async () => {
		await act(async () => {
			await withOp({ kind: "read", title: "Выгрузить расширение в .cfe", target: "esf — buh" },
				() => Promise.resolve({ contentBase64: "AA==", via: "ibcmd" }));
		});
		const op = getOps()[0];
		expect(op.detail).toBe(IBCMD);
		expect(getMessages().find((m) => m.opId === op.id)?.text).toContain(IBCMD);

		const Live = () => <MessagesView messages={useScopedNotices(APP_SCOPE)} />;
		render(<TestWrapper><Live /></TestWrapper>);
		expect(screen.getByText(IBCMD)).toBeTruthy();
	});

	it("отказ: путь из `details.via`, в примечании — подсказка по коду", () => {
		const id = startOp({ kind: "update", title: "Установить расширение", target: "buh", total: 1 });
		const e = denied();
		finishOp(id, { failed: 1, note: e.message, error: e });
		const op = getOps().find((o) => o.id === id)!;
		expect(op.state).toBe("failed");
		expect(op.detail).toBe(COM);
		expect(op.note).toBe(`${e.message}\n\n${HINT}`);
	});

	it("явная подробность главнее разобранной, а у ответа без пути её нет вовсе", () => {
		expect(onecFinish({ detail: "свой текст" }, { via: "com" }).detail).toBe("свой текст");
		expect(onecFinish({}, { ok: true })).toEqual({});
	});

	it("задание: путь отказа базы из строки задания, подсказка — в примечании операции", () => {
		const id = startOp({ kind: "create", title: "Установить расширение", target: "buh", total: 1, batchId: "b-via" });
		const p: BatchProgress = {
			id: "b-via", type: "IB_INSTALL_EXTENSION", total: 1, done: 0, failed: 1, pending: 0, cancelable: 0,
			createdAt: "2026-09-28T10:00:00Z",
			items: [{
				commandId: "c1", baseKey: "buh", state: "failed", outcome: null,
				error: { code: SESSIONS_DENIED_CODE, message: "через COM: вход запрещён", details: { via: "com" } },
			}],
		};
		act(() => mergeBatch(p));
		const op = getOps().find((o) => o.id === id)!;
		expect(op.state).toBe("failed");
		expect(op.detail).toBe(COM);
		expect(op.note).toContain(HINT);
		// Итог в журнале называет и путь.
		expect(getMessages().find((m) => m.opId === id)?.text).toContain(COM);
	});

	it("задание по многим базам: разные пути названы оба; путь успеха — из строки, когда сервис его отдаёт", () => {
		const id = startOp({ kind: "delete", title: "Удалить расширение", target: "базы: 2", total: 2, batchId: "b-two" });
		act(() => mergeBatch({
			id: "b-two", type: "IB_DELETE_EXTENSION", total: 2, done: 2, failed: 0, pending: 0, cancelable: 0,
			createdAt: "2026-09-28T10:00:00Z",
			items: [
				{ commandId: "c1", baseKey: "a", state: "done", outcome: null, error: null, via: "ibcmd" },
				{ commandId: "c2", baseKey: "b", state: "done", outcome: null, error: null, via: "com" },
			],
		}));
		expect(getOps().find((o) => o.id === id)?.detail).toBe("Путь: соединение с базой (COM); напрямую через СУБД (ibcmd)");
	});

	it("строка «Заданий»: путь и подсказка к отказу", () => {
		const failed = itemOutcome("IB_INSTALL_EXTENSION", {
			state: "failed", outcome: null,
			error: { code: SESSIONS_DENIED_CODE, message: "через COM: вход запрещён", details: { via: "com" } },
		});
		expect(failed).toContain(`${SESSIONS_DENIED_CODE}: через COM: вход запрещён\n\n${HINT}`);
		expect(failed).toContain(COM);
		const ok = itemOutcome("IB_INSTALL_EXTENSION", { state: "done", outcome: null, error: null, via: "ibcmd" });
		expect(ok).toBe(IBCMD);
		// Пути нет — строка прежняя.
		expect(itemOutcome("IB_INSTALL_EXTENSION", { state: "done", outcome: null, error: null })).toBe("—");
	});
});

describe("С2: IB_SESSIONS_DENIED — подсказка и кнопки", () => {
	it("подсказка к коду — дословно; к другим кодам — ничего", () => {
		expect(codeHint(SESSIONS_DENIED_CODE)).toBe(HINT);
		expect(codeHint("IB_BUSY")).toBe("");
		expect(codeHint(undefined)).toBe("");
	});

	it("подсказка приписывается один раз: сервис мог уже дописать её сам", () => {
		const once = withCodeHint("отказ", SESSIONS_DENIED_CODE);
		expect(once).toBe(`отказ\n\n${HINT}`);
		expect(withCodeHint(once, SESSIONS_DENIED_CODE)).toBe(once);
		expect(failureText(denied())).toBe(`${denied().message}\n\n${HINT}`);
	});

	it("текст отказа для сообщения формы, тоста и журнала несёт подсказку", () => {
		const text = errorText(denied());
		expect(text).toContain("через COM: вход в базу запрещён");
		expect(text.split(HINT)).toHaveLength(2);
		// Отказы с другими кодами не меняются.
		expect(errorText(new AiServiceError("Команда не выполнена", 422, "COMMAND_FAILED"))).toBe("Команда не выполнена");
	});

	const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const Wrapper = ({ children }: PropsWithChildren) => (
		<QueryClientProvider client={qc}><TestWrapper>{children}</TestWrapper></QueryClientProvider>
	);
	const build = () => renderHook(() => useOnecErrorActions(), { wrapper: Wrapper }).result.current;

	it("не «Повторить» и не «Показать сеансы», а «Открыть карточку базы» — на вкладке с блокировкой", () => {
		const actions = build()(denied(), { baseKey: "_transition", retry: () => {} });
		expect(actions.map((a) => a.label)).toEqual(["Открыть карточку базы"]);
		void actions[0].onClick();
		expect(takeBaseTab("_transition")).toEqual({ tab: "main" });
	});

	it("сервис старее С2 назвал отказ повторимым — повтор всё равно не предлагаем", () => {
		const e = new AiServiceError("вход запрещён", 422, SESSIONS_DENIED_CODE,
			{ lockedBy: { sessionId: "3" } }, true);
		expect(build()(e, { baseKey: "b", retry: () => {} }).map((a) => a.label)).toEqual(["Открыть карточку базы"]);
		// База неизвестна — открывать нечего.
		expect(build()(e, { retry: () => {} })).toEqual([]);
	});
});

describe("С5: «нет в этой сборке» — выгрузка расширения", () => {
	it("признак словами — в общем словаре признаков", () => {
		expect(featureLabels(["extensionExport", "organizations", "future"]))
			.toEqual(["выгрузка расширения в .cfe", "организации базы", "future"]);
	});

	const agent = (id: string, serverId: string, missingFeatures?: string[]) =>
		({ id, role: "admin", serverId, disabled: false, missingFeatures }) as unknown as OnecAgent;

	it("агент базы — админ-агент её сервера; признак смотрится у него", () => {
		const agents = [agent("a1", "s1", ["extensionExport"]), agent("a2", "s2", [])];
		const bases = [{ key: "BUH", serverId: "s1" }, { key: "zup", serverId: "s2" }];
		expect(baseAgentOf(agents, bases, "buh")?.id).toBe("a1");
		expect(agentLacks(baseAgentOf(agents, bases, "buh"), "extensionExport")).toBe(true);
		expect(agentLacks(baseAgentOf(agents, bases, "zup"), "extensionExport")).toBe(false);
	});

	it("база или агент неизвестны, сервис старее признака — не гасим: ответит сервис", () => {
		expect(baseAgentOf([agent("a1", "s1")], [], "buh")).toBeNull();
		expect(agentLacks(null, "extensionExport")).toBe(false);
		expect(agentLacks(agent("a1", "s1"), "extensionExport")).toBe(false);
	});
});

describe("С3: файл выгрузки, уже убранный из журнала", () => {
	it("файл есть — на скачивание; обёрнутый `{success, data}` — тоже", () => {
		expect(readExportAnswer({ name: "esf", contentBase64: "AA==", fileName: "esf.cfe" }))
			.toEqual({ kind: "file", base64: "AA==", fileName: "esf.cfe", name: "esf" });
		expect(readExportAnswer({ success: true, data: { name: "esf", contentBase64: "AA==" } }))
			.toEqual({ kind: "file", base64: "AA==", fileName: null, name: "esf" });
	});

	it("файла нет, а след `contentDigest` есть — «выгрузить заново», и в `data` тоже", () => {
		expect(readExportAnswer({ name: "esf", contentDigest: { size: 4, sha256: "ab" } })).toEqual({ kind: "expired" });
		expect(readExportAnswer({ success: true, data: { contentDigest: { size: 4, sha256: "ab" } } })).toEqual({ kind: "expired" });
	});

	it("ни файла, ни следа — прежнее «нечего выгружать»", () => {
		expect(readExportAnswer({ name: "esf" })).toEqual({ kind: "empty" });
		expect(readExportAnswer(null)).toEqual({ kind: "empty" });
	});
});
