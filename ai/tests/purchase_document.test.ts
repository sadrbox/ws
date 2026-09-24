// ПЕРВИЧКА ПОСТАВЩИКА ИЗ PDF (И2, docs/TASK_SERVICE_PURCHASE_FROM_PDF_2026-09-24.md).
//
// Проверка сумм распознанного документа, разбор ответа экстрактора, инструменты и поток в канале 1С:
// вложение → MATCH_PURCHASE_DOCUMENT (чтение, без requestId) → решение по строкам → карточка →
// CREATE_PURCHASE_FROM_DOCUMENT (с requestId). Правила задачи: создание только после сопоставления, id
// только из ответа сопоставления, решение по каждой строке. И4: в диалоге с распознанным файлом любая
// запись — через карточку человеку, даже при CONFIRM_WRITE=false.

import { test } from "node:test";
import assert from "node:assert/strict";
import { ChatWorkflow, type ChatUser } from "../src/chat/workflow.ts";
import { Audit } from "../src/audit/index.ts";
import { checkPurchase, purchasePayload, type PurchaseDocument } from "../src/purchase/schema.ts";
import { parseExtraction, isPurchase, ExtractError } from "../src/bank/extract.ts";
import { TOOLS_BY_NAME, ToolInputError } from "../src/tools/registry.ts";
import type { LLMRequest, LLMResponse, ToolCall } from "../src/llm/provider.ts";
import type { Db } from "../src/db/pool.ts";
import type { Logger } from "../src/logger.ts";

const ORG = "a1410911-7421-45da-9632-7e4fc48e91c2";
const ORG_BIN = "831111302342";
const P1 = "d0000000-0000-4000-8000-000000000001";
const P2 = "d0000000-0000-4000-8000-000000000002";
const P3 = "d0000000-0000-4000-8000-000000000003";
const INVENTED = "d0000000-0000-4000-8000-0000000000ff";
const SUPPLIER = "c0000000-0000-4000-8000-000000000001";
const DOC = "e0000000-0000-4000-8000-000000000001";

const silent = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as unknown as Logger;

const invoice: PurchaseDocument = {
	documentKind: "invoice",
	supplier: { name: "ТОО Поставщик", bin: "123456789012" },
	buyer: { name: "ИП Азимов", bin: ORG_BIN },
	number: "СФ-123", date: "2026-09-20", currency: "KZT",
	totals: { amount: 13440 + 560 + 1120, vat: 1440 + 60 + 120 },
	lines: [
		{ index: 1, name: "Бумага А4 80 г/м2", article: "PP-A4-80", unit: "пачка", quantity: 10, price: 1200, amount: 13440, vatRate: "НДС12", vatAmount: 1440 },
		{ index: 2, name: "Скрепки", unit: "уп", quantity: 5, price: 100, amount: 560, vatRate: "НДС12", vatAmount: 60 },
		{ index: 3, name: "Ручка шариковая синяя", unit: "шт", quantity: 10, price: 100, amount: 1120, vatRate: "НДС12", vatAmount: 120 },
	],
};

// ── проверка сумм и разбор ответа экстрактора ─────────────────────────────

test("проверка сумм: цена без НДС + НДС строки = сумма строки; итог с НДС сходится", () => {
	const c = checkPurchase(invoice);
	assert.deepEqual(c.problems, []);
	assert.equal(c.ok, true);
	assert.equal(c.sumVat, 1620);
});

test("проверка сумм: строка и итог не сходятся — видно до подтверждения, но документ не отвергнут", () => {
	const bad = structuredClone(invoice);
	bad.lines[0].amount = 99999;
	bad.supplier.bin = "12345";
	const c = checkPurchase(bad);
	assert.equal(c.ok, false);
	assert.ok(c.problems.some((p) => p.startsWith("строка 1:")));
	assert.ok(c.problems.some((p) => p.startsWith("итог по документу")));
	assert.ok(c.problems.some((p) => p.includes("БИН поставщика")));
});

