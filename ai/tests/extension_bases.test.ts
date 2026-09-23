/**
 * Базы с расширением: сводка по источникам РАСШИРЕНИЯ (23.09).
 *
 * Причина этого теста — живой промах: сводку строили из реестра кластера, который ведёт админ-агент и который
 * сужен до выбранного сервера. У клиента без админ-агента экран был пуст, хотя заявки одобрены и токены
 * выданы. Здесь закрепляем обратное: база попадает в список по СВОИМ признакам — заявке, токену, срезу
 * бизнес-агента, — и ни один из них не требует кластера.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { collectBusinessSlices, extensionBaseRows } from "../src/onec/extensionBases.ts";

const reg = (over: Partial<Parameters<typeof extensionBaseRows>[0]["registrations"][number]> = {}) => ({
	baseKey: "erp_main", baseName: "Бухгалтерия", state: "APPROVED", organizationUuid: "org-1",
	decidedAt: new Date("2026-09-20T10:00:00Z"), extensionVersion: "1.5.0", ...over,
});
const tok = (over: Partial<Parameters<typeof extensionBaseRows>[0]["tokens"][number]> = {}) => ({
	baseKey: "erp_main", organizationUuid: "org-1", createdAt: new Date("2026-09-20T10:01:00Z"),
	revokedAt: null, replacedBy: null, acceptedUntil: null, ...over,
});
const slice = (over: Partial<Parameters<typeof extensionBaseRows>[0]["slices"][number]> = {}) => ({
	agentId: "a1", agentName: "Бухгалтерия", key: "erp_main", status: "ONLINE",
	transport: "http" as const, extVersion: "1.6.0", seenAt: "2026-09-23T08:00:00.000Z", ...over,
});

test("база попадает в список по заявке — даже если ни один агент её не видел", () => {
	const rows = extensionBaseRows({ registrations: [reg()], tokens: [], slices: [] });
	assert.equal(rows.length, 1);
	assert.equal(rows[0]!.baseKey, "erp_main");
	assert.equal(rows[0]!.access, "none", "заявка одобрена, но токен ещё не забрали");
	assert.equal(rows[0]!.approvedAt, "2026-09-20T10:00:00.000Z");
	assert.equal(rows[0]!.transport, null, "агент про неё не сообщал — это не «нет транспорта», а «не знаем»");
});

test("база с выданным токеном видна, даже если заявку уже убрала уборка", () => {
	const rows = extensionBaseRows({ registrations: [], tokens: [tok()], slices: [] });
	assert.equal(rows.length, 1);
	assert.equal(rows[0]!.access, "active");
	assert.equal(rows[0]!.organizationUuid, "org-1");
});

test("живая версия расширения главнее версии из заявки: её могли обновить после подключения", () => {
	const rows = extensionBaseRows({ registrations: [reg()], tokens: [tok()], slices: [slice()] });
	assert.equal(rows[0]!.extVersion, "1.6.0");
	assert.equal(rows[0]!.extVersionSource, "agent");
	assert.equal(rows[0]!.transport, "http");
	assert.equal(rows[0]!.agentName, "Бухгалтерия");

	// Агент молчит — остаётся то, что база назвала при подключении, и об этом сказано источником.
	const onlyReg = extensionBaseRows({ registrations: [reg()], tokens: [], slices: [] });
	assert.equal(onlyReg[0]!.extVersion, "1.5.0");
	assert.equal(onlyReg[0]!.extVersionSource, "registration");
});

test("доступ: действующий токен главнее отозванного — иначе смена выглядит отключением", () => {
	const rows = extensionBaseRows({
		registrations: [], slices: [],
		tokens: [tok({ revokedAt: new Date("2026-09-21T00:00:00Z") }), tok()],
	});
	assert.equal(rows[0]!.access, "active");

	const revoked = extensionBaseRows({ registrations: [], slices: [], tokens: [tok({ revokedAt: new Date("2026-09-21T00:00:00Z") })] });
	assert.equal(revoked[0]!.access, "revoked");

	// Сменён и ещё принимается: преемник не подтверждён, база живёт на перекрытии.
	const rotating = extensionBaseRows({
		registrations: [], slices: [],
		tokens: [tok({ replacedBy: "t2", acceptedUntil: new Date(Date.now() + 3600_000) })],
	});
	assert.equal(rotating[0]!.access, "rotating");
});

test("нерешённая заявка видна по имени базы: ключ ей дают при одобрении", () => {
	const rows = extensionBaseRows({ registrations: [reg({ baseKey: null, state: "PENDING", baseName: "Бухгалтерия ТОО Альфа" })], tokens: [], slices: [] });
	assert.equal(rows.length, 1);
	assert.equal(rows[0]!.pending, true);
	assert.equal(rows[0]!.baseKey, "Бухгалтерия ТОО Альфа");
});

test("три источника об одной базе дают одну строку: ключ сравнивается без регистра", () => {
	const rows = extensionBaseRows({
		registrations: [reg({ baseKey: "ERP_Main" })],
		tokens: [tok({ baseKey: "erp_main" })],
		slices: [slice({ key: "Erp_MAIN" })],
	});
	assert.equal(rows.length, 1, "иначе одна база троилась бы в списке");
	assert.equal(rows[0]!.access, "active");
	assert.equal(rows[0]!.extVersionSource, "agent");
});

// ── Б1/Б2/Б4: одно правило и один сбор на две витрины (аудит 23.09, четвёртый проход) ──

test("Б1: базу знают два агента — обе витрины берут САМЫЙ СВЕЖИЙ срез, независимо от порядка", () => {
	const old = slice({ agentId: "a-old", agentName: "Старый", extVersion: "1.5.0", transport: "com" as const, seenAt: "2026-09-21T08:00:00.000Z" });
	const now = slice({ agentId: "b-new", agentName: "Свежий", extVersion: "1.6.0", transport: "http" as const, seenAt: "2026-09-23T08:00:00.000Z" });

	for (const order of [[old, now], [now, old]]) {
		const [row] = extensionBaseRows({ registrations: [], tokens: [], slices: order });
		assert.equal(row!.extVersion, "1.6.0", "порядок чтения не должен менять ответ");
		assert.equal(row!.transport, "http");
		assert.equal(row!.agentName, "Свежий");
	}
});

test("Б1: срезы одинаковой свежести не дают скачущего ответа — решает agentId", () => {
	const a = slice({ agentId: "a", extVersion: "1.5.0", seenAt: "2026-09-23T08:00:00.000Z" });
	const b = slice({ agentId: "b", extVersion: "1.6.0", seenAt: "2026-09-23T08:00:00.000Z" });
	assert.equal(extensionBaseRows({ registrations: [], tokens: [], slices: [a, b] })[0]!.extVersion, "1.5.0");
	assert.equal(extensionBaseRows({ registrations: [], tokens: [], slices: [b, a] })[0]!.extVersion, "1.5.0");
});

test("Б2/Б4: отключённый агент молчит везде — его срез не собирается вовсе", async () => {
	const agents = {
		listAll: async () => [
			{ id: "live", name: "Рабочий", role: "business", disabled: false },
			{ id: "off", name: "Отключённый", role: "business", disabled: true },
			{ id: "adm", name: "Кластер", role: "admin", disabled: false },
		],
	};
	const asked: { ids: readonly string[]; cached?: boolean }[] = [];
	const agentBases = {
		listMany: async (ids: readonly string[], opts?: { cached?: boolean }) => {
			asked.push({ ids, cached: opts?.cached });
			return new Map(ids.map((id) => [id, [{ key: "erp_main", status: "ONLINE", transport: "http" as const, extVersion: "1.6.0", seenAt: null }]]));
		},
	};
	const slices = await collectBusinessSlices(agents, agentBases);
	assert.deepEqual(slices.map((s) => s.agentId), ["live"], "ни отключённый, ни админ-агент в срезы не попадают");
	assert.equal(slices[0]!.agentName, "Рабочий");
	// «Обновить» читает мимо кэша — это и отличает его от обычного открытия раздела.
	assert.equal(asked[0]!.cached, true);
	await collectBusinessSlices(agents, agentBases, { fresh: true });
	assert.equal(asked[1]!.cached, false);
});

test("Б4: бизнес-агентов нет — сбор не ходит в хранилище срезов вовсе", async () => {
	let called = false;
	const slices = await collectBusinessSlices(
		{ listAll: async () => [{ id: "adm", name: "Кластер", role: "admin", disabled: false }] },
		{ listMany: async () => { called = true; return new Map(); } },
	);
	assert.deepEqual(slices, []);
	assert.equal(called, false);
});

/*
 * С2: ВЕРСИЯ И ПОСЛЕДНИЙ ОБМЕН ИЗ КАНАЛА ЧАТА.
 *
 * База может работать ТОЛЬКО чатом из 1С — без агента вовсе. Версию она называет в каждом запросе
 * (`X-Ext-Version`), а сервис её нигде не сохранял: в сводке у такой базы было пусто и в версии, и в «Данные
 * от», хотя ответ приходил сегодня двадцать раз. Здесь закрепляем и сам источник, и его место в очереди.
 */
