// БИЗНЕС-АГЕНТ В ЧАТЕ ERP (СВ3 19.09; модель без владельца 28.09): база команды — по БИН организации ERP у любого
// агента BuhProf; чужая организация в вызове — отказ; сверх лимита — LICENSE_LIMIT без очереди; `baseKey` модели не виден.
//
// Выбор базы — настоящий (resolveBusinessTarget), агент и очередь — заглушки: проверяется, ЧТО ушло бы агенту.

import { test } from "node:test";
import assert from "node:assert/strict";
import { ChatWorkflow } from "../src/chat/workflow.ts";
import { Audit } from "../src/audit/index.ts";
import { ownedBasesOf, resolveBusinessTarget, type AgentBase, type AgentLimits } from "../src/agents/agentBases.ts";
import { baseKeyOf, extractOrgBases, onlyOrganization, referencedBases } from "../src/chat/orgBases.ts";
import type { LLMRequest, LLMResponse, ToolCall } from "../src/llm/provider.ts";
import type { Db } from "../src/db/pool.ts";
import type { Logger } from "../src/logger.ts";

const ORG = "a1410911-7421-45da-9632-7e4fc48e91c2";
const BIN_A = "111111111111";
const BIN_B = "222222222222";
const ORG_A = "0a000000-0000-4000-8000-00000000000a";
const ORG_B = "0b000000-0000-4000-8000-00000000000b";
const CUSTOMER = "c0000000-0000-4000-8000-000000000001";
const PRODUCT = "d0000000-0000-4000-8000-000000000001";

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


function base(key: string, pos: number, orgs: { id: string; bin: string }[], transport: "http" | "com" = "com"): AgentBase {
	return { key, pos, status: "ONLINE", transport, extVersion: "1.4.0", overLimit: null, seenAt: null,
		organizations: orgs.map((o) => ({ id: o.id, name: `Орг ${o.bin}`, bin: o.bin })) };
}

/**
 * Агент с двумя базами: «Альфа» (организация A), «Бета» (организация B). `sameBin` — организация A есть в обеих
 * базах (копия базы или база на двух серверах); `owned` — базы, которые организация назвала своей (В2, п. 2).
 */
function setup(steps: Step[], opts: { limits?: AgentLimits; erpBin?: string | null; sameBin?: boolean; owned?: string[] } = {}) {
	const mem = memDb();
	const { llm, seen } = scriptedLlm(steps);
	const agent = { id: "ag-1", name: "Сервер, бизнес", role: "business", online: true, disabled: false, onec: { reachable: true }, limits: opts.limits ?? { maxBases: null } };
	const bases = [
		base("Альфа", 0, [{ id: ORG_A, bin: BIN_A }]),
		base("Бета", 1, opts.sameBin ? [{ id: ORG_A, bin: BIN_A }, { id: ORG_B, bin: BIN_B }] : [{ id: ORG_B, bin: BIN_B }], "http"),
	];
	const enqueued: { type: string; payload: Record<string, unknown>; baseKey?: string; organizationUuid?: string | null }[] = [];
	const erpReads = { n: 0 };
	const results: Record<string, unknown> = {
		GET_ORGANIZATIONS: { items: [{ id: ORG_A, name: "ТОО Альфа", bin: BIN_A, baseKey: "Альфа" }, { id: ORG_B, name: "ТОО Бета", bin: BIN_B, baseKey: "Бета" }] },
		SEARCH_COUNTERPARTIES: { items: [{ id: CUSTOMER, name: "Физули ТОО" }] },
		SEARCH_PRODUCTS: { items: [{ id: PRODUCT, name: "Услуга", isService: true }] },
		CREATE_SALE: { id: "e0000000-0000-4000-8000-000000000001", number: "0000124" },
		CREATE_CASH_ORDER: { id: "f0000000-0000-4000-8000-000000000001", number: "0000007", direction: "in" },
	};
	const workflow = new ChatWorkflow({
		db: mem.db, log: silent, llm,
		agents: {
			// Правило выбора — настоящее (resolveBusinessTarget), как у AgentService.resolveBusiness.
			resolveBusiness: async (_org: string, bin: string | null, want: { baseKey?: string | null; preferAgentId?: string | null }) => {
				const d = resolveBusinessTarget([{ agentId: agent.id, online: true, bases, limits: agent.limits }], { bin, ...want },
					ownedBasesOf((opts.owned ?? []).map((key) => ({ key, serverId: "srv" }))));
				if (d.kind === "base") {
					return { kind: "agent", agent, baseKey: d.baseKey, alsoIn: d.alsoIn, baseStatus: d.status,
						baseOrgs: bases.find((b) => b.key === d.baseKey)?.organizations ?? null };
				}
				if (d.kind === "ambiguous") return { kind: "ambiguous", code: d.code, message: "БИН в нескольких базах", details: { bases: d.hits.map((h) => h.baseKey) } };
				return d;
			},
			explainUnresolved: async () => ({ code: "BASE_NOT_SERVED", message: "Организации нет ни в одной базе агентов BuhProf" }),
		} as never,
		queue: {
			enqueue: async (i: { type: string; payload: Record<string, unknown>; baseKey?: string; organizationUuid?: string | null }) => { enqueued.push(i); return { id: `cmd-${enqueued.length}` }; },
			waitResult: async (id: string) => {
				const t = enqueued[Number(id.split("-")[1]) - 1].type;
				return { id, state: "done", result: results[t] ?? { ok: true }, type: t };
			},
		} as never,
		audit: new Audit(mem.db, silent), confirmWrite: true, commandTimeoutMs: 1000, maxToolRounds: 8, bank: null,
		files: { save: async () => { throw new Error("нет файлов"); } } as never,
		orgBin: async () => { erpReads.n++; return opts.erpBin === undefined ? BIN_A : opts.erpBin; },
	});
	return { mem, seen, enqueued, workflow, erpReads, user: { uuid: "erp-user", organizationUuid: ORG } };
}

