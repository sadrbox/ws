// Исправления учёта по аудиту 26.09 (У2, У5, У6, У7, У8, У9) — ядро проводок на
// мок-клиентах, без БД.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
	reconcileDocumentEntries,
	validatePosting,
	POSTING_RULES,
	PostingValidationError,
	MonthCloseOverlapError,
	respondPostingError,
	entryDateOf,
	filterPostedEntries,
	createCostingContext,
	PAYROLL_ACCOUNTS,
} from "../services/accountingPosting.js";
import { r2 } from "../services/money.js";
import { sortMovements } from "../services/costingReplay.js";

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));
let orgN = 0;
const freshOrg = () => `org-fix-${++orgN}`;

// ─── Мок БД с транзакциями и advisory-локами ─────────────────────────────────
// $transaction: снимок проводок → fn(tx) → при ошибке откат снимка; локи
// pg_advisory_xact_lock эмулируются мьютексом по ключу и снимаются в конце транзакции.
function memDb({ docs = {}, withLocks = true, failCreate = false } = {}) {
	const state = { entries: [] };
	const mutex = new Map(); // key → Promise (хвост очереди)
	const makeTx = (held) => ({
		...(withLocks ? {
			$executeRawUnsafe: async (_sql, ns, key) => {
				const k = `${ns}:${key}`;
				if (held.has(k)) return 1; // повторный вход в свой лок
				const prev = mutex.get(k) ?? Promise.resolve();
				let release;
				const mine = new Promise((r) => { release = r; });
				mutex.set(k, prev.then(() => mine));
				await prev;
				held.set(k, release);
				return 1;
			},
		} : {}),
		accountingEntry: {
			deleteMany: async ({ where }) => {
				await tick(1);
				const before = state.entries.length;
				state.entries = state.entries.filter((e) => !(e.documentType === where.documentType && e.documentUuid === where.documentUuid));
				return { count: before - state.entries.length };
			},
			create: async ({ data }) => {
				if (failCreate) throw new Error("insert failed");
				await tick(1);
				state.entries.push({ ...data });
				return data;
			},
		},
		cashOrder: { findUnique: async ({ where }) => { await tick(5); return docs[where.uuid] ?? null; } },
		organizationAccountingSetting: { findFirst: async () => null },
		productRegister: { findMany: async () => [] },
		chartOfAccount: { findFirst: async ({ where }) => ({ uuid: `acc-${where.code}`, code: where.code, name: where.code }) },
		subkontoType: { findUnique: async () => null },
	});
	const client = {
		$transaction: async (fn) => {
			const held = new Map();
			const snapshot = state.entries.map((e) => ({ ...e }));
			try {
				return await fn(makeTx(held));
			} catch (err) {
				state.entries = snapshot;
				throw err;
			} finally {
				for (const release of held.values()) release();
			}
		},
	};
	return { client, state };
}

const pko = (org, amount = 1000) => ({
	uuid: "pko-1", id: 1, posted: true, deletedAt: null, organizationUuid: org,
	date: new Date("2026-06-10T10:00:00+05:00"), amount, direction: "receipt", operationType: "cash_from_bank",
});

// ─── У2: перепроведение атомарно и сериализовано ─────────────────────────────

test("У2: два параллельных перепроведения ПКО на 1000 дают одну проводку на 1000, а не 2000", async () => {
	const org = freshOrg();
	const { client, state } = memDb({ docs: { "pko-1": pko(org) } });
	await Promise.all([
		reconcileDocumentEntries("cash_receipt_order", "pko-1", client),
		reconcileDocumentEntries("cash_receipt_order", "pko-1", client),
	]);
	assert.equal(state.entries.length, 1);
	assert.equal(state.entries[0].amount, 1000);
});

test("У2: без блокировки тот же мок задваивает — тест чувствителен к локу", async () => {
	const org = freshOrg();
	const { client, state } = memDb({ docs: { "pko-1": pko(org) }, withLocks: false });
	await Promise.all([
		reconcileDocumentEntries("cash_receipt_order", "pko-1", client),
		reconcileDocumentEntries("cash_receipt_order", "pko-1", client),
	]);
	assert.equal(state.entries.length, 2, "мок воспроизводит прежнюю гонку «удалить, потом вставить»");
});

test("У2: сбой вставки — ошибка пробрасывается, прежние проводки остаются (откат)", async () => {
	const org = freshOrg();
	const ok = memDb({ docs: { "pko-1": pko(org, 500) } });
	await reconcileDocumentEntries("cash_receipt_order", "pko-1", ok.client);
	assert.equal(ok.state.entries.length, 1);
	// Тот же state, но вставка падает.
	const broken = memDb({ docs: { "pko-1": pko(org, 700) }, failCreate: true });
	broken.state.entries = ok.state.entries;
	await assert.rejects(() => reconcileDocumentEntries("cash_receipt_order", "pko-1", broken.client), /insert failed/);
	assert.equal(broken.state.entries.length, 1, "откат вернул прежнюю проводку");
	assert.equal(broken.state.entries[0].amount, 500);
});

