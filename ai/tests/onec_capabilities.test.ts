/**
 * Новые возможности 1С в сервисе: списки документов, справочники, числа и касса
 * (docs/PLAN_ONEC_CAPABILITIES_2026-09-22.md, СВ11–СВ15, СВ18).
 *
 * Держим то, что ошибкой обходится дороже всего:
 *   — выдуманный идентификатор не уходит в 1С ни списком, ни кассовым ордером;
 *   — контрагент не заводится без БИН из 12 цифр: дубль в справочнике живёт вечно;
 *   — предел строк ставится сервисом, а не надеждой на модель: сотня строк в ответе — потерянный ответ;
 *   — команда каждого инструмента совпадает с белым списком расширения (опечатка здесь = UNKNOWN_COMMAND);
 *   — промпт называет списки и числа своими инструментами, иначе модель тянется к отчётам, как привыкла.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { TOOLS, TOOLS_BY_NAME, ToolInputError, toolDefinitions } from "../src/tools/registry.ts";
import { SYSTEM_PROMPT } from "../src/chat/prompt.ts";
import { documentsOf } from "../src/chat/workflow.ts";
import { chatCallRows } from "../src/audit/index.ts";
import { agentKnowsType } from "../src/commands/admin.ts";

const CP = "11111111-0000-4000-8000-000000000001";
const DOC = "22222222-0000-4000-8000-000000000002";
const ALIEN = "99999999-0000-4000-8000-000000000009";
const ctx = () => ({ seenIds: new Set<string>([CP, DOC]) });

const build = (tool: string, input: Record<string, unknown>) => TOOLS_BY_NAME.get(tool)!.buildPayload(input, ctx());

// ── СВ11. Списки документов ──────────────────────────────────────────────────

test("СВ11: список документов — период, отбор по контрагенту и признак проведения уходят как есть", () => {
	const p = build("list_documents", { documentType: "sale", from: "2026-09-01", to: "2026-09-30", counterpartyId: CP, posted: false });
	assert.deepEqual(p, { documentType: "sale", from: "2026-09-01", to: "2026-09-30", counterpartyId: CP, posted: false, limit: 20 });

	// posted не передан — это «все документы», а не «только проведённые»: разница в ответе на «какие счета не оплачены».
	const all = build("list_documents", { documentType: "invoice", from: "2026-09-01", to: "2026-09-30" });
	assert.ok(!("posted" in all), "без явного отбора признак проведения не подставляем");
});

test("СВ11: выдуманный контрагент в отбор не проходит, кривая дата — тоже", () => {
	assert.throws(
		() => build("list_documents", { documentType: "sale", from: "2026-09-01", to: "2026-09-30", counterpartyId: ALIEN }),
		(e: unknown) => e instanceof ToolInputError,
	);
	assert.throws(
		() => build("list_documents", { documentType: "sale", from: "сентябрь", to: "2026-09-30" }),
		(e: unknown) => e instanceof ToolInputError,
		"«сентябрь» 1С не поймёт: дата обязана быть YYYY-MM-DD",
	);
	assert.throws(
		() => build("list_documents", { documentType: "накладная", from: "2026-09-01", to: "2026-09-30" }),
		(e: unknown) => e instanceof ToolInputError,
		"вид документа — из белого списка расширения",
	);
});

test("СВ13: предел строк ставит сервис — модель не может попросить всё", () => {
	assert.equal((build("list_documents", { documentType: "sale", from: "2026-09-01", to: "2026-09-30", limit: 5000 }) as { limit: number }).limit, 100);
	assert.equal((build("get_debts", { onDate: "2026-09-22" }) as { limit: number }).limit, 50, "по умолчанию — полсотни строк");
	assert.equal((build("get_turnovers", { account: "1030", from: "2026-09-01", to: "2026-09-30", limit: 900 }) as { limit: number }).limit, 100);
	assert.throws(() => build("list_documents", { documentType: "sale", from: "2026-09-01", to: "2026-09-30", limit: 0 }), (e: unknown) => e instanceof ToolInputError);
});

test("СВ11: сумма «от» больше суммы «до» — отбор бессмыслен, отказываем до команды", () => {
	assert.throws(
		() => build("list_documents", { documentType: "sale", from: "2026-09-01", to: "2026-09-30", minAmount: 100, maxAmount: 10 }),
		(e: unknown) => e instanceof ToolInputError,
	);
});

// ── СВ12. Справочники ────────────────────────────────────────────────────────

test("СВ12: контрагент заводится только с БИН из 12 цифр", () => {
	const p = build("create_counterparty", { name: "  ТОО Ромашка  ", bin: "831111302342" });
	assert.equal((p as { name: string }).name, "ТОО Ромашка");
	assert.equal((p as { bin: string }).bin, "831111302342");
	/*
	 * РОЛИ В КАРТОЧКЕ НЕТ (23.09, сверка контрактов со стороной 1С). Сервис слал `kind: buyer|supplier|both`,
	 * расширение читало тем же именем ВИД ЛИЦА — поле совпало, смысл нет. В типовой роль контрагента задаёт
	 * вид договора, поэтому из схемы её убрали; модель, попросившая «создай покупателя», получает контрагента,
	 * а покупателем он станет при первом документе.
	 */
	assert.ok(!("kind" in p), "роль контрагента в payload не уходит");
	for (const bad of ["12345", "83111130234a", "", "8311113023421"]) {
		assert.throws(() => build("create_counterparty", { name: "ТОО Ромашка", bin: bad }), (e: unknown) => e instanceof ToolInputError, `БИН «${bad}» не должен пройти`);
	}
	assert.throws(() => build("create_counterparty", { name: "   ", bin: "831111302342" }), (e: unknown) => e instanceof ToolInputError);
});