const errorOf = (req: LLMRequest) => lastToolResults(req)[0].content as { error: string; message: string; details?: unknown };

test("организации: база — по БИН организации ERP, в списке только своя организация, baseKey модели не виден", async () => {
	const h = setup([
		() => ({ toolCalls: [call("tu_o", "get_organizations", {})] }),
		(req) => {
			const shown = JSON.stringify(lastToolResults(req)[0].content);
			assert.ok(!shown.includes("baseKey"), shown);
			assert.ok(shown.includes(BIN_B));
			assert.ok(!shown.includes(BIN_A), "чужая организация той же базы модели не показывается");
			return { toolCalls: [call("tu_c", "search_counterparties", { q: "физули", organizationId: ORG_B }), call("tu_p", "search_products", { q: "услуга" })] };
		},
		() => ({ toolCalls: [call("tu_s", "create_sale", { customerId: CUSTOMER, organizationId: ORG_B, items: [{ productId: PRODUCT, quantity: 1, price: 5000 }] })] }),
		() => ({ text: "Создана реализация." }),
	], { erpBin: BIN_B });
	const r1 = await h.workflow.handle(h.user, null, "создай реализацию");
	assert.equal(r1.state, "WAITING_CONFIRMATION");
	// Обзор организаций — тоже в базу организации (иначе агент отдал бы организации всех своих баз), и база — в колонке
	// очереди (C1). Команда числится за организацией пользователя (В4). Адрес в 1С не уходит.
	assert.deepEqual(h.enqueued.map((e) => [e.type, e.payload.baseKey ?? null, e.baseKey ?? null, e.organizationUuid]), [
		["GET_ORGANIZATIONS", "Бета", "Бета", ORG], ["SEARCH_COUNTERPARTIES", "Бета", "Бета", ORG], ["SEARCH_PRODUCTS", "Бета", "Бета", ORG],
	]);
	assert.equal(h.enqueued[1].payload.organizationId, undefined);
	const r2 = await h.workflow.handle(h.user, r1.conversationId, "да");
	assert.equal(r2.state, "COMPLETED");
	assert.equal(h.enqueued.at(-1)!.payload.baseKey, "Бета");
});

