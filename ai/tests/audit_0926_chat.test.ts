/**
 * ЧАТ ИИ — ИСПРАВЛЕНИЯ АУДИТА 26.09 (И27, И28, И29, Н5; раздел 5 «Сервис ИИ» — вложения).
 *
 * Модель — сценарий, база сервиса — в памяти, агент и очередь — заглушки: проверяется, ЧТО увидела модель и что
 * ушло агенту. Держим то, что ломало диалог или создавало лишний документ:
 *   И27 — «да, но количество 5» больше не исполняет старую карточку;
 *   И28 — два хода одного диалога идут по очереди; история без «осиротевших» результатов инструментов;
 *   И29 — отменённая команда — не успех; не дождались — снимаем ещё не выданную; повтор — тот же requestId;
 *         окно истории и кэш-точка на последнем сообщении;
 *   Н5  — имена в карточке — только из своего диалога (общей на процесс карты больше нет).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ChatWorkflow, confirmationAnswer, mapLimited, operationFingerprint } from "../src/chat/workflow.ts";
import { repairHistory, windowHistory, TRIMMED_NOTE } from "../src/chat/history.ts";
import { markLastForCache } from "../src/llm/anthropic.ts";
import { Audit } from "../src/audit/index.ts";
import type { ChatMessage, LLMRequest, LLMResponse, ToolCall } from "../src/llm/provider.ts";
import type { Db } from "../src/db/pool.ts";
import type { Logger } from "../src/logger.ts";

const ORG = "a1410911-7421-45da-9632-7e4fc48e91c2";
const USER = { uuid: "0f6c1c1e-6a57-4c6e-9b2a-1d4f2c9e7a01", organizationUuid: ORG };
const CP = "c0000000-0000-4000-8000-000000000001";
const DOC = "e0000000-0000-4000-8000-000000000001";
const silent = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as unknown as Logger;

// ── И27: ответ на карточку ──────────────────────────────────────────────────

test("И27: согласие и отказ — только целиком; с продолжением — новое указание", () => {
	for (const t of ["да", "Да!", "ок", "да, давай", "+", "подтверждаю.", "всё верно", "да пожалуйста"]) assert.equal(confirmationAnswer(t), "yes", t);
	for (const t of ["нет", "Отмена", "нет, не надо", "-"]) assert.equal(confirmationAnswer(t), "no", t);
	// Ровно случаи из аудита: раньше они исполняли старую карточку.
	for (const t of ["да, но количество 5", "создай на 10 вместо 5", "ок, только цену 6000", "нет, поставь 5", "да и ещё один счёт"]) {
		assert.equal(confirmationAnswer(t), "other", t);
	}
});

// ── И28: целостность истории ────────────────────────────────────────────────

const asst = (id: string | null, text = ""): ChatMessage => ({ role: "assistant", text, toolCalls: id ? [{ id, name: "search_counterparties", input: {} }] : [] });
const results = (...ids: string[]): ChatMessage => ({ role: "user", toolResults: ids.map((id) => ({ toolCallId: id, content: { ok: id } })) });
const user = (text: string): ChatMessage => ({ role: "user", text });

/** То, чего требует API: за вызовами — одно сообщение с результатом на каждый вызов, и ни одного лишнего. */
function assertValid(msgs: ChatMessage[]) {
	assert.equal(msgs[0]!.role, "user");
	assert.ok("text" in msgs[0]!);
	for (let i = 0; i < msgs.length; i++) {
		const m = msgs[i]!;
		if (m.role === "assistant" && m.toolCalls.length) {
			const next = msgs[i + 1];
			assert.ok(next && next.role === "user" && "toolResults" in next, `за вызовами ${i} нет результатов`);
			assert.deepEqual((next as { toolResults: { toolCallId: string }[] }).toolResults.map((r) => r.toolCallId), m.toolCalls.map((c) => c.id));
		}
		if (m.role === "user" && "toolResults" in m) {
			const prev = msgs[i - 1];
			assert.ok(prev && prev.role === "assistant" && prev.toolCalls.length, `результаты ${i} без вызова`);
		}
	}
}

test("И28: история, записанная двумя ходами вперемешку, собирается валидной", () => {
	// Симуляция из аудита: [assistant: use x] [assistant: use y] [user: result x, result y] — раньше result x
	// ссылался на вызов из более раннего ответа, и модель отвечала 400 на каждый следующий ход.
	const raw = [user("первый"), asst("x"), user("второй"), asst("y"), results("x", "y"), asst(null, "итог")];
	const fixed = repairHistory(raw);
	assertValid(fixed);
	const r = fixed.filter((m) => m.role === "user" && "toolResults" in m) as { toolResults: { toolCallId: string; isError?: boolean }[] }[];
	assert.deepEqual(r.map((m) => m.toolResults.map((t) => [t.toolCallId, !!t.isError])), [[["x", true]], [["y", false]]]);
	// Дубль результата и пустой ответ модели — выбрасываются; результат без вызова в начале — тоже.
	const messy = repairHistory([results("z"), user("а"), asst("q"), results("q"), results("q"), asst(null, ""), user("б")]);
	assertValid(messy);
	assert.equal(messy.length, 4);
});

