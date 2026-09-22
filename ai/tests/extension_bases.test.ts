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
import { extensionBaseRows } from "../src/onec/extensionBases.ts";

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