test("СВ12: номенклатура — товар или услуга, третьего не дано", () => {
	assert.deepEqual(build("create_product", { name: "Доставка", kind: "service", unit: "услуга" }), {
		name: "Доставка", kind: "service", unit: "услуга", comment: "Создано BuhProf AI",
	});
	assert.throws(() => build("create_product", { name: "Доставка", kind: "работа" }), (e: unknown) => e instanceof ToolInputError);
});

test("СВ12: создание справочников подтверждается пользователем — класс WRITE", () => {
	for (const name of ["create_counterparty", "create_product"]) {
		assert.equal(TOOLS_BY_NAME.get(name)!.operation, "WRITE", `${name}: без карточки подтверждения справочник пополнялся бы молча`);
		assert.equal(TOOLS_BY_NAME.get(name)!.mutating, true);
	}
});

// ── СВ13. Числа ──────────────────────────────────────────────────────────────

test("СВ13: долги, остатки и обороты — чтение, и организация отбирается по БИН", () => {
	for (const name of ["get_debts", "get_balances", "get_turnovers", "list_documents", "list_document_types"]) {
		assert.equal(TOOLS_BY_NAME.get(name)!.operation, "READ", `${name} ничего не меняет`);
		assert.equal(TOOLS_BY_NAME.get(name)!.mutating, false);
	}
	const debts = build("get_debts", { onDate: "2026-09-22", kind: "receivable", organizationBin: "831111302342", overdueOnly: true });
	assert.deepEqual(debts, { onDate: "2026-09-22", kind: "receivable", organizationBin: "831111302342", overdueOnly: true, limit: 50 });

	// Кривой БИН не превращается в отказ 1С: его просто нет в payload — организацию подставит канал по выбору в форме.
	const loose = build("get_balances", { onDate: "2026-09-22", organizationBin: "123" });
	assert.ok(!("organizationBin" in loose));
	assert.deepEqual(build("get_balances", { onDate: "2026-09-22", accounts: ["1010", " 1030 ", 42] }), { onDate: "2026-09-22", accounts: ["1010", "1030"] });
});

// ── СВ14. Касса ──────────────────────────────────────────────────────────────

test("СВ14: кассовый ордер — направление, сумма больше нуля и известный контрагент", () => {
	assert.deepEqual(build("create_cash_order", { direction: "in", counterpartyId: CP, amount: 15000, purpose: "оплата по счёту №12" }), {
		direction: "in", counterpartyId: CP, amount: 15000, purpose: "оплата по счёту №12", comment: "Создано BuhProf AI",
	});
	assert.throws(() => build("create_cash_order", { direction: "обе", counterpartyId: CP, amount: 1 }), (e: unknown) => e instanceof ToolInputError);
	assert.throws(() => build("create_cash_order", { direction: "out", counterpartyId: CP, amount: 0 }), (e: unknown) => e instanceof ToolInputError);
	assert.throws(() => build("create_cash_order", { direction: "out", counterpartyId: ALIEN, amount: 100 }), (e: unknown) => e instanceof ToolInputError);
});