test("И28: два хода одного диалога идут по очереди — второй видит итог первого", async () => {
	const mem = memDb();
	let running = 0;
	let maxRunning = 0;
	let release!: () => void;
	const gate = new Promise<void>((r) => { release = r; });
	const seen: LLMRequest[] = [];
	const llm = {
		name: "script",
		chat: async (req: LLMRequest): Promise<LLMResponse> => {
			running++;
			maxRunning = Math.max(maxRunning, running);
			seen.push(structuredClone(req));
			if (seen.length === 1) await gate;
			running--;
			return { text: `ответ ${seen.length}`, toolCalls: [], stopReason: "end_turn", model: "script" };
		},
	};
	const wf = workflow(mem, llm);
	const id = await wf.prepare(USER, null);
	const first = wf.handle(USER, id, "раз");
	const second = wf.handle(USER, id, "два");
	await new Promise((r) => setTimeout(r, 30));
	assert.equal(seen.length, 1, "второй ход ждёт, пока идёт первый");
	assert.equal(wf.busy(id), true);
	release();
	await Promise.all([first, second]);
	assert.equal(maxRunning, 1);
	const texts = seen[1]!.messages.map((m) => ("text" in m ? m.text : "")).filter(Boolean);
	assert.deepEqual(texts, ["раз", "ответ 1", "два"]);
	assert.equal(wf.busy(id), false, "очередь диалога убрана после хода");
});

// ── И29: окно истории, кэш ──────────────────────────────────────────────────

test("И29: окно режет историю по началу хода и не «плывёт» внутри хода; рассуждения прошлых ходов сняты", () => {
	const big = "я".repeat(4000);
	const thinking = (t: string) => ({ role: "assistant", text: t, toolCalls: [], raw: [{ type: "thinking", thinking: "", signature: "s" }, { type: "text", text: t }] }) as ChatMessage;
	const turns: ChatMessage[] = [];
	for (let i = 0; i < 10; i++) turns.push(user(`вопрос ${i} ${big}`), thinking(`ответ ${i}`));
	turns.push(user("текущий"), asst("c1"), results("c1"));
	const w = windowHistory(turns, 20_000);
	assert.ok(w.dropped > 0 && w.dropped % 2 === 0, "режем по ходам");
	assertValid(w.messages);
	assert.ok((w.messages[0] as { text: string }).text.startsWith(TRIMMED_NOTE));
	// Рассуждений в оставшихся прошлых ходах нет, текущий ход не тронут.
	for (const m of w.messages.slice(0, -3)) {
		if (m.role === "assistant" && Array.isArray(m.raw)) assert.ok(!m.raw.some((b) => (b as { type: string }).type === "thinking"));
	}
	// Ещё один раунд того же хода — начало окна то же (кэш промпта внутри хода работает).
	const w2 = windowHistory([...turns, asst("c2"), results("c2")], 20_000);
	assert.equal(w2.dropped, w.dropped);
	// Короткая история — как есть.
	assert.equal(windowHistory(turns.slice(0, 4), 1_000_000).dropped, 0);
});

test("И29: кэш-точка — на последнем блоке последнего сообщения, не на блоке рассуждений", () => {
	const text = [{ role: "user" as const, content: "привет" }];
	markLastForCache(text);
	assert.deepEqual(text[0]!.content, [{ type: "text", text: "привет", cache_control: { type: "ephemeral" } }]);
	const tools = [{ role: "user" as const, content: [
		{ type: "tool_result" as const, tool_use_id: "a", content: "1" },
		{ type: "tool_result" as const, tool_use_id: "b", content: "2" },
	] }];
	markLastForCache(tools as never);
	assert.equal((tools[0]!.content[0] as { cache_control?: unknown }).cache_control, undefined);
	assert.deepEqual((tools[0]!.content[1] as { cache_control?: unknown }).cache_control, { type: "ephemeral" });
});

// ── И29: исполнение изменяющей команды агентом ─────────────────────────────

type Wait = { state: string; error?: { code: string; message: string } | null; result?: unknown; dispatched_at?: Date | null };

