// ─────────────────────────────────────────────────────────────────────────────
// Контрагент БЕЗ БИН.
//
// 1С шлёт контрагентов (физлица, розница) без БИН, а Counterparty.bin был NOT NULL —
// такие события отбивались с «Не хватает обязательных реквизитов», и справочник из 1С
// не наполнялся вовсе. Теперь БИН необязателен.
//
// У ОРГАНИЗАЦИИ БИН остаётся обязательным: по нему определяется, к какой организации
// относится входящее событие.
// ─────────────────────────────────────────────────────────────────────────────
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { prisma } from "../prisma/prisma-client.js";
import { applyPipeReference } from "../services/pipeReference.js";

let orgBin = null;
const created = [];

before(async () => {
	const org = await prisma.organization.findFirst({ select: { bin: true } });
	orgBin = org?.bin ?? null;
});

after(async () => {
	if (created.length) {
		await prisma.counterparty.deleteMany({ where: { uuid: { in: created } } }).catch(() => {});
	}
	await prisma.$disconnect();
});

const event = (props, id) => ({
	actionDate: "13.07.2026 23:22:04",
	actionType: "update",
	organization: { bin: orgBin, shortName: "Тест" },
	object: { id, type: "Справочник", name: "Контрагенты" },
	props,
});

test("контрагент из 1С БЕЗ БИН создаётся (раньше — «не хватает реквизитов»)", async (t) => {
	if (!orgBin) return t.skip("нет организации");
	const tag = crypto.randomUUID().slice(0, 8);

	const r = await applyPipeReference(event({ Наименование: `Физлицо-${tag}` }, `1c-nobin-${tag}`));
	assert.equal(r.status, "created", r.message);
	created.push(r.uuid);

	const cp = await prisma.counterparty.findUnique({ where: { uuid: r.uuid } });
	assert.equal(cp.bin, null, "БИН пустой — и это нормально");
	assert.equal(cp.name, `Физлицо-${tag}`);
});

test("НЕСКОЛЬКО контрагентов без БИН сосуществуют (@unique не мешает: NULL не уникален)", async (t) => {
	if (!orgBin) return t.skip("нет организации");
	const tag = crypto.randomUUID().slice(0, 8);

	const a = await applyPipeReference(event({ Наименование: `Иванов-${tag}` }, `1c-a-${tag}`));
	const b = await applyPipeReference(event({ Наименование: `Петров-${tag}` }, `1c-b-${tag}`));
	created.push(a.uuid, b.uuid);

	assert.equal(a.status, "created", a.message);
	assert.equal(b.status, "created", b.message);
	assert.notEqual(a.uuid, b.uuid);
});

test("повтор события про того же контрагента не плодит дубль (сопоставление по externalId)", async (t) => {
	if (!orgBin) return t.skip("нет организации");
	const tag = crypto.randomUUID().slice(0, 8);
	const id = `1c-dup-${tag}`;

	const first = await applyPipeReference(event({ Наименование: `Сидоров-${tag}` }, id));
	const again = await applyPipeReference(event({ Наименование: `Сидоров-${tag} (уточнён)` }, id));
	created.push(first.uuid);

	assert.equal(first.status, "created");
	assert.equal(again.status, "updated", "тот же externalId → обновление, а не второй контрагент");
	assert.equal(again.uuid, first.uuid);

	const cp = await prisma.counterparty.findUnique({ where: { uuid: first.uuid } });
	assert.equal(cp.name, `Сидоров-${tag} (уточнён)`, "1С — источник истины");
});

test("без БИН привязываемся к существующему по ИМЕНИ, а не создаём двойника", async (t) => {
	if (!orgBin) return t.skip("нет организации");
	const tag = crypto.randomUUID().slice(0, 8);
	const org = await prisma.organization.findFirst({ where: { bin: orgBin }, select: { uuid: true } });

	// Контрагент, заведённый вручную (без БИН, без externalId).
	const manual = await prisma.counterparty.create({
		data: { name: `Ручной-${tag}`, organizationUuid: org.uuid },
	});
	created.push(manual.uuid);

	const r = await applyPipeReference(event({ Наименование: `Ручной-${tag}` }, `1c-link-${tag}`));
	assert.equal(r.status, "linked", "интеграция должна ПРИВЯЗАТЬСЯ, а не продублировать справочник");
	assert.equal(r.uuid, manual.uuid);
});

test("контрагент без имени по-прежнему не создаётся — он бессмыслен", async (t) => {
	if (!orgBin) return t.skip("нет организации");
	const r = await applyPipeReference(event({ Код: "000000009" }, `1c-noname-${crypto.randomUUID().slice(0, 8)}`));
	assert.equal(r.status, "error");
});