const chat = (over: Partial<NonNullable<Parameters<typeof extensionBaseRows>[0]["chat"]>[number]> = {}) => ({
	baseKey: "erp_main", extVersion: "1.6.1", seenAt: "2026-09-23T09:00:00.000Z", ...over,
});

test("С2: база без агента — версия и последний обмен из канала чата", () => {
	const rows = extensionBaseRows({ registrations: [], tokens: [tok()], slices: [], chat: [chat()] });
	assert.equal(rows.length, 1);
	assert.equal(rows[0]!.extVersion, "1.6.1");
	assert.equal(rows[0]!.extVersionSource, "chat");
	assert.equal(rows[0]!.chatSeenAt, "2026-09-23T09:00:00.000Z");
	assert.equal(rows[0]!.lastExchangeAt, "2026-09-23T09:00:00.000Z");
	assert.equal(rows[0]!.lastExchangeSource, "chat");
	assert.equal(rows[0]!.seenAt, null, "срез агента здесь ни при чём — агента нет");
});

test("С2: срез агента главнее чата, а чат — главнее заявки", () => {
	const both = extensionBaseRows({ registrations: [reg()], tokens: [], slices: [slice()], chat: [chat()] });
	assert.equal(both[0]!.extVersion, "1.6.0", "агент говорит о самой базе");
	assert.equal(both[0]!.extVersionSource, "agent");

	const chatOverReg = extensionBaseRows({ registrations: [reg()], tokens: [], slices: [], chat: [chat()] });
	assert.equal(chatOverReg[0]!.extVersion, "1.6.1", "чат — про то, что работает сейчас; заявку подавали однажды");
	assert.equal(chatOverReg[0]!.extVersionSource, "chat");
});