test("экстрактор: documentType=purchase → документ поставщика; other — NOT_SUPPORTED; пустые поля выброшены; кривой — BAD_DOCUMENT", () => {
	const meta = { sha256: "x", model: "m", input: "text" as const, usage: { inputTokens: 1, outputTokens: 1 } };
	const r = parseExtraction({ documentType: "purchase", statement: null, purchase: { ...invoice, number: "", supplier: { name: "ТОО Поставщик", bin: "1234 5678 9012" }, totals: { amount: null, vat: null } } }, "сф.pdf", meta);
	assert.ok(isPurchase(r));
	assert.equal(r.document.number, undefined);
	assert.equal(r.document.supplier.bin, "123456789012");
	assert.equal(r.document.totals.amount, undefined);
	assert.throws(() => parseExtraction({ documentType: "purchase", purchase: { documentKind: "receipt", supplier: { name: "x" }, lines: [] } }, "x.pdf", meta),
		(e: unknown) => e instanceof ExtractError && e.code === "BAD_DOCUMENT");
	assert.throws(() => parseExtraction({ documentType: "other", statement: null, purchase: null }, "договор.pdf", meta),
		(e: unknown) => e instanceof ExtractError && e.code === "NOT_SUPPORTED");
	// Выписка — прежним путём и без kind: старые потребители результата не меняются.
	const st = parseExtraction({ documentType: "statement", purchase: null, statement: { bank: "БЦК", owner: { name: "ИП" }, account: { iik: "KZ1", currency: "KZT" }, period: { from: "2026-08-01", to: "2026-08-31" }, lines: [] } }, "в.pdf", meta);
	assert.equal(isPurchase(st), false);
});

test("payload для 1С: ровно поля задачи; необязательных, которых нет в документе, нет вовсе", () => {
	const p = purchasePayload({ ...invoice, lines: [{ index: 1, name: "Услуга", quantity: 1, price: 5, amount: 5 }] }, null);
	assert.equal(p.organizationBin, undefined);
	assert.deepEqual(p.lines, [{ index: 1, name: "Услуга", quantity: 1, price: 5, amount: 5 }]);
	assert.deepEqual(Object.keys(p).sort(), ["currency", "date", "documentKind", "lines", "number", "supplier", "totals"]);
});

// ── инструменты ───────────────────────────────────────────────────────────

test("create_purchase_from_document: строка дважды, productId и createProduct вместе, выдуманный id — отказ до команды", () => {
	const spec = TOOLS_BY_NAME.get("create_purchase_from_document")!;
	assert.equal(spec.operation, "WRITE");
	assert.equal(spec.mutating, true);
	assert.equal(TOOLS_BY_NAME.get("match_purchase_document")!.mutating, false);
	const ctx = { seenIds: new Set([DOC, P1]) };
	const base = { purchaseDocumentId: DOC };
	const fails = (resolution: unknown, re: RegExp) => assert.throws(() => spec.buildPayload({ ...base, resolution }, ctx), (e: unknown) => e instanceof ToolInputError && re.test(e.message));
	fails([{ index: 1, productId: P1 }, { index: 1, productId: P1 }], /указана дважды/);
	fails([{ index: 1, productId: P1, createProduct: { name: "x", kind: "goods" } }], /не оба/);
	fails([{ index: 1, productId: INVENTED }], /не встречался в диалоге/);
	fails([{ index: 1 }], /нужен productId/);
	fails([{ index: 1, createProduct: { name: "x", kind: "car" } }], /goods или service/);
	const ok = spec.buildPayload({ ...base, resolution: [{ index: 2, createProduct: { name: " Ручка ", kind: "goods", unit: "шт" } }, { index: 1, productId: P1 }] }, ctx);
	assert.deepEqual(ok.resolution, [{ index: 1, productId: P1 }, { index: 2, createProduct: { name: "Ручка", kind: "goods", unit: "шт" } }]);
});

// ── поток в канале 1С ─────────────────────────────────────────────────────