/** Сценарий хода: модель зовёт инструмент, затем отвечает текстом; видно, что вернулось модели. */
function agentHarness(waits: Record<string, (n: number) => Wait>, steps: ((req: LLMRequest) => Partial<LLMResponse>)[], opts: { confirmWrite?: boolean } = {}) {
	const mem = memDb();
	const seen: LLMRequest[] = [];
	const enqueued: { id: string; type: string; requestId: string | null; payload: Record<string, unknown> }[] = [];
	const canceled: string[] = [];
	const agent = { id: "ag-1", role: "business", online: true, disabled: false, onec: { reachable: true }, capabilities: [] };
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
	const count: Record<string, number> = {};
	const queue = {
		enqueue: async (i: { type: string; requestId?: string | null; payload: Record<string, unknown> }) => {
			const id = `cmd-${enqueued.length + 1}`;
			enqueued.push({ id, type: i.type, requestId: i.requestId ?? null, payload: i.payload });
			return { id };
		},
		waitResult: async (id: string) => {
			const e = enqueued.find((x) => x.id === id)!;
			count[e.type] = (count[e.type] ?? 0) + 1;
			return { id, ...waits[e.type]!(count[e.type]!) };
		},
		cancel: async (ids: string[]) => { canceled.push(...ids); return ids.length; },
	};
	const wf = new ChatWorkflow({
		db: mem.db, log: silent, llm,
		agents: { pickOnline: async () => agent, listByOrganization: async () => [agent], basesOf: async () => ["Бух"] } as never,
		queue: queue as never, audit: new Audit(mem.db, silent), confirmWrite: opts.confirmWrite ?? false, commandTimeoutMs: 50, maxToolRounds: 8,
		files: { save: async () => { throw new Error("файлов нет"); } } as never,
	});
	return { mem, seen, enqueued, canceled, wf };
}

const call = (id: string, name: string, input: Record<string, unknown>): ToolCall => ({ id, name, input });
const lastResults = (req: LLMRequest) => {
	const m = [...req.messages].reverse().find((x) => x.role === "user" && "toolResults" in x);
	return m && "toolResults" in m ? m.toolResults : [];
};
const createCp = () => call(`tu_${Math.random().toString(36).slice(2, 8)}`, "create_counterparty", { name: "ТОО Тест", bin: "123456789012" });

test("И29: команда, отменённая в панели, — не успех: модель получает отказ", async () => {
	const h = agentHarness({ CREATE_COUNTERPARTY: () => ({ state: "canceled", error: { code: "COMMAND_CANCELED", message: "Команда отменена до начала выполнения." } }) },
		[() => ({ toolCalls: [createCp()] }), () => ({ text: "Контрагент не создан." })]);
	const r = await h.wf.handle(USER, null, "заведи контрагента");
	assert.equal(r.state, "COMPLETED");
	const res = lastResults(h.seen[1]!)[0]!;
	assert.equal(res.isError, true);
	assert.equal((res.content as { error: string }).error, "COMMAND_CANCELED");
	assert.match((res.content as { message: string }).message, /не выполнена/);
});

test("И29: не дождались — ещё не выданная команда снимается и не выполнится", async () => {
	const h = agentHarness({ CREATE_COUNTERPARTY: () => ({ state: "queued" }) },
		[() => ({ toolCalls: [createCp()] }), () => ({ text: "1С занята." })]);
	await h.wf.handle(USER, null, "заведи контрагента");
	assert.deepEqual(h.canceled, ["cmd-1"]);
	const res = lastResults(h.seen[1]!)[0]!;
	assert.equal((res.content as { error: string; canceled?: boolean }).error, "TIMEOUT");
	assert.equal((res.content as { canceled?: boolean }).canceled, true);
	assert.match((res.content as { message: string }).message, /выполнена НЕ будет/);
});

test("И29: выполняется без ответа — повтор той же операции уходит с тем же requestId (второго документа нет)", async () => {
	const h = agentHarness({
		CREATE_COUNTERPARTY: (n) => (n === 1 ? { state: "dispatched" } : { state: "done", result: { id: CP, name: "ТОО Тест" } }),
	}, [
		() => ({ toolCalls: [createCp()] }), () => ({ text: "1С ещё работает." }),
		() => ({ toolCalls: [createCp()] }), () => ({ text: "Готово." }),
	]);
	const first = await h.wf.handle(USER, null, "заведи контрагента");
	assert.deepEqual(h.canceled, [], "уже выданную не снимаем");
	assert.equal((lastResults(h.seen[1]!)[0]!.content as { stillRunning?: boolean }).stillRunning, true);
	await h.wf.handle(USER, first.conversationId, "повтори");
	assert.equal(h.enqueued.length, 2);
	assert.ok(h.enqueued[0]!.requestId);
	assert.equal(h.enqueued[1]!.requestId, h.enqueued[0]!.requestId, "тот же номер запроса — 1С вернёт прежний результат");
	// Итог известен — номер операции из диалога убран: следующая такая же операция — новая.
	const ctx = h.mem.convs.get(first.conversationId)!.context as { inflight?: Record<string, string> };
	assert.equal(ctx.inflight?.[operationFingerprint("CREATE_COUNTERPARTY", h.enqueued[0]!.payload)], undefined);
});

