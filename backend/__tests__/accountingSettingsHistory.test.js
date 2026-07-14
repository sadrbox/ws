// ─────────────────────────────────────────────────────────────────────────────
// Параметры учёта версионируются: документ считается по версии, ДЕЙСТВОВАВШЕЙ НА ЕГО ДАТУ.
//
// Было сломано: сохранение помечало прошлые версии deletedAt, а расчёт фильтровал
// deletedAt IS NULL — история вычищалась. На дату документа не находилось ни одной
// версии → подставлялся дефолт, и прошлые периоды пересчитывались по НОВЫМ правилам:
// переключение на ФИФО переписывало себестоимость закрытых периодов, а снятие галки
// «плательщик НДС» убирало НДС из уже сданных реализаций.
// ─────────────────────────────────────────────────────────────────────────────
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { prisma } from "../prisma/prisma-client.js";
import { getSettingsAt } from "../services/accountingSettings.js";
import { resolveCostingMethod, resolveUseVat } from "../services/accountingPosting.js";

let orgUuid = null;
const ids = [];

before(async () => {
	const org = await prisma.organization.create({
		data: { name: `Учёт-тест ${crypto.randomUUID().slice(0, 6)}`, bin: String(Math.floor(1e11 + Math.random() * 8e11)) },
		select: { uuid: true },
	});
	orgUuid = org.uuid;

	// Учётная политика менялась: с 01.01 — ФИФО и НДС; с 01.06 — средняя, без НДС.
	const a = await prisma.organizationAccountingSetting.create({
		data: { organizationUuid: orgUuid, startDate: new Date("2026-01-01"), costingMethod: "FIFO", useVat: true, vatRate: 12 },
	});
	const b = await prisma.organizationAccountingSetting.create({
		data: { organizationUuid: orgUuid, startDate: new Date("2026-06-01"), costingMethod: "AVERAGE", useVat: false, vatRate: 0 },
	});
	ids.push(a.id, b.id);
});

after(async () => {
	await prisma.organizationAccountingSetting.deleteMany({ where: { id: { in: ids } } }).catch(() => {});
	await prisma.organization.delete({ where: { uuid: orgUuid } }).catch(() => {});
	await prisma.$disconnect();
});

test("документ ПРОШЛОГО периода считается по версии, действовавшей тогда", async () => {
	assert.equal(await resolveCostingMethod(orgUuid, "2026-03-15"), "FIFO",
		"март — период ФИФО; иначе переключение на среднюю переписало бы закрытый период");
	assert.equal(await resolveUseVat(orgUuid, "2026-03-15"), true,
		"в марте организация была плательщиком НДС — снятие галки сейчас не должно это менять");
});

test("документ ТЕКУЩЕГО периода — по новой версии", async () => {
	assert.equal(await resolveCostingMethod(orgUuid, "2026-07-10"), "AVERAGE");
	assert.equal(await resolveUseVat(orgUuid, "2026-07-10"), false);
});

test("без даты — последняя версия", async () => {
	assert.equal(await resolveCostingMethod(orgUuid), "AVERAGE");
	assert.equal(await resolveUseVat(orgUuid), false);
});

test("документ СТАРШЕ первой версии — берём самую раннюю, а не дефолт", async () => {
	// Организация вела учёт и до того, как параметры завели в системе: первая версия
	// описывает именно её политику. Дефолт «AVERAGE» тут был бы выдумкой.
	assert.equal(await resolveCostingMethod(orgUuid, "2025-12-01"), "FIFO");
});

test("несколько версий с ОДНОЙ датой начала → берём последнюю созданную (тай-брейк по id)", async () => {
	// Правку сделали в тот же день: startDate одинаковый, порядок по нему не определён.
	const same = await prisma.organizationAccountingSetting.create({
		data: { organizationUuid: orgUuid, startDate: new Date("2026-06-01"), costingMethod: "FIFO", useVat: true, vatRate: 12 },
	});
	ids.push(same.id);

	const s = await getSettingsAt(orgUuid, "2026-07-10");
	assert.equal(s.id, same.id, "должна выиграть последняя созданная версия");
	assert.equal(await resolveCostingMethod(orgUuid, "2026-07-10"), "FIFO");
});

test("реально УДАЛЁННАЯ настройка (deletedAt) в расчёт не идёт", async () => {
	const del = await prisma.organizationAccountingSetting.create({
		data: { organizationUuid: orgUuid, startDate: new Date("2026-06-15"), costingMethod: "AVERAGE", useVat: false, vatRate: 0, deletedAt: new Date() },
	});
	ids.push(del.id);

	const s = await getSettingsAt(orgUuid, "2026-07-10");
	assert.notEqual(s.id, del.id, "deletedAt теперь означает именно удаление, а не архив");
});