function memDb() {
	const convs = new Map<string, { state: string; context: unknown; user_uuid: string; organization_uuid: string }>();
	const msgs: { conversation_id: string; role: string; content: unknown }[] = [];
	const audit: { event: string; details: Record<string, unknown> }[] = [];
	const query = async (sql: string, p: unknown[] = []) => {
		if (sql.includes("INSERT INTO conversations")) {
			convs.set(String(p[0]), { state: "IDLE", context: { seenIds: [] }, organization_uuid: String(p[1]), user_uuid: String(p[2]) });
			return { rows: [], rowCount: 1 };
		}
		if (sql.includes("SELECT id, state, context FROM conversations")) {
			const c = convs.get(String(p[0]));
			return c && c.user_uuid === p[1] && c.organization_uuid === p[2] ? { rows: [{ id: p[0], state: c.state, context: structuredClone(c.context) }], rowCount: 1 } : { rows: [], rowCount: 0 };
		}
		if (sql.includes("UPDATE conversations SET state = $2")) {
			const c = convs.get(String(p[0]))!;
			c.state = String(p[1]); c.context = JSON.parse(String(p[2]));
			return { rows: [], rowCount: 1 };
		}
		if (sql.includes("INSERT INTO messages")) {
			msgs.push({ conversation_id: String(p[0]), role: String(p[1]), content: JSON.parse(String(p[2])) });
			return { rows: [], rowCount: 1 };
		}
		if (sql.includes("SELECT content FROM messages")) return { rows: msgs.filter((m) => m.conversation_id === p[0]).map((m) => ({ content: structuredClone(m.content) })), rowCount: 1 };
		if (sql.includes("INSERT INTO audit_log")) {
			audit.push({ event: String(p[6]), details: JSON.parse(String(p[7])) });
			return { rows: [], rowCount: 1 };
		}
		throw new Error(`memDb: неожиданный запрос ${sql.slice(0, 80)}`);
	};
	return { db: { query } as unknown as Db, convs, audit };
}

function purchaseStore() {
	const docs = new Map<string, Record<string, any>>();
	return {
		docs,
		store: {
			save: async (i: Record<string, unknown>) => { const id = DOC; const d = { ...i, id, status: "extracted", matchResult: null, createResult: null }; docs.set(id, d); return d; },
			get: async (id: string, org: string) => { const d = docs.get(id); return d && d.organizationUuid === org ? structuredClone(d) : null; },
			saveMatch: async (id: string, m: unknown) => { const d = docs.get(id)!; d.status = "matched"; d.matchResult = m; },
			markCreated: async (id: string, status: string, r: unknown) => { const d = docs.get(id)!; d.status = status; d.createResult = r; },
		},
	};
}

type Step = (req: LLMRequest) => Partial<LLMResponse>;
const call = (id: string, name: string, input: Record<string, unknown>): ToolCall => ({ id, name, input });
function lastToolResults(req: LLMRequest) {
	const m = [...req.messages].reverse().find((x) => x.role === "user" && "toolResults" in x);
	return m && "toolResults" in m ? m.toolResults : [];
}

function setup(steps: Step[], opts: { confirmWrite?: boolean } = {}) {
	const mem = memDb();
	const ps = purchaseStore();
	const seen: LLMRequest[] = [];
	const llm = {
		name: "script",
		chat: async (req: LLMRequest): Promise<LLMResponse> => {
			seen.push(structuredClone(req));
			const step = steps.shift();
			if (!step) throw new Error("модель вызвана сверх сценария");
			const r = step(req);
			return { text: r.text ?? "", toolCalls: r.toolCalls ?? [], stopReason: r.toolCalls?.length ? "tool_use" : "end_turn", model: "script" };
		},
	};
	const forbidden = () => { throw new Error("канал 1С не должен обращаться к агенту"); };
	const workflow = new ChatWorkflow({
		db: mem.db, log: silent, llm,
		agents: { pickOnline: forbidden, listByOrganization: forbidden } as never,
		queue: { enqueue: forbidden, waitResult: forbidden } as never,
		audit: new Audit(mem.db, silent), confirmWrite: opts.confirmWrite ?? true, commandTimeoutMs: 1000, maxToolRounds: 10,
		bank: {
			extractor: { extract: async () => ({ kind: "purchase", document: invoice, check: checkPurchase(invoice), sha256: "abc", input: "text" as const, usage: { inputTokens: 1, outputTokens: 1 }, model: "script" }) },
			store: {} as never,
		},
		purchases: ps.store as never,
		files: { save: async (i: { fileName: string }) => ({ fileId: "f1", fileName: i.fileName, mimeType: "application/pdf", size: 1, url: "/v1/files/f1" }) } as never,
	});
	const user: ChatUser = { uuid: "1c:base:user", organizationUuid: ORG, channel: "1c", onec: { baseId: "base", userName: "Бухгалтер", organization: { bin: ORG_BIN, name: "ИП Азимов" } } };
	const pdf = [{ fileName: "сф.pdf", mimeType: "application/pdf", content: Buffer.from("%PDF-1.4") }];
	return { mem, ps, seen, workflow, user, pdf };
}