test("СВ14: проведение кассы — CRITICAL, как у реализаций", () => {
	assert.equal(TOOLS_BY_NAME.get("post_cash_order")!.operation, "CRITICAL");
	assert.equal(TOOLS_BY_NAME.get("unpost_cash_order")!.operation, "CRITICAL");
	assert.equal(TOOLS_BY_NAME.get("create_cash_order")!.operation, "WRITE");
});

test("СВ14: вид кассового ордера берётся из ответа 1С — ссылка не должна открыть чужой документ", () => {
	assert.deepEqual(documentsOf("CREATE_CASH_ORDER", { id: DOC, number: "КО-7", direction: "out" }), [
		{ type: "cashOut", id: DOC, number: "КО-7", title: "Расходный кассовый ордер №КО-7" },
	]);
	assert.deepEqual(documentsOf("CREATE_CASH_ORDER", { id: DOC, number: "КО-8", direction: "in" }), [
		{ type: "cashIn", id: DOC, number: "КО-8", title: "Приходный кассовый ордер №КО-8" },
	]);
});

// ── СВ10. Команды расширения ─────────────────────────────────────────────────

test("СВ10: команда каждого нового инструмента — из белого списка расширения 1.6.0", () => {
	const expected: Record<string, string> = {
		list_documents: "LIST_DOCUMENTS", list_document_types: "LIST_DOCUMENT_TYPES",
		create_counterparty: "CREATE_COUNTERPARTY", create_product: "CREATE_PRODUCT",
		get_debts: "GET_DEBTS", get_balances: "GET_BALANCES", get_turnovers: "GET_TURNOVERS",
		create_cash_order: "CREATE_CASH_ORDER", get_cash_order: "GET_CASH_ORDER",
		post_cash_order: "POST_CASH_ORDER", unpost_cash_order: "UNPOST_CASH_ORDER",
	};
	for (const [tool, commandType] of Object.entries(expected)) {
		const spec = TOOLS_BY_NAME.get(tool);
		assert.ok(spec, `инструмент ${tool} должен быть в реестре`);
		assert.equal(spec.commandType, commandType);
		assert.ok(!spec.runsOnServer, `${tool} исполняет 1С, а не сервис`);
	}
	// Имена команд не повторяются: одно имя на две операции означало бы, что 1С не знает, что делать.
	const types = TOOLS.filter((t) => !t.runsOnServer).map((t) => t.commandType);
	assert.equal(new Set(types).size, types.length);
});

test("СВ10: новые инструменты уезжают модели, и каждый знает, в какой базе выполняться", () => {
	const defs = new Map(toolDefinitions().map((d) => [d.name, d]));
	const props = (name: string) => {
		const d = defs.get(name);
		assert.ok(d, `${name} должен уехать модели`);
		return (d.inputSchema as { properties: Record<string, unknown> }).properties;
	};
	/*
	 * Адрес базы задаётся ОДНИМ из двух способов (C0): свой organizationBin — он же параметр команды 1С,
	 * либо служебный organizationId, который сервис подставляет сам и в 1С не отправляет. Инструмент без
	 * обоих у многобазового агента не знает, куда идти.
	 */
	for (const name of ["list_documents", "get_debts", "get_balances", "get_turnovers", "create_cash_order"]) {
		assert.ok("organizationBin" in props(name), `${name}: организация — параметр самой команды`);
		assert.ok(!("organizationId" in props(name)), `${name}: второй адрес только путал бы модель`);
	}
	for (const name of ["list_document_types", "get_cash_order", "post_cash_order", "create_counterparty", "create_product"]) {
		assert.ok("organizationId" in props(name), `${name}: базу выбирает сервис — модели нужен organizationId`);
	}
});

// ── СВ15. Промпт ─────────────────────────────────────────────────────────────

test("СВ15: промпт разводит списки и числа с отчётами — иначе модель тянется к run_report", () => {
	assert.match(SYSTEM_PROMPT, /list_documents, а НЕ run_report/);
	assert.match(SYSTEM_PROMPT, /get_debts/);
	assert.match(SYSTEM_PROMPT, /get_balances/);
	assert.match(SYSTEM_PROMPT, /create_counterparty/);
	assert.match(SYSTEM_PROMPT, /post_cash_order/);
	// Создание справочника — только после безуспешного поиска и подтверждения человеком.
	assert.match(SYSTEM_PROMPT, /поиск ничего не нашёл И пользователь подтвердил/);
});

// ── ПН8. Журнал вызовов чата ─────────────────────────────────────────────────