// ─── У6: закрытие месяца датируется концом периода ───────────────────────────

test("У6: проводки закрытия июня, сделанного 03.07, датируются 30.06 23:59:59.999 по Алматы", () => {
	const doc = {
		organizationUuid: "o", date: new Date("2026-07-03T12:00:00+05:00"),
		periodStart: new Date("2026-06-01T00:00:00Z"), periodEnd: new Date("2026-06-30T00:00:00Z"),
	};
	assert.equal(entryDateOf("month_close", doc).toISOString(), "2026-06-30T18:59:59.999Z");
	// Прочие документы — своей датой.
	assert.equal(entryDateOf("sale", doc), doc.date);
});

test("У5: закрытие июня берёт обороты с 01.06 00:00 по Алматы (документ 01.06 00:30 внутри)", async () => {
	let where = null;
	const ctx = {
		client: {
			accountingEntry: { findMany: async (args) => { where = args.where; return []; } },
			fixedAssetAcceptance: { findMany: async () => [] },
		},
	};
	await POSTING_RULES.month_close({
		organizationUuid: "o",
		periodStart: new Date("2026-06-01T00:00:00Z"), periodEnd: new Date("2026-06-30T00:00:00Z"),
	}, [], ctx);
	const doc = new Date("2026-06-01T00:30:00+05:00");
	assert.ok(where.date.gte <= doc && doc <= where.date.lte, "документ первой ночи месяца — в периоде");
	assert.equal(where.date.gte.toISOString(), "2026-05-31T19:00:00.000Z");
	assert.equal(where.date.lte.toISOString(), "2026-06-30T18:59:59.999Z");
});

function validationClient({ monthCloses = [] } = {}) {
	return {
		organizationAccountingSetting: { findFirst: async () => null },
		productRegister: { findMany: async () => [] },
		chartOfAccount: { findFirst: async ({ where }) => ({ uuid: `acc-${where.code}`, code: where.code }) },
		subkontoType: { findUnique: async () => null },
		accountingEntry: { findMany: async () => [] },
		fixedAssetAcceptance: { findMany: async () => [] },
		monthClose: { findMany: async ({ where }) => monthCloses.filter((m) => !where.uuid || m.uuid !== where.uuid.not) },
	};
}

test("У6: второе проведённое закрытие того же месяца — 409 с понятным текстом", async () => {
	const org = freshOrg();
	const existing = { uuid: "mc-1", number: "ЗМ-1", periodStart: new Date("2026-06-01T00:00:00Z"), periodEnd: new Date("2026-06-30T00:00:00Z") };
	const client = validationClient({ monthCloses: [existing] });
	const second = { uuid: "mc-2", organizationUuid: org, date: new Date(), posted: true, periodStart: existing.periodStart, periodEnd: existing.periodEnd };
	let caught = null;
	try { await validatePosting("month_close", second, [], client); } catch (e) { caught = e; }
	assert.ok(caught instanceof MonthCloseOverlapError);
	assert.match(caught.message, /Период уже закрыт документом «Закрытие месяца» № ЗМ-1/);
	let status = null;
	respondPostingError(caught, { status(s) { status = s; return this; }, json() { return this; } });
	assert.equal(status, 409);
	// Само себя закрытие не пересекает (перепроведение того же документа).
	await assert.doesNotReject(() => validatePosting("month_close", { ...second, uuid: "mc-1" }, [], client));
	// Соседний месяц (июль) не пересекается.
	await assert.doesNotReject(() => validatePosting("month_close", {
		...second, periodStart: new Date("2026-07-01T00:00:00Z"), periodEnd: new Date("2026-07-31T00:00:00Z"),
	}, [], client));
});

// ─── У9: проверки проведения ─────────────────────────────────────────────────

test("У9: Дт=Кт считается по сторонам — проводка без счёта кредита не проходит", async () => {
	POSTING_RULES.__test_broken = () => [{ debit: "1010", credit: null, amount: 5, description: "x", debitAnalytics: [], creditAnalytics: [] }];
	try {
		await assert.rejects(
			() => validatePosting("__test_broken", { organizationUuid: freshOrg(), date: new Date() }, [], validationClient()),
			(e) => e instanceof PostingValidationError && e.errors.some((m) => /без счёта кредита/.test(m)) && e.errors.includes("Дебет не равен кредиту"),
		);
	} finally {
		delete POSTING_RULES.__test_broken;
	}
});

test("У9: отрицательное количество в строках — отказ", async () => {
	await assert.rejects(
		() => validatePosting("write_off", { organizationUuid: freshOrg(), date: new Date() }, [{ productUuid: "p", quantity: -5 }], validationClient()),
		(e) => e instanceof PostingValidationError && e.errors.some((m) => /отрицательным/.test(m)),
	);
});

