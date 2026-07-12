// ─────────────────────────────────────────────────────────────────────────────
// Гейт основания: документы-«утверждения» порождают документы «на основании»
// только будучи ПРОВЕДЁННЫМИ.
//
// Инвентаризация и Заявка на закупку не двигают регистры и не дают проводок —
// их проведение означает УТВЕРЖДЕНИЕ. Смысл флагу придаёт именно этот гейт:
//   • инвентаризация утверждена → можно оформить Списание/Оприходование;
//   • заявка утверждена        → можно оформить Заказ поставщику/Закупку.
// ─────────────────────────────────────────────────────────────────────────────
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { prisma } from "../prisma/prisma-client.js";
import { assertBasisExists, BasisNotFoundError, BasisNotPostedError } from "../services/basisValidation.js";

let fx = {};

before(async () => {
	const [org, user, wh] = await Promise.all([
		prisma.organization.findFirst({ select: { uuid: true } }),
		prisma.user.findFirst({ select: { uuid: true } }),
		prisma.warehouse.findFirst({ select: { uuid: true } }),
	]);
	fx = { orgUuid: org?.uuid, userUuid: user?.uuid, warehouseUuid: wh?.uuid };
});

after(async () => {
	await prisma.$disconnect();
});

test("основание-«утверждение»: непроведённое отвергается, проведённое проходит", async (t) => {
	if (!fx.orgUuid || !fx.userUuid) return t.skip("нет фикстур");

	const sc = await prisma.stockCount.create({
		data: {
			number: `ИНВ-Т-${Date.now()}`, date: new Date(), organizationUuid: fx.orgUuid,
			warehouseUuid: fx.warehouseUuid ?? null, authorUuid: fx.userUuid, posted: false,
		},
	});
	const pr = await prisma.purchaseRequisition.create({
		data: {
			number: `ЗАЯВ-Т-${Date.now()}`, date: new Date(), organizationUuid: fx.orgUuid,
			authorUuid: fx.userUuid, posted: false,
		},
	});

	try {
		// НЕ проведены → создать документ на их основании нельзя.
		await assert.rejects(
			() => assertBasisExists("stock_count", sc.uuid),
			(e) => e instanceof BasisNotPostedError,
			"непроведённая инвентаризация не может быть основанием",
		);
		await assert.rejects(
			() => assertBasisExists("purchase_requisition", pr.uuid),
			(e) => e instanceof BasisNotPostedError,
			"непроведённая заявка не может быть основанием",
		);

		// Проведены → основание принимается.
		await prisma.stockCount.update({ where: { uuid: sc.uuid }, data: { posted: true } });
		await prisma.purchaseRequisition.update({ where: { uuid: pr.uuid }, data: { posted: true } });
		await assert.doesNotReject(() => assertBasisExists("stock_count", sc.uuid));
		await assert.doesNotReject(() => assertBasisExists("purchase_requisition", pr.uuid));
	} finally {
		await prisma.stockCount.delete({ where: { uuid: sc.uuid } }).catch(() => {});
		await prisma.purchaseRequisition.delete({ where: { uuid: pr.uuid } }).catch(() => {});
	}
});

test("обычные основания проведения НЕ требуют (гейт не расползается)", async (t) => {
	if (!fx.orgUuid || !fx.userUuid) return t.skip("нет фикстур");
	// Реализация — обычный документ-основание (её проведение и так двигает регистр).
	// Требовать posted для порождения возврата — отдельное решение, здесь НЕ вводим.
	const sale = await prisma.sale.create({
		data: { date: new Date(), organizationUuid: fx.orgUuid, authorUuid: fx.userUuid, posted: false },
	});
	try {
		await assert.doesNotReject(() => assertBasisExists("sale", sale.uuid));
	} finally {
		await prisma.sale.delete({ where: { uuid: sale.uuid } }).catch(() => {});
	}
});

test("несуществующее основание — по-прежнему BasisNotFoundError", async () => {
	await assert.rejects(
		() => assertBasisExists("stock_count", crypto.randomUUID()),
		(e) => e instanceof BasisNotFoundError,
	);
});
