// МНОГОБАЗОВЫЙ БИЗНЕС-АГЕНТ В ЧАТЕ ERP (СВ3, 19.09): база команды — по БИН организации ERP или по организации из
// get_organizations; сверх лимита тарифа — отказ LICENSE_LIMIT без очереди; `baseKey` модели не показывается.
//
// Выбор базы — настоящий (resolveTarget), агент и очередь — заглушки: проверяется, ЧТО ушло бы агенту.

import { test } from "node:test";
import assert from "node:assert/strict";
import { ChatWorkflow } from "../src/chat/workflow.ts";
import { Audit } from "../src/audit/index.ts";
import { resolveTarget, type AgentBase, type AgentLimits } from "../src/agents/agentBases.ts";
import { baseKeyOf, extractOrgBases, referencedBases } from "../src/chat/orgBases.ts";
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

/** Агент с двумя базами: «Альфа» (организация A), «Бета» (организация B). */
function setup(steps: Step[], opts: { limits?: AgentLimits; erpBin?: string | null; singleBase?: boolean } = {}) {
	const mem = memDb();
	const { llm, seen } = scriptedLlm(steps);
	const agent = { id: "ag-1", role: "business", online: true, disabled: false, onec: { reachable: true }, limits: opts.limits ?? { maxBases: null, maxBins: null } };
	const bases = [base("Альфа", 0, [{ id: ORG_A, bin: BIN_A }]), base("Бета", 1, [{ id: ORG_B, bin: BIN_B }], "http")]
		.slice(0, opts.singleBase ? 1 : 2);
	const enqueued: { type: string; payload: Record<string, unknown>; baseKey?: string }[] = [];
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
			pickOnline: async () => agent,
			listByOrganization: async () => [agent],
			basesOf: async () => bases.map((b) => b.key),
			resolveBusiness: async (_org: string, want: { baseKey?: string | null; bin?: string | null }) => {
				const d = resolveTarget([{ agentId: agent.id, online: true, bases, limits: agent.limits }], want);
				// БИНы организаций выбранной базы — как их отдаёт живой AgentService: по ним решается, можно ли
				// назвать 1С организацию ERP (см. «организация базы» ниже).
				const baseBins = d.kind === "base"
					? (bases.find((b) => b.key === d.baseKey)?.organizations ?? []).map((o) => o.bin)
					: [];
				return d.kind === "base" ? { kind: "agent", agent, baseKey: d.baseKey, alsoIn: d.alsoIn, baseStatus: d.status, baseBins } : d;
			},
		} as never,
		queue: {
			enqueue: async (i: { type: string; payload: Record<string, unknown>; baseKey?: string }) => { enqueued.push(i); return { id: `cmd-${enqueued.length}` }; },
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

test("организации: baseKey модели не виден, но следующий вызов по организации уходит в её базу", async () => {
	const h = setup([
		() => ({ toolCalls: [call("tu_o", "get_organizations", {})] }),
		(req) => {
			const shown = JSON.stringify(lastToolResults(req)[0].content);
			assert.ok(!shown.includes("baseKey"), shown);
			assert.ok(shown.includes(BIN_B));
			// Поиск — с адресом organizationId: у поиска своей организации в 1С нет, это только выбор базы.
			return { toolCalls: [call("tu_c", "search_counterparties", { q: "физули", organizationId: ORG_B }), call("tu_p", "search_products", { q: "услуга", organizationId: ORG_B })] };
		},
		() => ({ toolCalls: [call("tu_s", "create_sale", { customerId: CUSTOMER, organizationId: ORG_B, items: [{ productId: PRODUCT, quantity: 1, price: 5000 }] })] }),
		() => ({ text: "Создана реализация." }),
	]);
	const r1 = await h.workflow.handle(h.user, null, "создай реализацию от ТОО Бета");
	assert.equal(r1.state, "WAITING_CONFIRMATION");
	// Обзор организаций — без адреса (агент отдаёт все базы), поиск — в базу названной организации (Бета), и база —
	// в колонке очереди тоже (C1). Адрес в 1С не уходит: в payload поиска нет organizationId.
	assert.deepEqual(h.enqueued.map((e) => [e.type, e.payload.baseKey ?? null, e.baseKey ?? null]), [
		["GET_ORGANIZATIONS", null, null], ["SEARCH_COUNTERPARTIES", "Бета", "Бета"], ["SEARCH_PRODUCTS", "Бета", "Бета"],
	]);
	assert.equal(h.enqueued[1].payload.organizationId, undefined);
	const r2 = await h.workflow.handle(h.user, r1.conversationId, "да");
	assert.equal(r2.state, "COMPLETED");
	const sale = h.enqueued.at(-1)!;
	assert.equal(sale.type, "CREATE_SALE");
	assert.equal(sale.payload.baseKey, "Бета");
});

test("maxBins=1 при двух организациях: команда по второй — LICENSE_LIMIT с текстом про тариф, в очередь не встаёт", async () => {
	const h = setup([
		() => ({ toolCalls: [call("tu_c", "search_counterparties", { q: "физули" })] }),
		(req) => {
			const r = lastToolResults(req)[0];
			assert.equal(r.isError, true);
			const c = r.content as { error: string; message: string };
			assert.equal(c.error, "LICENSE_LIMIT");
			assert.match(c.message, /тариф: 1 БИН, подключено 2/);
			return { text: "Организация сверх лимита тарифа." };
		},
	], { limits: { maxBases: null, maxBins: 1 }, erpBin: BIN_B });
	const r = await h.workflow.handle(h.user, null, "найди физули");
	assert.equal(r.state, "COMPLETED");
	assert.equal(h.enqueued.length, 0);
	assert.ok(h.mem.audit.some((a) => a.event === "chat.license_limit"));
});

test("maxBases=1: база сверх лимита отвергается сервисом, не доходя до агента", async () => {
	const h = setup([
		() => ({ toolCalls: [call("tu_c", "search_counterparties", { q: "физули" })] }),
		(req) => {
			const c = lastToolResults(req)[0].content as { error: string; message: string };
			assert.equal(c.error, "LICENSE_LIMIT");
			assert.match(c.message, /тариф: 1 база, подключено 2/);
			return { text: "Сверх лимита." };
		},
	], { limits: { maxBases: 1, maxBins: null }, erpBin: BIN_B });
	await h.workflow.handle(h.user, null, "найди физули");
	assert.equal(h.enqueued.length, 0);
});

test("БИН организации ERP неизвестен срезу: у однобазового агента — прежний путь без baseKey, у многобазового — BASE_REQUIRED", async () => {
	const one = setup([
		() => ({ toolCalls: [call("tu_c", "search_counterparties", { q: "физули" })] }),
		() => ({ text: "Нашёл." }),
	], { erpBin: "999999999999", singleBase: true });
	await one.workflow.handle(one.user, null, "найди физули");
	assert.deepEqual(one.enqueued.map((e) => [e.payload.baseKey ?? null, e.baseKey ?? null]), [[null, null]]);

	const many = setup([
		() => ({ toolCalls: [call("tu_c", "search_counterparties", { q: "физули" })] }),
		(req) => {
			assert.equal((lastToolResults(req)[0].content as { error: string }).error, "BASE_REQUIRED");
			return { text: "Уточните организацию." };
		},
	], { erpBin: "999999999999" });
	await many.workflow.handle(many.user, null, "найди физули");
	assert.equal(many.enqueued.length, 0);
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

test("C0: объект из одной базы в вызове по организации другой — MIXED_BASES без очереди", async () => {
	const h = setup([
		() => ({ toolCalls: [call("tu_o", "get_organizations", {})] }),
		// Поиск без адреса — в базу организации ERP (Альфа): контрагент и товар оттуда.
		() => ({ toolCalls: [call("tu_c", "search_counterparties", { q: "физули" }), call("tu_p", "search_products", { q: "услуга" })] }),
		() => ({ toolCalls: [call("tu_s", "create_sale", { customerId: CUSTOMER, organizationId: ORG_B, items: [{ productId: PRODUCT, quantity: 1, price: 5000 }] })] }),
		() => ({ text: "Нужно найти контрагента в базе Бета." }),
	]);
	const r1 = await h.workflow.handle(h.user, null, "создай реализацию от ТОО Бета");
	assert.equal(r1.state, "WAITING_CONFIRMATION");
	const before = h.enqueued.length;
	const r2 = await h.workflow.handle(h.user, r1.conversationId, "да");
	assert.equal(r2.state, "COMPLETED");
	assert.equal(h.enqueued.length, before, "создание со смешанными базами не должно встать в очередь");
	assert.ok(h.mem.audit.some((a) => a.event === "chat.mixed_bases"));
});

test("C2: у организации ERP нет БИН, у агента несколько баз — BASE_REQUIRED без очереди; обзор организаций идёт", async () => {
	const h = setup([
		() => ({ toolCalls: [call("tu_c", "search_counterparties", { q: "физули" })] }),
		(req) => {
			const c = lastToolResults(req)[0].content as { error: string; message: string };
			assert.equal(c.error, "BASE_REQUIRED");
			assert.match(c.message, /«Альфа», «Бета»/);
			return { toolCalls: [call("tu_o", "get_organizations", {})] };
		},
		() => ({ text: "В какой организации искать?" }),
	], { erpBin: null });
	await h.workflow.handle(h.user, null, "найди физули");
	assert.deepEqual(h.enqueued.map((e) => e.type), ["GET_ORGANIZATIONS"]);
});

test("C0: адрес organizationId, которого нет в ответе get_organizations, — ошибка входа", async () => {
	const h = setup([
		() => ({ toolCalls: [call("tu_o", "get_organizations", {})] }),
		() => ({ toolCalls: [call("tu_c", "search_counterparties", { q: "физули", organizationId: "0c000000-0000-4000-8000-00000000000c" })] }),
		(req) => {
			const c = lastToolResults(req)[0].content as { error: string };
			assert.equal(c.error, "VALIDATION_ERROR");
			return { text: "Такой организации нет." };
		},
	]);
	await h.workflow.handle(h.user, null, "найди физули");
	assert.deepEqual(h.enqueued.map((e) => e.type), ["GET_ORGANIZATIONS"]);
});

test("C4: БИН в двух базах — запоминается первая база, как у агента", () => {
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
 * ОРГАНИЗАЦИЯ БАЗЫ В КОМАНДАХ, КОТОРЫЕ ЕЁ ПРИНИМАЮТ (по письму со стороны 1С от 23.09).
 *
 * Кассовый ордер в многофирменной базе фактически требует `organizationBin`: без него 1С отвечает
 * `409 ORGANIZATION_REQUIRED` — чьи это деньги, она гадать не вправе. Модель в веб-чате БИН знать не может,
 * пока не спросит get_organizations, а базу вызов чаще называет не БИНом, а объектами: `counterpartyId`
 * кассового ордера пришёл из неё же. Раньше БИН уезжал ТОЛЬКО когда по нему и искали базу — то есть в этом
 * случае не уезжал вовсе.
 *
 * Правило теперь одно с каналом 1С: организация, в которой работает человек, едет во все инструменты, где для
 * неё есть поле. Но только если агент сообщил, что такая организация в базе ЕСТЬ: чужой БИН 1С отвергнет, а в
 * базе одной фирмы, где всё работало без него, вызов начал бы отказывать.
 */
test("касса: БИН организации ERP уезжает и тогда, когда базу назвал объект вызова, а не БИН", async () => {
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
	// База — по контрагенту из предыдущего вызова (Альфа), организация — активная организация ERP.
	assert.equal(order.payload.baseKey, "Альфа");
	assert.equal(order.payload.organizationBin, BIN_A);
});

test("касса: организации ERP в этой базе нет — БИН не подставляем, иначе сломали бы работавший вызов", async () => {
	const h = setup([
		// Организации — чтобы `organizationId` стал адресом базы, как это и происходит в жизни.
		() => ({ toolCalls: [call("tu_o", "get_organizations", {})] }),
		// Поиск с адресом: контрагент найден в базе «Бета» (организация BIN_B), а организация ERP — BIN_A.
		() => ({ toolCalls: [call("tu_c", "search_counterparties", { q: "физули", organizationId: ORG_B })] }),
		() => ({ toolCalls: [call("tu_k", "create_cash_order", { direction: "in", counterpartyId: CUSTOMER, amount: 5000 })] }),
		() => ({ text: "Создан приходный ордер." }),
	]);
	const r1 = await h.workflow.handle(h.user, null, "прими 5000 от физули из Беты");
	const r2 = await h.workflow.handle(h.user, r1.conversationId, "да");
	assert.equal(r2.state, "COMPLETED");
	const order = h.enqueued.at(-1)!;
	assert.equal(order.payload.baseKey, "Бета");
	assert.equal(order.payload.organizationBin, undefined, "в «Бете» организации BIN_A нет — называть её значило бы получить отказ 1С");
});

test("касса: организацию назвала модель — её выбор главнее активной организации ERP", async () => {
	const h = setup([
		() => ({ toolCalls: [call("tu_o", "get_organizations", {})] }),
		() => ({ toolCalls: [call("tu_c", "search_counterparties", { q: "физули", organizationId: ORG_B })] }),
		() => ({ toolCalls: [call("tu_k", "create_cash_order", { direction: "in", counterpartyId: CUSTOMER, amount: 5000, organizationBin: BIN_B })] }),
		() => ({ text: "Создан приходный ордер." }),
	]);
	const r1 = await h.workflow.handle(h.user, null, "прими 5000 от физули по Бете");
	const r2 = await h.workflow.handle(h.user, r1.conversationId, "да");
	assert.equal(r2.state, "COMPLETED");
	assert.equal(h.enqueued.at(-1)!.payload.organizationBin, BIN_B);
});