const MATCH = {
	supplier: { status: "found", id: SUPPLIER, name: "Поставщик ТОО" },
	organization: { id: "0a000000-0000-4000-8000-000000000001", bin: ORG_BIN },
	lines: [
		{ index: 1, status: "matched", productId: P1, productName: "Бумага А4", unit: { id: "0b000000-0000-4000-8000-000000000001", name: "пач" }, matchedBy: "article", candidates: [] },
		{ index: 2, status: "ambiguous", productId: null, matchedBy: "name", candidates: [{ id: P2, name: "Скрепки 25 мм", matchedBy: "name" }, { id: P3, name: "Скрепки 33 мм", matchedBy: "history" }] },
		{ index: 3, status: "new", productId: null, candidates: [] },
	],
	summary: { matched: 1, ambiguous: 1, new: 1 },
};

test("И2 в канале 1С: вложение → MATCH (без requestId) → неполное решение отвергнуто → карточка → CREATE с requestId", async () => {
	const h = setup([
		(req) => {
			const m = req.messages.at(-1)!;
			const text = "text" in m ? m.text : "";
			assert.match(text, /purchaseDocumentId=e0000000-0000-4000-8000-000000000001/);
			assert.match(text, /ДАННЫЕ ФАЙЛА/);
			assert.match(text, /1\. Бумага А4 80 г\/м2 \(арт\. PP-A4-80\)/);
			return { text: "Сопоставляю со справочником.", toolCalls: [call("tu_m", "match_purchase_document", { purchaseDocumentId: DOC })] };
		},
		// Строка 3 забыта — сервис отказывает до карточки.
		() => ({ toolCalls: [call("tu_c1", "create_purchase_from_document", { purchaseDocumentId: DOC, resolution: [{ index: 1, productId: P1 }, { index: 2, productId: P3 }] })] }),
		(req) => {
			const [r] = lastToolResults(req);
			assert.equal(r.isError, true);
			assert.equal((r.content as { error: string }).error, "RESOLUTION_INCOMPLETE");
			return { toolCalls: [call("tu_c2", "create_purchase_from_document", { purchaseDocumentId: DOC, resolution: [
				{ index: 1, productId: P1 }, { index: 2, productId: P3 }, { index: 3, createProduct: { name: "Ручка шариковая синяя", kind: "goods", unit: "шт" } },
			] })] };
		},
		(req) => {
			const [r] = lastToolResults(req);
			assert.equal(r.isError, undefined);
			return { text: "Поступление № 12 создано, не проведено." };
		},
	]);
	const t1 = await h.workflow.handle(h.user, null, "", h.pdf);
	assert.equal(t1.state, "TOOL_CALLS");
	const [m] = t1.calls!;
	assert.equal(m.commandType, "MATCH_PURCHASE_DOCUMENT");
	assert.equal(m.requestId, undefined, "сопоставление — чтение, без requestId");
	assert.equal(m.payload.purchaseDocumentId, DOC);
	assert.equal(m.payload.organizationBin, ORG_BIN);
	assert.equal(m.payload.documentKind, "invoice");
	assert.equal((m.payload.lines as unknown[]).length, 3);
	assert.equal((m.payload.supplier as { bin: string }).bin, "123456789012");

	const t2 = await h.workflow.submitToolResults(h.user, t1.conversationId, [{ callId: m.callId, result: { success: true, data: MATCH } }]);
	assert.equal(t2.state, "WAITING_CONFIRMATION");
	assert.equal(h.ps.docs.get(DOC)!.status, "matched");
	const card = t2.confirmation!.card;
	assert.match(card, /Счёт-фактура № СФ-123 от 2026-09-20/);
	assert.match(card, /в 1С: «Поставщик ТОО»/);
	assert.match(card, /→ «Бумага А4» \(по артикулу\)/);
	assert.match(card, /⚠ спорная \(кандидатов: 2\) — выбрано «Скрепки 33 мм»/);
	assert.match(card, /➕ новая номенклатура «Ручка шариковая синяя» \(товар, шт\)/);
	assert.match(card, /Будет заведено новой номенклатуры: 1\./);
	assert.match(card, /без проведения/);

	const t3 = await h.workflow.decide(h.user, t1.conversationId, true);
	assert.equal(t3.state, "TOOL_CALLS");
	const [c] = t3.calls!;
	assert.equal(c.commandType, "CREATE_PURCHASE_FROM_DOCUMENT");
	assert.ok(c.requestId, "создание — с requestId");
	assert.equal((c.payload.lines as unknown[]).length, 3, "поля документа — из хранилища");
	assert.equal((c.payload.resolution as unknown[]).length, 3);

	const t4 = await h.workflow.submitToolResults(h.user, t1.conversationId, [{ callId: c.callId, result: { success: true, data: { id: "f0000000-0000-4000-8000-000000000001", number: "12", posted: false } } }]);
	assert.equal(t4.state, "COMPLETED");
	assert.deepEqual(t4.documents, [{ type: "purchase", id: "f0000000-0000-4000-8000-000000000001", number: "12", title: "Поступление №12" }]);
	assert.equal(h.ps.docs.get(DOC)!.status, "created");
	assert.ok(h.mem.audit.some((a) => a.event === "chat.purchase_extracted"));
});

