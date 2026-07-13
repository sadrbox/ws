// ─────────────────────────────────────────────────────────────────────────────
// Приём справочников из 1С (POST /pipe → applyPipeReference).
//
// Главный инвариант: ПОВТОРНОЕ событие по тому же элементу и его ПЕРЕИМЕНОВАНИЕ
// в 1С НЕ должны плодить дубли — сопоставление идёт по (externalSource, externalId).
// Второй инвариант: при первой встрече элемент ПРИВЯЗЫВАЕТСЯ к существующей записи
// по естественному ключу (БИН/штрихкод), иначе интеграция продублировала бы весь
// наш справочник.
// ─────────────────────────────────────────────────────────────────────────────
import { test, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { prisma } from "../prisma/prisma-client.js";
import { applyPipeReference } from "../services/pipeReference.js";

after(async () => {
	await prisma.$disconnect();
});

/** Событие 1С в реальном формате (контракт POST /pipe). */
const event = ({ book, id, props, senderBin = "123456789012", actionType = "create" }) => ({
	actionDate: "2026-07-12 12:34:56",
	actionType,
	organization: { shortName: "ООО Пример", bin: senderBin },
	user: { ip: "192.168.1.10", userName: "Иванов", host: "PC-01" },
	object: { id, type: "Справочник", name: book },
	props,
});

const rndBin = () => String(Math.floor(1e11 + Math.random() * 8e11));

test("Номенклатура: создание, затем ПОВТОР и ПЕРЕИМЕНОВАНИЕ не плодят дубли", async () => {
	const extId = `1c-prod-${crypto.randomUUID().slice(0, 8)}`;
	const sku = `SKU-${crypto.randomUUID().slice(0, 8)}`;
	try {
		// 1) Товара нет → создаётся.
		const r1 = await applyPipeReference(event({
			book: "Номенклатура", id: extId,
			props: { Код: sku, Наименование: "Гвоздь 100мм" },
		}));
		assert.equal(r1.status, "created", r1.message);
		assert.equal(r1.model, "product");

		// 2) ТО ЖЕ событие ещё раз → обновление, а НЕ второй товар.
		const r2 = await applyPipeReference(event({
			book: "Номенклатура", id: extId,
			props: { Код: sku, Наименование: "Гвоздь 100мм" },
		}));
		assert.equal(r2.status, "updated");
		assert.equal(r2.uuid, r1.uuid, "повтор события не должен создавать вторую карточку");

		// 3) ПЕРЕИМЕНОВАНИЕ в 1С → та же запись обновляется (ключ — externalId, не имя).
		const r3 = await applyPipeReference(event({
			book: "Номенклатура", id: extId, actionType: "update",
			props: { Код: sku, Наименование: "Гвоздь строительный 100 мм" },
		}));
		assert.equal(r3.status, "updated");
		assert.equal(r3.uuid, r1.uuid, "переименование не должно создавать дубль");

		const fresh = await prisma.product.findUnique({ where: { uuid: r1.uuid } });
		assert.equal(fresh.name, "Гвоздь строительный 100 мм", "1С — источник истины: имя перезаписано");
		assert.equal(fresh.externalSource, "1C");
		assert.equal(fresh.externalId, extId);

		const all = await prisma.product.count({ where: { sku, deletedAt: null } });
		assert.equal(all, 1, "в базе ровно один товар на три события");
	} finally {
		await prisma.product.deleteMany({ where: { externalId: extId } }).catch(() => {});
	}
});

test("Первая встреча ПРИВЯЗЫВАЕТСЯ к существующей записи (не дублирует наш справочник)", async () => {
	const bin = rndBin();
	const extId = `1c-cp-${crypto.randomUUID().slice(0, 8)}`;
	// Контрагент УЖЕ есть у нас (заведён вручную) — externalId ещё не проставлен.
	const existing = await prisma.counterparty.create({ data: { bin, name: "ТОО Ромашка" } });
	try {
		const r = await applyPipeReference(event({
			book: "Контрагенты", id: extId,
			props: { БИН: bin, Наименование: "ТОО Ромашка (1С)" },
		}));
		assert.equal(r.status, "linked", r.message);
		assert.equal(r.uuid, existing.uuid, "должны привязаться к существующему, а не создать нового");

		const fresh = await prisma.counterparty.findUnique({ where: { uuid: existing.uuid } });
		assert.equal(fresh.externalId, extId, "externalId проставлен → повторы больше не дублируют");

		assert.equal(await prisma.counterparty.count({ where: { bin } }), 1, "дубль по БИН не создан");
	} finally {
		await prisma.counterparty.deleteMany({ where: { bin } }).catch(() => {});
	}
});

// Раньше контрагент без БИН не создавался (Counterparty.bin был NOT NULL) — и весь
// справочник из 1С не наполнялся: физлиц и розницу 1С шлёт без БИН. Теперь БИН
// необязателен, обязательно ИМЯ. Подробности — в counterpartyNoBin.test.js.
test("Контрагент без БИН СОЗДАЁТСЯ (1С шлёт физлиц и розницу без БИН)", async () => {
	const r = await applyPipeReference(event({
		book: "Контрагенты", id: `1c-nobin-${crypto.randomUUID().slice(0, 8)}`,
		props: { Наименование: `Без БИН ${crypto.randomUUID().slice(0, 6)}` },
	}));
	assert.equal(r.status, "created", r.message);
	const cp = await prisma.counterparty.findUnique({ where: { uuid: r.uuid } });
	assert.equal(cp.bin, null);
	await prisma.counterparty.delete({ where: { uuid: r.uuid } }).catch(() => {});
});

test("Контрагент без ИМЕНИ не создаётся: событие помечается error, данные не портятся", async () => {
	const r = await applyPipeReference(event({
		book: "Контрагенты", id: `1c-noname-${crypto.randomUUID().slice(0, 8)}`,
		props: { Код: "000000009" },
	}));
	assert.equal(r.status, "error");
	assert.match(r.message, /БИН|Наименование/i);
});

test("Не справочник и неизвестный справочник — skipped (событие всё равно логируется)", async () => {
	const doc = await applyPipeReference({
		object: { id: "1", type: "Документ", name: "РеализацияТоваровУслуг" }, props: {},
	});
	assert.equal(doc.status, "skipped");

	const unknown = await applyPipeReference(event({
		book: "Проекты", id: "x1", props: { Наименование: "Проект" },
	}));
	assert.equal(unknown.status, "skipped");
	assert.match(unknown.message, /не поддерживается/i);
});