test("чужая организация той же базы в документе — FOREIGN_ORGANIZATION, документ в очередь не встаёт", async () => {
	// Своя база «Бета» многофирменная: в ней и организация пользователя (A), и чужая (B).
	const h = setup([
		() => ({ toolCalls: [call("tu_c", "search_counterparties", { q: "физули" }), call("tu_p", "search_products", { q: "услуга" })] }),
		() => ({ toolCalls: [call("tu_s", "create_sale", { customerId: CUSTOMER, organizationId: ORG_B, items: [{ productId: PRODUCT, quantity: 1, price: 5000 }] })] }),
		(req) => {
			assert.equal(errorOf(req).error, "FOREIGN_ORGANIZATION");
			return { text: "Это не ваша организация." };
		},
	], { erpBin: BIN_A, sameBin: true, owned: ["Бета"] });
	const r1 = await h.workflow.handle(h.user, null, "создай реализацию от ТОО Бета");
	if (r1.state === "WAITING_CONFIRMATION") await h.workflow.handle(h.user, r1.conversationId, "да");
	assert.deepEqual(h.enqueued.map((e) => e.type), ["SEARCH_COUNTERPARTIES", "SEARCH_PRODUCTS"], "реализация от чужой организации не ушла");
});

test("чужой БИН, названный моделью, — FOREIGN_ORGANIZATION: базу выбирает только БИН организации ERP", async () => {
	const h = setup([
		() => ({ toolCalls: [call("tu_k", "create_cash_order", { direction: "in", amount: 5000, organizationBin: BIN_B })] }),
		(req) => {
			assert.equal(errorOf(req).error, "FOREIGN_ORGANIZATION");
			return { text: "Не ваша организация." };
		},
	], { erpBin: BIN_A });
	await h.workflow.handle(h.user, null, "прими 5000 по Бете");
	assert.equal(h.enqueued.length, 0);
});

test("maxBases=1: база организации сверх лимита — LICENSE_LIMIT без очереди", async () => {
	const h = setup([
		() => ({ toolCalls: [call("tu_c", "search_counterparties", { q: "физули" })] }),
		(req) => {
			const c = errorOf(req);
			assert.equal(c.error, "LICENSE_LIMIT");
			assert.match(c.message, /тариф: 1 база, подключено 2/);
			return { text: "Сверх лимита." };
		},
	], { limits: { maxBases: 1 }, erpBin: BIN_B });
	await h.workflow.handle(h.user, null, "найди физули");
	assert.equal(h.enqueued.length, 0);
	assert.ok(h.mem.audit.some((a) => a.event === "chat.license_limit"));
});

test("БИН в двух базах, своей нет — BASE_AMBIGUOUS без очереди; своя есть — команда уходит в неё", async () => {
	const none = setup([
		() => ({ toolCalls: [call("tu_c", "search_counterparties", { q: "физули" })] }),
		(req) => {
			assert.equal(errorOf(req).error, "BASE_AMBIGUOUS");
			return { text: "Не понять, какая база ваша." };
		},
	], { sameBin: true });
	await none.workflow.handle(none.user, null, "найди физули");
	assert.equal(none.enqueued.length, 0);

	const own = setup([
		() => ({ toolCalls: [call("tu_c", "search_counterparties", { q: "физули" })] }),
		() => ({ text: "Нашёл." }),
	], { sameBin: true, owned: ["Бета"] });
	await own.workflow.handle(own.user, null, "найди физули");
	assert.deepEqual(own.enqueued.map((e) => e.baseKey), ["Бета"]);
});

test("БИН нет ни в одной базе и нет БИН вовсе — отказ с причиной, без очереди (обзор организаций тоже)", async () => {
	const nowhere = setup([
		() => ({ toolCalls: [call("tu_c", "search_counterparties", { q: "физули" })] }),
		(req) => {
			assert.equal(errorOf(req).error, "BASE_NOT_SERVED");
			return { text: "Базы нет." };
		},
	], { erpBin: "999999999999" });
	await nowhere.workflow.handle(nowhere.user, null, "найди физули");
	assert.equal(nowhere.enqueued.length, 0);

	const noBin = setup([
		() => ({ toolCalls: [call("tu_o", "get_organizations", {})] }),
		(req) => {
			assert.equal(errorOf(req).error, "ORG_BIN_REQUIRED");
			return { text: "Укажите БИН." };
		},
	], { erpBin: null });
	await noBin.workflow.handle(noBin.user, null, "какие организации");
	assert.equal(noBin.enqueued.length, 0);
});

