// ЧАТ ВНУТРИ 1С (СВ1, СВ2) — канал целиком: HTTP → роутер → ChatWorkflow в клиентском режиме → модель.
//
// Модель — сценарий (что ответить на каждом раунде), база сервиса — в памяти, агента и очереди нет вовсе:
// любое обращение к ним — провал теста, в этом канале вызовы выполняет форма 1С. Сценарии — те же, что в
// «Готово, когда» задачи: поиск (TOOL_CALLS → COMPLETED), создание реализации (карточка → подтверждение →
// TOOL_CALLS CREATE_SALE → COMPLETED), отчёт (файл не приходит в сервис), PDF выписки (PROCESSING → карточка →
// TOOL_CALLS IMPORT_BANK_STATEMENT).

import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import type { AddressInfo } from "node:net";
import { ChatWorkflow } from "../src/chat/workflow.ts";
import { onecChatRouter } from "../src/http/onecChatRouter.ts";
import { Audit } from "../src/audit/index.ts";
import type { LLMRequest, LLMResponse, ToolCall } from "../src/llm/provider.ts";
import type { Db } from "../src/db/pool.ts";
import type { Logger } from "../src/logger.ts";

const TOKEN = "bpb_test-token";
const BASE_ID = "bbbbbbbb-0000-4000-8000-000000000001";
const ORG = "a1410911-7421-45da-9632-7e4fc48e91c2";
const USER_ID = "0f6c1c1e-6a57-4c6e-9b2a-1d4f2c9e7a01";
const OTHER_USER = "0f6c1c1e-6a57-4c6e-9b2a-1d4f2c9e7a02";
const CUSTOMER = "c0000000-0000-4000-8000-000000000001";
const PRODUCT = "d0000000-0000-4000-8000-000000000001";
const SALE = "e0000000-0000-4000-8000-000000000001";
const ORG_BIN = "831111302342";

const silent = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as unknown as Logger;

/** База сервиса в памяти: ровно те запросы, что делают workflow и аудит. */
function memDb() {
	type Conv = { id: string; organization_uuid: string; user_uuid: string; state: string; context: unknown; channel: string; base_id: string | null; created_at: Date; updated_at: Date };
	const convs = new Map<string, Conv>();
	const msgs: { id: number; conversation_id: string; role: string; content: unknown; created_at: Date }[] = [];
	const audit: { event: string; details: Record<string, unknown> }[] = [];
	const statements = new Map<string, Record<string, unknown>>();
	const query = async (sql: string, p: unknown[] = []) => {
		const none = { rows: [] as unknown[], rowCount: 0 };
		if (sql.includes("INSERT INTO conversations")) {
			const oneC = sql.includes("'1c'");
			convs.set(String(p[0]), { id: String(p[0]), organization_uuid: String(p[1]), user_uuid: String(p[2]), state: "IDLE", context: { seenIds: [] },
				channel: oneC ? "1c" : "erp", base_id: oneC ? (p[3] as string) : null, created_at: new Date(), updated_at: new Date() });
			return { rows: [], rowCount: 1 };
		}
		if (sql.includes("SELECT id, state, context FROM conversations")) {
			const c = convs.get(String(p[0]));
			return c && c.user_uuid === p[1] && c.organization_uuid === p[2] ? { rows: [{ id: c.id, state: c.state, context: structuredClone(c.context) }], rowCount: 1 } : none;
		}
		if (sql.includes("UPDATE conversations SET state = $2")) {
			const c = convs.get(String(p[0]))!;
			c.state = String(p[1]); c.context = JSON.parse(String(p[2])); c.updated_at = new Date();
			return { rows: [], rowCount: 1 };
		}
		if (sql.includes("UPDATE conversations SET state = 'FAILED'")) {
			convs.get(String(p[0]))!.state = "FAILED";
			return { rows: [], rowCount: 1 };
		}
		if (sql.includes("INSERT INTO messages")) {
			msgs.push({ id: msgs.length + 1, conversation_id: String(p[0]), role: String(p[1]), content: JSON.parse(String(p[2])), created_at: new Date() });
			return { rows: [], rowCount: 1 };
		}
		if (sql.includes("SELECT content FROM messages")) return { rows: msgs.filter((m) => m.conversation_id === p[0]).map((m) => ({ content: structuredClone(m.content) })), rowCount: 1 };
		if (sql.includes("SELECT role, content, created_at FROM messages")) return { rows: msgs.filter((m) => m.conversation_id === p[0]).map((m) => ({ role: m.role, content: structuredClone(m.content), created_at: m.created_at })), rowCount: 1 };
		if (sql.includes("FROM conversations c")) {
			const rows = [...convs.values()].filter((c) => c.user_uuid === p[0] && c.organization_uuid === p[1]).map((c) => {
				const first = msgs.find((m) => m.conversation_id === c.id && m.role === "user" && typeof (m.content as { text?: unknown }).text === "string");
				return { id: c.id, state: c.state, updated_at: c.updated_at, created_at: c.created_at, preview: first ? (first.content as { text: string }).text : null };
			});
			return { rows, rowCount: rows.length };
		}
		if (sql.includes("INSERT INTO audit_log")) {
			audit.push({ event: String(p[6]), details: JSON.parse(String(p[7])) });
			return { rows: [], rowCount: 1 };
		}
		throw new Error(`memDb: неожиданный запрос ${sql.slice(0, 80)}`);
	};
	return { db: { query } as unknown as Db, convs, msgs, audit, statements };
}