const ev = (event: string, details: Record<string, unknown>, at = "2026-09-22T10:00:00.000Z", conv = "c1") =>
	({ at, event, conversationId: conv, organizationUuid: "org", userUuid: "1c:base:user", details: { channel: "1c", baseId: "b1", ...details } });

test("ПН8: вызов склеивается со своим исходом — разбор жалобы начинается с «чем кончилось»", () => {
	const rows = chatCallRows([
		ev("chat.tool_calls", { calls: [{ callId: "x1", tool: "list_documents", type: "LIST_DOCUMENTS", requestId: null }] }),
		ev("chat.tool_results", { results: [{ callId: "x1", success: true, status: 200, code: null }] }, "2026-09-22T10:00:05.000Z"),
	]);
	assert.equal(rows.length, 1);
	assert.deepEqual(
		{ tool: rows[0]!.tool, target: rows[0]!.target, state: rows[0]!.state, baseId: rows[0]!.baseId },
		{ tool: "list_documents", target: "1c", state: "ok", baseId: "b1" },
	);
});

test("ПН8: «не ответили» и «ответили отказом» — разные строки, иначе разбирать нечего", () => {
	const sent = chatCallRows([ev("chat.tool_calls", { calls: [{ callId: "x2", tool: "get_debts", type: "GET_DEBTS" }] })]);
	assert.equal(sent[0]!.state, "sent", "ход мог идти в эту секунду — это не отказ");

	const failed = chatCallRows([
		ev("chat.tool_calls", { calls: [{ callId: "x3", tool: "get_debts", type: "GET_DEBTS" }] }),
		ev("chat.tool_results", { results: [{ callId: "x3", success: false, code: "ACCESS_DENIED" }] }),
	]);
	assert.equal(failed[0]!.state, "failed");
	assert.equal(failed[0]!.code, "ACCESS_DENIED");
});

test("ПН8: результат из ЧУЖОГО диалога не закрывает вызов — callId уникален лишь внутри диалога", () => {
	const rows = chatCallRows([
		ev("chat.tool_calls", { calls: [{ callId: "same", tool: "list_documents", type: "LIST_DOCUMENTS" }] }, "2026-09-22T10:00:00.000Z", "c1"),
		ev("chat.tool_results", { results: [{ callId: "same", success: false, code: "BOOM" }] }, "2026-09-22T10:00:01.000Z", "c2"),
	]);
	assert.equal(rows[0]!.state, "sent");
});

test("ПН8: в журнал попадают и задачи ERP, и вызовы, которые сервис не выпустил", () => {
	const rows = chatCallRows([
		ev("chat.server_tool", { tool: "create_task", type: "TASKS_CREATE", ok: false, code: "ERP_UNAVAILABLE", message: "ERP недоступна" }),
		ev("chat.tool_rejected", { tool: "create_sale", reason: "customerId: идентификатор не встречался в диалоге" }),
	]);
	assert.deepEqual(rows.map((r) => [r.target, r.tool, r.state, r.code]), [
		["erp", "create_task", "failed", "ERP_UNAVAILABLE"],
		["1c", "create_sale", "rejected", "VALIDATION_ERROR"],
	]);
	assert.match(rows[1]!.message ?? "", /не встречался/);
});

// ── Отсечка незнакомых команд (аудит 22.09) ──────────────────────────────────

test("агент, перечисливший свои типы, не получает команду, которой не знает", () => {
	const old = { capabilities: ["HEALTH", "CREATE_SALE", "GET_SALE"] };
	assert.equal(agentKnowsType(old, "CREATE_SALE"), true);
	assert.equal(agentKnowsType(old, "LIST_DOCUMENTS"), false, "новый инструмент на старой сборке — отказ до очереди");
	assert.equal(agentKnowsType(old, "SELF_CHECK"), false);
});

test("перечня типов нет — не мешаем: молчание сборки не равно «не умеет»", () => {
	// Сборка старее механизма перечисления: раньше такие команды ставились и выполнялись.
	assert.equal(agentKnowsType({ capabilities: ["cluster.admin", "ib.admin"] }, "LIST_DOCUMENTS"), true);
	assert.equal(agentKnowsType({ capabilities: [] }, "LIST_DOCUMENTS"), true);
	// Записи без способностей вовсе (агент ещё не регистрировался) не должны ронять разбор.
	assert.equal(agentKnowsType({}, "LIST_DOCUMENTS"), true);
	assert.equal(agentKnowsType({ capabilities: null }, "LIST_DOCUMENTS"), true);
});