test("С2: последний обмен — позднее из двух дорог, и он называет свою", () => {
	// Агент видел базу раньше, чем она обратилась сама.
	const chatNewer = extensionBaseRows({
		registrations: [], tokens: [], chat: [chat({ seenAt: "2026-09-23T09:00:00.000Z" })],
		slices: [slice({ seenAt: "2026-09-23T08:00:00.000Z" })],
	});
	assert.equal(chatNewer[0]!.lastExchangeAt, "2026-09-23T09:00:00.000Z");
	assert.equal(chatNewer[0]!.lastExchangeSource, "chat");

	const agentNewer = extensionBaseRows({
		registrations: [], tokens: [], chat: [chat({ seenAt: "2026-09-23T07:00:00.000Z" })],
		slices: [slice({ seenAt: "2026-09-23T08:00:00.000Z" })],
	});
	assert.equal(agentNewer[0]!.lastExchangeAt, "2026-09-23T08:00:00.000Z");
	assert.equal(agentNewer[0]!.lastExchangeSource, "agent");
});

test("С2: о базе не сказал никто — обмен остаётся пустым, а не выдуманным", () => {
	const rows = extensionBaseRows({ registrations: [reg()], tokens: [], slices: [] });
	assert.equal(rows[0]!.lastExchangeAt, null);
	assert.equal(rows[0]!.lastExchangeSource, "none");
	assert.equal(rows[0]!.chatSeenAt, null);
});

test("С2: пустая версия в чате не затирает того, что известно от агента и из заявки", () => {
	// Запрос был, версию не назвали: время обновляем, версию не теряем.
	const rows = extensionBaseRows({ registrations: [reg()], tokens: [], slices: [], chat: [chat({ extVersion: null })] });
	assert.equal(rows[0]!.extVersion, "1.5.0");
	assert.equal(rows[0]!.extVersionSource, "registration");
	assert.equal(rows[0]!.lastExchangeSource, "chat", "обмен всё равно был");
});