test("extractOrgBases/baseKeyOf: массив и items, явный baseKey главнее запомненного", () => {
	const arr = extractOrgBases([{ id: "o1", bin: BIN_A, baseKey: "Альфа" }, { id: "o2", name: "без базы" }]);
	assert.deepEqual(arr.visible, [{ id: "o1", bin: BIN_A }, { id: "o2", name: "без базы" }]);
	assert.deepEqual(arr.map, { o1: "Альфа", [BIN_A]: "Альфа" });
	const plain = { items: [{ id: "o1" }] };
	assert.equal(extractOrgBases(plain).visible, plain);
	assert.equal(baseKeyOf({ organizationBin: BIN_A }, arr.map), "Альфа");
	assert.equal(baseKeyOf({ baseKey: "Бета", organizationId: "o1" }, arr.map), "Бета");
	assert.equal(baseKeyOf({ organizationId: "нет" }, arr.map), null);
});

test("onlyOrganization: из списка — только организация с этим БИН, ответ другой формы — как есть", () => {
	assert.deepEqual(onlyOrganization({ items: [{ id: "a", bin: BIN_A }, { id: "b", bin: BIN_B }], total: 2 }, BIN_B), { items: [{ id: "b", bin: BIN_B }], total: 2 });
	assert.deepEqual(onlyOrganization([{ bin: BIN_A }, { bin: BIN_B }], BIN_A), [{ bin: BIN_A }]);
	assert.equal(onlyOrganization("текст", BIN_A), "текст");
});

test("C4: БИН в двух базах — запоминается первая база", () => {
	const r = extractOrgBases({ items: [{ id: ORG_A, bin: BIN_A, baseKey: "Альфа" }, { id: ORG_B, bin: BIN_A, baseKey: "Бета" }] });
	assert.equal(r.map[BIN_A], "Альфа");
	assert.equal(r.map[ORG_B], "Бета");
});

test("referencedBases: объекты по памяти диалога и организация; baseKey вызова не считается объектом", () => {
	const ids = { [CUSTOMER]: "Альфа", [PRODUCT]: "Бета" };
	assert.deepEqual(referencedBases({ customerId: CUSTOMER, items: [{ productId: PRODUCT }] }, {}, ids).sort(), ["Альфа", "Бета"]);
	assert.deepEqual(referencedBases({ organizationId: ORG_B, baseKey: "Альфа" }, { [ORG_B]: "Бета" }, {}), ["Бета"]);
	assert.deepEqual(referencedBases({ q: "физули" }, {}, ids), []);
});

test("C18: БИН организации ERP читается один раз на диалог", async () => {
	const h = setup([
		() => ({ toolCalls: [call("tu_c", "search_counterparties", { q: "физули" }), call("tu_p", "search_products", { q: "услуга" })] }),
		() => ({ text: "Нашёл." }),
		() => ({ toolCalls: [call("tu_c2", "search_counterparties", { q: "физули" })] }),
		() => ({ text: "Снова нашёл." }),
	]);
	const r = await h.workflow.handle(h.user, null, "найди физули и услугу");
	await h.workflow.handle(h.user, r.conversationId, "ещё раз");
	assert.equal(h.erpReads.n, 1);
	assert.deepEqual(h.enqueued.map((e) => e.baseKey), ["Альфа", "Альфа", "Альфа"]);
});

/*
 * ОРГАНИЗАЦИЯ БАЗЫ В КОМАНДАХ, КОТОРЫЕ ЕЁ ПРИНИМАЮТ (по письму со стороны 1С от 23.09). Кассовый ордер в
 * многофирменной базе требует `organizationBin`: без него 1С отвечает `409 ORGANIZATION_REQUIRED`. База найдена по
 * БИН организации ERP, поэтому он в ней заведомо есть и едет во все инструменты, где для него есть поле.
 */
test("касса: БИН организации ERP уезжает и тогда, когда базу назвал объект вызова", async () => {
	const h = setup([
		() => ({ toolCalls: [call("tu_c", "search_counterparties", { q: "физули" })] }),
		() => ({ toolCalls: [call("tu_k", "create_cash_order", { direction: "in", counterpartyId: CUSTOMER, amount: 5000, purpose: "оплата по счёту" })] }),
		() => ({ text: "Создан приходный ордер." }),
	]);
	const r1 = await h.workflow.handle(h.user, null, "прими 5000 от физули");
	assert.equal(r1.state, "WAITING_CONFIRMATION");
	const r2 = await h.workflow.handle(h.user, r1.conversationId, "да");
	assert.equal(r2.state, "COMPLETED");
	const order = h.enqueued.at(-1)!;
	assert.equal(order.type, "CREATE_CASH_ORDER");
	assert.equal(order.payload.baseKey, "Альфа");
	assert.equal(order.payload.organizationBin, BIN_A);
});