type Step = (req: LLMRequest) => Partial<LLMResponse>;

/** Модель-сценарий: шаг на каждый вызов; запросы сохраняются, чтобы проверить, что модель увидела. */
function scriptedLlm(steps: Step[]) {
	const seen: LLMRequest[] = [];
	return {
		seen,
		llm: {
			name: "script",
			chat: async (req: LLMRequest): Promise<LLMResponse> => {
				seen.push(structuredClone(req));
				const step = steps.shift();
				if (!step) throw new Error("модель вызвана сверх сценария");
				const r = step(req);
				return { text: r.text ?? "", toolCalls: r.toolCalls ?? [], stopReason: r.toolCalls?.length ? "tool_use" : "end_turn", model: "script" };
			},
		},
	};
}

const call = (id: string, name: string, input: Record<string, unknown>): ToolCall => ({ id, name, input });

/** Последние результаты инструментов, которые увидела модель. */
function lastToolResults(req: LLMRequest) {
	const m = [...req.messages].reverse().find((x) => x.role === "user" && "toolResults" in x);
	return m && "toolResults" in m ? m.toolResults : [];
}

async function harness(steps: Step[], opts: { bank?: boolean; chatPerMin?: number; revoked?: boolean; disabled?: boolean } = {}) {
	const mem = memDb();
	const { llm, seen } = scriptedLlm(steps);
	const forbidden = () => { throw new Error("канал 1С не должен обращаться к агенту"); };
	const statementStore = {
		save: async (i: Record<string, unknown>) => { const id = "5a000000-0000-4000-8000-000000000001"; mem.statements.set(id, { ...i, id, status: "extracted", importResult: null }); return { ...i, id }; },
		get: async (id: string, org: string) => { const s = mem.statements.get(id); return s && s.organizationUuid === org ? s : null; },
		markImported: async (id: string, status: string, result: unknown) => { const s = mem.statements.get(id)!; s.status = status; s.importResult = result; },
	};
	const statement = {
		bank: "БЦК", owner: { name: "ИП Азимов", bin: ORG_BIN }, account: { iik: "KZ000000000000000001", currency: "KZT" },
		period: { from: "2026-08-01", to: "2026-08-31" }, openingBalance: 0, closingBalance: 5000, totalIn: 5000, totalOut: 0,
		lines: [{ date: "2026-08-05", direction: "in", amount: 5000, counterparty: { name: "Физули", bin: "900000000001" }, knp: "710", purpose: "оплата" }],
	};
	const workflow = new ChatWorkflow({
		db: mem.db, log: silent, llm,
		agents: { pickOnline: forbidden, listByOrganization: forbidden } as never,
		queue: { enqueue: forbidden, waitResult: forbidden } as never,
		audit: new Audit(mem.db, silent), confirmWrite: true, commandTimeoutMs: 1000, maxToolRounds: 8,
		bank: opts.bank ? {
			extractor: { extract: async () => ({ statement, reconciliation: { ok: true, checks: [], problems: [], countIn: 1, countOut: 0, sumIn: 5000, sumOut: 0 }, sha256: "x", usage: { inputTokens: 1, outputTokens: 1 }, model: "script" }) } as never,
			store: statementStore as never,
		} : null,
		files: { save: forbidden } as never,
	});
	const tokens = {
		resolve: async (t: string) => t === TOKEN
			? { tokenId: "t1", baseId: BASE_ID, baseKey: "Dev_01", baseName: "Бухгалтерия (Dev_01)", organizationUuid: ORG, revoked: !!opts.revoked, baseDisabled: !!opts.disabled }
			: null,
	};
	const erp = { query: async () => ({ rows: [{ name: "ТОО Алеппо", legal_name: null }], rowCount: 1 }) } as unknown as Db;
	/*
	 * Хранилище канала: вложение приходит ТОЛЬКО загруженным заранее (§1, правка 22.09), поэтому без него
	 * ход с файлом не составить. Те же два метода, что у настоящего files-хранилища.
	 */
	const uploaded = new Map<string, { organizationUuid: string; userUuid: string; fileName: string; mimeType: string; content: Buffer }>();
	const channelFiles = {
		save: async (i: { organizationUuid: string; userUuid: string; fileName: string; mimeType: string; content: Buffer }) => {
			const fileId = randomUUID();
			uploaded.set(fileId, i);
			return { fileId, fileName: i.fileName, mimeType: i.mimeType, size: i.content.length, url: `/v1/files/${fileId}` };
		},
		getForOwner: async (id: string, org: string, owner: string) => {
			const f = uploaded.get(id);
			return f && f.organizationUuid === org && f.userUuid === owner ? { ...f, id, size: f.content.length } : null;
		},
	} as never;
	const app = express();
	app.use(express.json({ limit: "10mb" }));
	app.use("/v1/onec-chat", onecChatRouter({ workflow, tokens, erp, log: silent, version: "0.4.0", chatPerMin: opts.chatPerMin, files: channelFiles }));
	const server = app.listen(0);
	const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/onec-chat`;
	const headers = (user = USER_ID, token = TOKEN) => ({ "content-type": "application/json", "x-base-token": token, "x-1c-user-id": user });
	const turn = async (body: Record<string, unknown>, user = USER_ID) => {
		const r = await fetch(`${url}/turn`, { method: "POST", headers: headers(user), body: JSON.stringify({ user: { id: user, name: "Бухгалтер" }, organization: { bin: ORG_BIN, name: "ИП Азимов С.М.", id: "org-ref" }, ...body }) });
		return { status: r.status, headers: r.headers, body: await r.json() as { success: boolean; data?: Record<string, any>; error?: { code: string; message: string } } };
	};
	const get = async (path: string, user = USER_ID, token = TOKEN) => {
		const r = await fetch(`${url}${path}`, { headers: headers(user, token) });
		return { status: r.status, body: await r.json() as { success: boolean; data?: Record<string, any>; error?: { code: string; message: string } } };
	};
	/** Вложение — отдельным запросом: так его шлёт форма 1С с правки 22.09. */
	const upload = async (bytes: Buffer, fileName: string, user = USER_ID) => {
		const r = await fetch(`${url}/uploads?fileName=${encodeURIComponent(fileName)}`, {
			method: "POST",
			headers: { "content-type": "application/pdf", "x-base-token": TOKEN, "x-1c-user-id": user },
			body: new Uint8Array(bytes),
		});
		return { status: r.status, body: await r.json() as { success: boolean; data?: { fileId: string; bytes: number }; error?: { code: string } } };
	};
	return { mem, seen, turn, get, upload, close: () => { server.closeAllConnections(); server.close(); } };
}

// ── аутентификация ────────────────────────────────────────────────────────

test("ping: база, организация ERP, версия; отказы токена, базы и пользователя — по контракту", async () => {
	const h = await harness([]);
	try {
		const ok = await h.get("/ping");
		assert.equal(ok.status, 200);
		assert.deepEqual(ok.body.data!.base, { key: "Dev_01", name: "Бухгалтерия (Dev_01)" });
		assert.deepEqual(ok.body.data!.organization, { uuid: ORG, name: "ТОО Алеппо" });
		assert.equal(ok.body.data!.serviceVersion, "0.4.0");

		const noToken = await h.get("/ping", USER_ID, "bpb_wrong");
		assert.equal(noToken.status, 401);
		assert.equal(noToken.body.error!.code, "BASE_TOKEN_INVALID");

		const badUser = await h.get("/ping", "not-a-uuid");
		assert.equal(badUser.status, 400);
		assert.equal(badUser.body.error!.code, "VALIDATION_ERROR");
	} finally { h.close(); }

	const revoked = await harness([], { revoked: true });
	try {
		const r = await revoked.get("/ping");
		assert.equal(r.status, 401);
		assert.equal(r.body.error!.code, "BASE_TOKEN_INVALID");
		/*
		 * Отказ обязан называть ВЫПОЛНИМОЕ действие (22.09): выпустить токен в панели нечем — смена работает
		 * только с действующим, а выдача по заявке одноразовая. Единственный путь — новая заявка из 1С.
		 */
		assert.match(r.body.error!.message, /заявк/i, "текст должен вести к заявке, а не к несуществующей кнопке");
		assert.doesNotMatch(r.body.error!.message, /выпустите новый в панели/i);
	} finally { revoked.close(); }

	const disabled = await harness([], { disabled: true });
	try {
		const r = await disabled.get("/ping");
		assert.equal(r.status, 403);
		assert.equal(r.body.error!.code, "BASE_DISABLED");
	} finally { disabled.close(); }
});

// ── поиск: TOOL_CALLS → COMPLETED ─────────────────────────────────────────

test("«найди физули»: вызов уходит форме, результат возвращается модели, ход завершается", async () => {
	const h = await harness([
		() => ({ toolCalls: [call("tu_1", "search_counterparties", { q: "физули" })] }),
		(req) => {
			const [r] = lastToolResults(req);
			assert.equal(r.toolCallId, "tu_1");
			assert.deepEqual(r.content, { items: [{ id: CUSTOMER, name: "Физули ТОО", bin: "900000000001" }] });
			return { text: "Нашёл: Физули ТОО, БИН 900000000001." };
		},
	]);
	try {
		const t1 = await h.turn({ conversationId: null, text: "найди физули" });
		assert.equal(t1.status, 200, JSON.stringify(t1.body));
		const d = t1.body.data!;
		assert.equal(d.state, "TOOL_CALLS");
		// commandType и payload — ровно те, что ушли бы агенту; у чтения requestId нет.
		assert.deepEqual(d.calls, [{ callId: "tu_1", commandType: "SEARCH_COUNTERPARTIES", payload: { q: "физули", limit: 10 } }]);

		// Модель видит контекст 1С первой строкой сообщения — организация выбрана пользователем.
		const firstUser = h.seen[0].messages[0];
		assert.ok("text" in firstUser && firstUser.text.startsWith("[Контекст 1С:") && firstUser.text.includes(`БИН ${ORG_BIN}`));

		const t2 = await h.turn({ conversationId: d.conversationId, toolResults: [{ callId: "tu_1", result: { success: true, status: 200, data: { items: [{ id: CUSTOMER, name: "Физули ТОО", bin: "900000000001" }] } } }] });
		assert.equal(t2.body.data!.state, "COMPLETED");
		assert.match(t2.body.data!.text, /Физули ТОО/);

		// История для формы — без служебной строки контекста; аудит — с каналом 1c.
		const conv = await h.get(`/conversations/${d.conversationId}`);
		assert.equal(conv.body.data!.messages[0].text, "найди физули");
		assert.equal(conv.body.data!.state, "COMPLETED");
		assert.ok(h.mem.audit.length > 0 && h.mem.audit.every((a) => a.details.channel === "1c"));
		const list = await h.get("/conversations");
		assert.equal(list.body.data!.items[0].preview, "найди физули");
	} finally { h.close(); }
});

// ── создание: карточка → подтверждение → TOOL_CALLS CREATE_SALE → COMPLETED ─

test("«создай реализацию»: изменяющий вызов уходит форме только после decision.accepted, с тем же requestId", async () => {
	const h = await harness([
		() => ({ toolCalls: [call("tu_c", "search_counterparties", { q: "физули" }), call("tu_p", "search_products", { q: "облачное хранилище" })] }),
		() => ({ text: "Создаю реализацию.", toolCalls: [call("tu_s", "create_sale", { customerId: CUSTOMER, items: [{ productId: PRODUCT, quantity: 1, price: 5000 }] })] }),
		(req) => {
			const [r] = lastToolResults(req);
			assert.equal(r.toolCallId, "tu_s");
			assert.equal((r.content as { number: string }).number, "0000123");
			return { text: "Создана реализация №0000123 на 5 000 ₸." };
		},
	]);
	try {
		const t1 = await h.turn({ conversationId: null, text: "Создай реализацию Физули на облачное хранилище, 1 шт, 5000" });
		const conversationId = t1.body.data!.conversationId;
		assert.equal(t1.body.data!.state, "TOOL_CALLS");
		assert.deepEqual(t1.body.data!.calls.map((c: { commandType: string }) => c.commandType), ["SEARCH_COUNTERPARTIES", "SEARCH_PRODUCTS"]);

		// Результаты можно прислать частями: пока не все — снова TOOL_CALLS с оставшимися.
		const part = await h.turn({ conversationId, toolResults: [{ callId: "tu_c", result: { success: true, data: { items: [{ id: CUSTOMER, name: "Физули ТОО" }] } } }] });
		assert.equal(part.body.data!.state, "TOOL_CALLS");
		assert.deepEqual(part.body.data!.calls.map((c: { callId: string }) => c.callId), ["tu_p"]);

		const t2 = await h.turn({ conversationId, toolResults: [{ callId: "tu_p", result: { success: true, data: { items: [{ id: PRODUCT, name: "Облачное хранилище", isService: true }] } } }] });
		assert.equal(t2.body.data!.state, "WAITING_CONFIRMATION");
		assert.equal(t2.body.data!.confirmation.tool, "create_sale");
		assert.match(t2.body.data!.confirmation.card, /Контрагент: Физули ТОО/);
		assert.equal(t2.body.data!.calls, undefined);

		// Карточка видна и в GET — форма, открытая заново, покажет её же.
		const waiting = await h.get(`/conversations/${conversationId}`);
		assert.equal(waiting.body.data!.state, "WAITING_CONFIRMATION");

		const t3 = await h.turn({ conversationId, decision: { accepted: true } });
		assert.equal(t3.body.data!.state, "TOOL_CALLS");
		const [sale] = t3.body.data!.calls;
		assert.equal(sale.commandType, "CREATE_SALE");
		assert.match(sale.requestId, /^[0-9a-f-]{36}$/);
		assert.deepEqual(sale.payload, { customerId: CUSTOMER, comment: "Создано BuhProf AI", items: [{ productId: PRODUCT, quantity: 1, price: 5000 }] });

		// Форма закрылась посреди цикла — GET отдаёт тот же вызов с тем же requestId.
		const reopened = await h.get(`/conversations/${conversationId}`);
		assert.equal(reopened.body.data!.state, "TOOL_CALLS");
		assert.equal(reopened.body.data!.calls[0].requestId, sale.requestId);

		const t4 = await h.turn({ conversationId, toolResults: [{ callId: sale.callId, result: { success: true, status: 201, data: { id: SALE, number: "0000123", posted: false } } }] });
		assert.equal(t4.body.data!.state, "COMPLETED");
		assert.deepEqual(t4.body.data!.documents, [{ type: "sale", id: SALE, number: "0000123", title: "Реализация №0000123" }]);
		assert.ok(h.mem.audit.some((a) => a.event === "chat.confirmed"));
	} finally { h.close(); }
});

test("отказ по карточке: вызов не уходит форме, модель узнаёт об отказе", async () => {
	const h = await harness([
		() => ({ toolCalls: [call("tu_c", "search_counterparties", { q: "физули" })] }),
		() => ({ toolCalls: [call("tu_s", "post_sale", { documentId: CUSTOMER })] }),
	]);
	try {
		const t1 = await h.turn({ conversationId: null, text: "проведи" });
		const conversationId = t1.body.data!.conversationId;
		await h.turn({ conversationId, toolResults: [{ callId: "tu_c", result: { success: true, data: { items: [{ id: CUSTOMER, name: "Физули" }] } } }] });
		const t3 = await h.turn({ conversationId, decision: { accepted: false } });
		assert.equal(t3.body.data!.state, "COMPLETED");
		assert.match(t3.body.data!.text, /Отменено/);
		assert.equal(t3.body.data!.calls, undefined);
		// Второе решение — не к чему: 409.
		const again = await h.turn({ conversationId, decision: { accepted: true } });
		assert.equal(again.status, 409);
	} finally { h.close(); }
});

// ── отчёт: файл остаётся в 1С ────────────────────────────────────────────

test("«ОСВ за август»: БИН организации хода — в payload, содержимое файла в сервис не приходит", async () => {
	const h = await harness([
		() => ({ toolCalls: [call("tu_r", "run_report", { report: "osv", from: "2026-08-01", to: "2026-08-31", organizationBin: "000000000000" })] }),
		(req) => {
			const [r] = lastToolResults(req);
			assert.equal((r.content as { note: string }).note, "файл сформирован и открыт у пользователя в 1С");
			assert.equal((r.content as { size: number }).size, 48213);
			return { text: "ОСВ за август сформирована и открыта в 1С." };
		},
	]);
	try {
		const t1 = await h.turn({ conversationId: null, text: "ОСВ за август" });
		const [rep] = t1.body.data!.calls;
		assert.equal(rep.commandType, "RUN_REPORT");
		// Организация выбрана в форме — её БИН поверх выбора модели.
		assert.equal(rep.payload.organizationBin, ORG_BIN);
		const t2 = await h.turn({ conversationId: t1.body.data!.conversationId, toolResults: [{ callId: rep.callId, result: { success: true, data: { fileName: "ОСВ.pdf", format: "pdf", contentOmitted: true, bytes: 48213 } } }] });
		assert.equal(t2.body.data!.state, "COMPLETED");
	} finally { h.close(); }
});

// ── PDF выписки: PROCESSING → карточка → TOOL_CALLS IMPORT_BANK_STATEMENT ──

test("PDF выписки: фоновое распознавание, затем импорт вызовом формы с payload из хранилища", async () => {
	const h = await harness([
		(req) => {
			const m = req.messages.at(-1)!;
			const sid = "text" in m ? /statementId=([0-9a-f-]{36})/.exec(m.text)?.[1] : undefined;
			assert.ok(sid, "модель видит statementId");
			return { text: "Выписка БЦК за август, 1 операция.", toolCalls: [call("tu_i", "import_bank_statement", { statementId: sid })] };
		},
		() => ({ text: "Загружено: создан 1 документ, не проведён." }),
	], { bank: true });
	try {
		const up = await h.upload(Buffer.from("%PDF-1.4"), "выписка.pdf");
		assert.equal(up.status, 200);
		const t1 = await h.turn({ conversationId: null, text: "", attachments: [{ fileName: "выписка.pdf", mimeType: "application/pdf", fileId: up.body.data!.fileId }] });
		assert.equal(t1.body.data!.state, "PROCESSING");
		const conversationId = t1.body.data!.conversationId;

		let state = "PROCESSING";
		let polled: Record<string, any> = {};
		for (let i = 0; i < 50 && state === "PROCESSING"; i++) {
			await new Promise((r) => setTimeout(r, 20));
			polled = (await h.get(`/conversations/${conversationId}`)).body.data!;
			state = polled.state;
		}
		assert.equal(state, "WAITING_CONFIRMATION");
		assert.match(polled.confirmation.card, /Загрузка банковской выписки «выписка.pdf»/);

		const t2 = await h.turn({ conversationId, decision: { accepted: true } });
		assert.equal(t2.body.data!.state, "TOOL_CALLS");
		const [imp] = t2.body.data!.calls;
		assert.equal(imp.commandType, "IMPORT_BANK_STATEMENT");
		assert.ok(imp.requestId);
		assert.equal(imp.payload.organizationBin, ORG_BIN);
		assert.equal(imp.payload.lines.length, 1);

		const t3 = await h.turn({ conversationId, toolResults: [{ callId: imp.callId, result: { success: true, data: { created: 1, existing: 0, failed: 0, lines: [] } } }] });
		assert.equal(t3.body.data!.state, "COMPLETED");
		assert.equal(h.mem.statements.get(imp.payload.statementId)!.status, "imported");
	} finally { h.close(); }
});

// ── защита ───────────────────────────────────────────────────────────────

test("чужой и выдуманный callId — 400; чужой диалог — 404; смешанный ход — 400", async () => {
	const h = await harness([() => ({ toolCalls: [call("tu_1", "search_counterparties", { q: "физули" })] })]);
	try {
		const t1 = await h.turn({ conversationId: null, text: "найди физули" });
		const conversationId = t1.body.data!.conversationId;
		const bogus = await h.turn({ conversationId, toolResults: [{ callId: "tu_X", result: { success: true, data: {} } }] });
		assert.equal(bogus.status, 400);
		assert.equal(bogus.body.error!.code, "UNKNOWN_CALL");
		// Отказ ничего не сдвинул: вызов по-прежнему ожидается.
		assert.equal((await h.get(`/conversations/${conversationId}`)).body.data!.calls[0].callId, "tu_1");

		const foreign = await h.turn({ conversationId, toolResults: [{ callId: "tu_1", result: { success: true, data: {} } }] }, OTHER_USER);
		assert.equal(foreign.status, 404);
		assert.equal((await h.get(`/conversations/${conversationId}`, OTHER_USER)).status, 404);

		const mixed = await h.turn({ conversationId, text: "ещё", toolResults: [{ callId: "tu_1", result: { success: true, data: {} } }] });
		assert.equal(mixed.status, 400);
	} finally { h.close(); }
});

test("новое сообщение посреди TOOL_CALLS закрывает брошенные вызовы отказом", async () => {
	const h = await harness([
		() => ({ toolCalls: [call("tu_1", "search_counterparties", { q: "физули" })] }),
		(req) => {
			const cancelled = req.messages.find((m) => m.role === "user" && "toolResults" in m && m.toolResults.some((r) => r.toolCallId === "tu_1"));
			assert.ok(cancelled, "у tool_use есть результат-отказ");
			return { text: "Хорошо, что искать?" };
		},
	]);
	try {
		const t1 = await h.turn({ conversationId: null, text: "найди физули" });
		const t2 = await h.turn({ conversationId: t1.body.data!.conversationId, text: "стоп, не надо" });
		assert.equal(t2.body.data!.state, "WAITING_CLARIFICATION");
	} finally { h.close(); }
});

test("ошибка 1С из формы доходит до модели кодом и errorId", async () => {
	const h = await harness([
		() => ({ toolCalls: [call("tu_1", "search_counterparties", { q: "физули" })] }),
		(req) => {
			const [r] = lastToolResults(req);
			assert.equal(r.isError, true);
			assert.deepEqual(r.content, { error: "INTERNAL_ERROR", message: "Внутренняя ошибка", details: { errorId: "abc" } });
			return { text: "1С ответила ошибкой." };
		},
	]);
	try {
		const t1 = await h.turn({ conversationId: null, text: "найди физули" });
		const t2 = await h.turn({ conversationId: t1.body.data!.conversationId, toolResults: [{ callId: "tu_1", result: { success: false, status: 500, error: { code: "INTERNAL_ERROR", message: "Внутренняя ошибка", details: { errorId: "abc" } } } }] });
		assert.equal(t2.body.data!.state, "COMPLETED");
	} finally { h.close(); }
});

test("лимит на пару «база + пользователь 1С»: 429 с Retry-After, другой пользователь не задет", async () => {
	const h = await harness([() => ({ text: "Привет" }), () => ({ text: "Привет" })], { chatPerMin: 1 });
	try {
		assert.equal((await h.turn({ conversationId: null, text: "привет" })).status, 200);
		const limited = await h.turn({ conversationId: null, text: "привет" });
		assert.equal(limited.status, 429);
		assert.equal(limited.body.error!.code, "RATE_LIMITED");
		assert.ok(Number(limited.headers.get("retry-after")) > 0);
		assert.equal((await h.turn({ conversationId: null, text: "привет" }, OTHER_USER)).status, 200);
	} finally { h.close(); }
});

// ── ERP-чат не сломан: тот же workflow, вызовы — через очередь агента ────────

test("ERP-чат: чтение через агента, карточка, «да» — команда в очередь с requestId карточки", async () => {
	const mem = memDb();
	const { llm } = scriptedLlm([
		() => ({ toolCalls: [call("tu_c", "search_counterparties", { q: "физули" })] }),
		() => ({ toolCalls: [call("tu_s", "create_sale", { customerId: CUSTOMER, items: [{ productId: CUSTOMER, quantity: 1, price: 5000 }] })] }),
		(req) => {
			assert.equal((lastToolResults(req)[0].content as { number: string }).number, "0000124");
			return { text: "Создана реализация №0000124." };
		},
	]);
	const enqueued: { type: string; payload: Record<string, unknown>; requestId: string | null }[] = [];
	const agent = { id: "ag-1", onec: { reachable: true } };
	const workflow = new ChatWorkflow({
		db: mem.db, log: silent, llm,
		agents: { pickOnline: async () => agent, listByOrganization: async () => [agent], basesOf: async () => [] } as never,
		queue: {
			enqueue: async (i: { type: string; payload: Record<string, unknown>; requestId: string | null }) => { enqueued.push(i); return { id: `cmd-${enqueued.length}` }; },
			waitResult: async (id: string) => {
				const t = enqueued[Number(id.split("-")[1]) - 1].type;
				return { id, state: "done", result: t === "SEARCH_COUNTERPARTIES" ? { items: [{ id: CUSTOMER, name: "Физули ТОО" }] } : { id: SALE, number: "0000124" } };
			},
		} as never,
		audit: new Audit(mem.db, silent), confirmWrite: true, commandTimeoutMs: 1000, maxToolRounds: 8, bank: null, files: { save: async () => { throw new Error("нет файлов"); } } as never,
	});
	const user = { uuid: "erp-user", organizationUuid: ORG };
	const r1 = await workflow.handle(user, null, "создай реализацию физули");
	assert.equal(r1.state, "WAITING_CONFIRMATION");
	assert.equal(r1.calls, undefined);
	assert.deepEqual(enqueued.map((e) => e.type), ["SEARCH_COUNTERPARTIES"]);
	assert.equal(enqueued[0].requestId, null);
	const r2 = await workflow.handle(user, r1.conversationId, "да");
	assert.equal(r2.state, "COMPLETED");
	assert.equal(enqueued[1].type, "CREATE_SALE");
	assert.match(String(enqueued[1].requestId), /^[0-9a-f-]{36}$/);
	// ERP-сообщения — без строки контекста 1С, аудит — без пометки канала.
	const firstUser = mem.msgs.find((m) => m.role === "user")!.content as { text: string };
	assert.equal(firstUser.text, "создай реализацию физули");
	assert.ok(mem.audit.every((a) => a.details.channel === undefined));
});