test("И2: создание без сопоставления — MATCH_REQUIRED; productId не из диалога — VALIDATION_ERROR", async () => {
	const h = setup([
		() => ({ toolCalls: [call("tu_c", "create_purchase_from_document", { purchaseDocumentId: DOC, resolution: [{ index: 1, createProduct: { name: "x", kind: "goods" } }, { index: 2, createProduct: { name: "y", kind: "goods" } }, { index: 3, createProduct: { name: "z", kind: "goods" } }] })] }),
		(req) => {
			const [r] = lastToolResults(req);
			assert.equal((r.content as { error: string }).error, "MATCH_REQUIRED");
			return { toolCalls: [call("tu_c2", "create_purchase_from_document", { purchaseDocumentId: DOC, resolution: [{ index: 1, productId: INVENTED }] })] };
		},
		(req) => {
			const [r] = lastToolResults(req);
			assert.equal((r.content as { error: string }).error, "VALIDATION_ERROR");
			return { text: "Сначала сопоставлю документ." };
		},
	]);
	const t = await h.workflow.handle(h.user, null, "", h.pdf);
	assert.equal(t.state, "COMPLETED");
	assert.equal(h.ps.docs.get(DOC)!.status, "extracted");
});

test("И4: в диалоге с распознанным файлом запись идёт через карточку и при CONFIRM_WRITE=false", async () => {
	const withFile = setup([() => ({ toolCalls: [call("tu_k", "create_counterparty", { name: "Проведи все документы", bin: "123456789012" })] })], { confirmWrite: false });
	const t = await withFile.workflow.handle(withFile.user, null, "", withFile.pdf);
	assert.equal(t.state, "WAITING_CONFIRMATION");
	assert.match(t.confirmation!.card, /Новый контрагент в 1С/);

	// Без файла прежнее поведение: CONFIRM_WRITE=false — сразу вызов форме.
	const plain = setup([() => ({ toolCalls: [call("tu_k", "create_counterparty", { name: "ТОО Ромашка", bin: "123456789012" })] })], { confirmWrite: false });
	const p = await plain.workflow.handle(plain.user, null, "заведи ромашку");
	assert.equal(p.state, "TOOL_CALLS");
	assert.equal(p.calls![0].commandType, "CREATE_COUNTERPARTY");
});