test("И29: истёкшая после выдачи — «могла выполниться», а не «не исполнена»", async () => {
	const h = agentHarness({ CREATE_COUNTERPARTY: () => ({ state: "expired", dispatched_at: new Date(), error: { code: "AGENT_RESTARTED", message: "перезапуск" } }) },
		[() => ({ toolCalls: [createCp()] }), () => ({ text: "Проверьте в 1С." })]);
	await h.wf.handle(USER, null, "заведи");
	const c = lastResults(h.seen[1]!)[0]!.content as { error: string; message: string };
	assert.equal(c.error, "EXPIRED");
	assert.match(c.message, /МОГЛА выполниться/);
});

// ── Н5: имена в карточке — только свои ─────────────────────────────────────

test("Н5: карточка подписывает объекты именами из СВОЕГО диалога, а не из чужого", async () => {
	const other = { uuid: "0f6c1c1e-6a57-4c6e-9b2a-1d4f2c9e7a02", organizationUuid: ORG };
	const h = agentHarness({
		SEARCH_COUNTERPARTIES: (n) => ({ state: "done", result: n === 1 ? { items: [{ id: DOC, name: "Секрет чужой организации" }] } : { items: [{ id: DOC }] } }),
	}, [
		() => ({ toolCalls: [call("s1", "search_counterparties", { q: "а" })] }), () => ({ text: "нашёл" }),
		() => ({ toolCalls: [call("s2", "search_counterparties", { q: "б" })] }), () => ({ toolCalls: [call("p1", "post_sale", { documentId: DOC })] }),
	]);
	await h.wf.handle(other, null, "найди");
	const mine = await h.wf.handle(USER, null, "найди и проведи");
	assert.equal(mine.state, "WAITING_CONFIRMATION");
	assert.ok(!mine.text.includes("Секрет"), "имя из чужого диалога не попало в карточку");
	assert.ok(mine.text.includes(DOC));
});

// ── вложения ─────────────────────────────────────────────────────────────────

test("вложения: распознаются не больше чем по N одновременно, порядок сохраняется", async () => {
	let running = 0;
	let max = 0;
	const out = await mapLimited([5, 1, 4, 2, 3], 2, async (x) => {
		running++;
		max = Math.max(max, running);
		await new Promise((r) => setTimeout(r, x * 3));
		running--;
		return x * 10;
	});
	assert.deepEqual(out, [50, 10, 40, 20, 30]);
	assert.equal(max, 2);
});

// ── общая база в памяти (как в onec_chat.test.ts) ───────────────────────────

function memDb() {
	type Conv = { id: string; organization_uuid: string; user_uuid: string; state: string; context: unknown; created_at: Date; updated_at: Date };
	const convs = new Map<string, Conv>();
	const msgs: { id: number; conversation_id: string; role: string; content: unknown; created_at: Date }[] = [];
	const query = async (sql: string, p: unknown[] = []) => {
		const none = { rows: [] as unknown[], rowCount: 0 };
		if (sql.includes("INSERT INTO conversations")) {
			convs.set(String(p[0]), { id: String(p[0]), organization_uuid: String(p[1]), user_uuid: String(p[2]), state: "IDLE", context: { seenIds: [] }, created_at: new Date(), updated_at: new Date() });
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
		if (sql.includes("INSERT INTO audit_log")) return { rows: [], rowCount: 1 };
		throw new Error(`memDb: неожиданный запрос ${sql.slice(0, 80)}`);
	};
	return { db: { query } as unknown as Db, convs, msgs };
}

function workflow(mem: ReturnType<typeof memDb>, llm: { name: string; chat: (r: LLMRequest) => Promise<LLMResponse> }) {
	const forbidden = () => { throw new Error("агент не нужен"); };
	return new ChatWorkflow({
		db: mem.db, log: silent, llm,
		agents: { pickOnline: forbidden, listByOrganization: forbidden } as never,
		queue: { enqueue: forbidden, waitResult: forbidden } as never,
		audit: new Audit(mem.db, silent), confirmWrite: true, commandTimeoutMs: 1000, maxToolRounds: 8,
		files: { save: forbidden } as never,
	});
}
