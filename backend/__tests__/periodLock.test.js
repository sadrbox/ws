// Юнит-тесты блокировки закрытых периодов (periodLock) на мок-клиенте — без БД.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
	PERIOD_LOCKED_MODELS,
	getClosedBoundary,
	invalidateClosedBoundary,
	assertPeriodOpen,
	PeriodLockedError,
	respondPeriodLockError,
} from "../services/periodLock.js";

// Мок prisma: aggregate _max periodEnd проведённых закрытий.
function mockClient(periodEndIso) {
	return {
		monthClose: {
			aggregate: async () => ({ _max: { periodEnd: periodEndIso ? new Date(periodEndIso) : null } }),
		},
	};
}

// Уникальная org на каждый тест — TTL-кэш per-org не должен мешать.
let n = 0;
const freshOrg = () => `org-test-${++n}`;

test("нет закрытий → граница null, период открыт", async () => {
	const org = freshOrg();
	invalidateClosedBoundary();
	assert.equal(await getClosedBoundary(org, mockClient(null)), null);
	await assert.doesNotReject(() => assertPeriodOpen(org, new Date("2026-03-15"), mockClient(null)));
});

test("есть закрытие → граница на конец дня periodEnd", async () => {
	const org = freshOrg();
	invalidateClosedBoundary();
	const b = await getClosedBoundary(org, mockClient("2026-03-31T00:00:00Z"));
	assert.ok(b instanceof Date);
	// Конец дня: миллисекунды 999, секунды 59 (локальное время сервера).
	assert.equal(b.getMilliseconds(), 999);
	assert.equal(b.getSeconds(), 59);
});

test("дата в закрытом месяце → PeriodLockedError", async () => {
	const org = freshOrg();
	invalidateClosedBoundary();
	const client = mockClient("2026-03-31T00:00:00Z");
	await assert.rejects(
		() => assertPeriodOpen(org, new Date("2026-03-15T12:00:00Z"), client),
		(e) => e instanceof PeriodLockedError,
	);
});

test("дата после закрытого периода → проходит", async () => {
	const org = freshOrg();
	invalidateClosedBoundary();
	const client = mockClient("2026-03-31T00:00:00Z");
	await assert.doesNotReject(() => assertPeriodOpen(org, new Date("2026-04-02T09:00:00Z"), client));
});

test("без организации или без даты → проверка пропускается", async () => {
	invalidateClosedBoundary();
	const client = mockClient("2026-03-31T00:00:00Z");
	await assert.doesNotReject(() => assertPeriodOpen(null, new Date("2026-03-15"), client));
	await assert.doesNotReject(() => assertPeriodOpen(freshOrg(), null, client));
});

test("month_close НЕ в списке блокируемых моделей; торговые — в списке", () => {
	assert.equal(PERIOD_LOCKED_MODELS.has("monthClose"), false);
	for (const m of ["sale", "purchase", "cashOrder", "bankStatement", "payrollPayment"]) {
		assert.equal(PERIOD_LOCKED_MODELS.has(m), true, `${m} должен блокироваться`);
	}
});

test("invalidateClosedBoundary сбрасывает кэш — новое значение применяется", async () => {
	const org = freshOrg();
	invalidateClosedBoundary();
	assert.equal(await getClosedBoundary(org, mockClient(null)), null); // закэшировано null
	// Без сброса вернулось бы null из кэша; после сброса — новая граница.
	invalidateClosedBoundary(org);
	const b = await getClosedBoundary(org, mockClient("2026-02-28T00:00:00Z"));
	assert.ok(b instanceof Date);
});

test("respondPeriodLockError: 423 для PeriodLockedError, иначе false", () => {
	let status = null;
	let body = null;
	const res = { status(s) { status = s; return this; }, json(b) { body = b; return this; } };
	assert.equal(respondPeriodLockError(new PeriodLockedError("Период закрыт"), res), true);
	assert.equal(status, 423);
	assert.equal(body.success, false);
	assert.equal(respondPeriodLockError(new Error("прочее"), res), false);
});

// ─── Аудит 26.09 (У5, У9) ────────────────────────────────────────────────────

test("граница — конец последнего дня периода ПО АЛМАТЫ, не по UTC и не по поясу сервера", async () => {
	const org = freshOrg();
	invalidateClosedBoundary();
	// Форма хранит periodEnd полуночью UTC последнего дня (31.03 00:00Z).
	const b = await getClosedBoundary(org, mockClient("2026-03-31T00:00:00Z"));
	assert.equal(b.toISOString(), "2026-03-31T18:59:59.999Z"); // 31.03 23:59:59.999 +05
	// Документ 01.04 00:30 по Алматы — уже открытый период.
	await assert.doesNotReject(() => assertPeriodOpen(org, new Date("2026-04-01T00:30:00+05:00"), mockClient("2026-03-31T00:00:00Z")));
	// 31.03 23:30 по Алматы — закрыт.
	await assert.rejects(
		() => assertPeriodOpen(org, new Date("2026-03-31T23:30:00+05:00"), mockClient("2026-03-31T00:00:00Z")),
		(e) => e instanceof PeriodLockedError,
	);
});

test("ошибка БД при чтении границы — отказ, а не «период открыт»", async () => {
	const org = freshOrg();
	invalidateClosedBoundary();
	const broken = { monthClose: { aggregate: async () => { throw new Error("connection lost"); } } };
	await assert.rejects(() => getClosedBoundary(org, broken), /connection lost/);
	await assert.rejects(() => assertPeriodOpen(org, new Date("2026-03-15"), broken), /connection lost/);
	// Ошибка не закэширована: следующий успешный запрос видит настоящую границу.
	const b = await getClosedBoundary(org, mockClient("2026-02-28T00:00:00Z"));
	assert.ok(b instanceof Date);
});