test("У8/У9: ПКО с нулевой суммой не проводится", async () => {
	await assert.rejects(
		() => validatePosting("cash_receipt_order", { organizationUuid: freshOrg(), date: new Date(), amount: 0 }, [], validationClient()),
		(e) => e instanceof PostingValidationError && e.errors.some((m) => /больше нуля/.test(m)),
	);
});

test("У9: деньги округляются без ошибки float (1.005 → 1.01, 2.675 → 2.68)", () => {
	assert.equal(r2(1.005), 1.01);
	assert.equal(r2(2.675), 2.68);
	assert.equal(r2(-1.005), -1.01);
	assert.equal(r2(100.4999), 100.5);
	assert.equal(Object.is(r2(-0.001), -0), false);
});

// ─── У7: зарплата ────────────────────────────────────────────────────────────

const payroll = {
	organizationUuid: "o", employeeUuid: "emp", date: new Date(), period: "2026-06",
	baseSalary: 300000, opv: 30000, ipn: 20000, vosms: 6000, netSalary: 244000,
	socialContrib: 9450, socialTax: 16200, oosms: 9000, totalExpense: 334650,
};
const payrollCtx = (codes) => ({ resolveAccount: async (code) => (codes.has(code) ? { code } : null) });

test("У7: в плане счетов нет счетов налогов — прежняя одна проводка Дт 7210 Кт 3350", async () => {
	const out = await POSTING_RULES.payroll_calculation(payroll, [], payrollCtx(new Set(["7210", "3350"])));
	assert.equal(out.length, 1);
	assert.equal(out[0].amount, 334650);
});

test("У7: счета есть — удержания и взносы разнесены, 3350 после выплаты к выдаче закрывается в ноль", async () => {
	const codes = new Set(["7210", "3350", ...Object.values(PAYROLL_ACCOUNTS)]);
	const out = await POSTING_RULES.payroll_calculation(payroll, [], payrollCtx(codes));
	let bal3350 = 0; // Кт − Дт
	let exp7210 = 0;
	for (const e of out) {
		if (e.credit === "3350") bal3350 += e.amount;
		if (e.debit === "3350") bal3350 -= e.amount;
		if (e.debit === "7210") exp7210 += e.amount;
	}
	bal3350 -= payroll.netSalary; // выплата Дт 3350 Кт 1030
	assert.equal(r2(bal3350), 0);
	assert.equal(r2(exp7210), payroll.totalExpense, "расход = оклад + СО + СН + ООСМС");
	assert.ok(out.some((e) => e.credit === PAYROLL_ACCOUNTS.ipn && e.amount === 20000));
	assert.ok(out.some((e) => e.credit === PAYROLL_ACCOUNTS.socialTax && e.amount === 16200));
});

// ─── У8: единый порядок движений при равной дате ─────────────────────────────

const mv = (type, movementType, id, qty, amount, t) => ({
	documentType: type, documentId: id, documentUuid: `${type}-${id}`, id, movementType,
	quantity: qty, amount, date: new Date(t),
});

function costingClient(method, rows) {
	return {
		organizationAccountingSetting: { findFirst: async () => ({ costingMethod: method }) },
		productRegister: { findMany: async () => rows },
	};
}

for (const method of ["AVERAGE", "FIFO"]) {
	test(`У8 (${method}): поступление id 500 и продажа id 20 в одну минуту — себестоимость 100, а не 0`, async () => {
		const T = "2026-06-10T10:00:00+05:00";
		const rows = [mv("purchase", "in", 500, 10, 1000, T)];
		const ctx = await createCostingContext("o", new Date(T), { docUuid: "sale-20", docId: 20, docType: "sale" }, costingClient(method, rows));
		const unit = await ctx.unitCost("p", "w", new Date(T), 2, { consume: true });
		assert.equal(r2(unit), 100);
	});
}

test("У8: sortMovements — в один момент приход раньше расхода, дальше тип и id", () => {
	const T = "2026-06-10T10:00:00Z";
	const sorted = sortMovements([
		mv("sale", "out", 20, 1, 0, T),
		mv("write_off", "out", 3, 1, 0, T),
		mv("purchase", "in", 500, 1, 0, T),
		mv("goods_receipt", "in", 7, 1, 0, "2026-06-09T10:00:00Z"),
	]);
	assert.deepEqual(sorted.map((m) => `${m.documentType}:${m.documentId}`), ["goods_receipt:7", "purchase:500", "sale:20", "write_off:3"]);
});

// ─── Чтение проводок без записи ──────────────────────────────────────────────

test("filterPostedEntries только читает: осиротевшие исключаются, но не удаляются на GET", async () => {
	let deleted = false;
	const client = {
		sale: { findMany: async () => [{ uuid: "s1" }] },
		accountingEntry: { deleteMany: async () => { deleted = true; return { count: 1 }; } },
	};
	const out = await filterPostedEntries([
		{ documentType: "sale", documentUuid: "s1" },
		{ documentType: "sale", documentUuid: "s2" }, // не проведена
	], client);
	assert.deepEqual(out.map((e) => e.documentUuid), ["s1"]);
	assert.equal(deleted, false);
});
