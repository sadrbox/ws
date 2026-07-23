// Возврат ОТ ПОКУПАТЕЛЯ: реинстейт ранее проданных серий (T6.1).
// Проверяем именно то, чем возврат отличается от приёмки: серия не создаётся
// заново, а возвращается из issued в in_stock, и выбор идемпотентно пересобирается.
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { prisma } from "../prisma/prisma-client.js";
import {
	setReceiptSerials, issueSerials, reinstateSerials, countReturnedSerials,
	SERIAL_STATUS, SERIAL_RETURN_DOCS,
} from "../services/serialNumbers.js";

test("sale_return входит в набор возвратных документов", () => {
	assert.ok(SERIAL_RETURN_DOCS.has("sale_return"));
});

test("реинстейт: проданная серия возвращается на склад, непроданная — нет", async (t) => {
	const org = await prisma.organization.findFirst({ select: { uuid: true } });
	if (!org) return t.skip("нет организации");
	const wh = await prisma.warehouse.findFirst({ select: { uuid: true } });
	const product = await prisma.product.create({
		data: { name: `SN-RET-${crypto.randomUUID().slice(0, 8)}`, trackSerialNumbers: true },
	});
	const rcUuid = crypto.randomUUID();
	const saleUuid = crypto.randomUUID();
	const retUuid = crypto.randomUUID();
	try {
		// Приняли 3 серии, две продали.
		await setReceiptSerials({
			docType: "goods_receipt", docUuid: rcUuid, productUuid: product.uuid,
			organizationUuid: org.uuid, serials: ["R1", "R2", "R3"],
		});
		const all = await prisma.serialNumber.findMany({
			where: { receiptDocUuid: rcUuid }, orderBy: { serialNumber: "asc" },
		});
		const [r1, r2, r3] = all;
		await issueSerials({ docType: "sale", docUuid: saleUuid, serialUuids: [r1.uuid, r2.uuid] });

		// Возвращаем проданную R1 и пытаемся вернуть НЕпроданную R3.
		const count = await reinstateSerials({
			docUuid: retUuid, serialUuids: [r1.uuid, r3.uuid],
			warehouseUuid: wh?.uuid ?? null, originIssueDocUuid: saleUuid,
		});
		assert.equal(count, 1, "вернулась только реально проданная серия");

		const afterR1 = await prisma.serialNumber.findUnique({ where: { uuid: r1.uuid } });
		assert.equal(afterR1.status, SERIAL_STATUS.IN_STOCK, "R1 снова на складе");
		assert.equal(afterR1.issueDocUuid, retUuid, "связь с документом возврата");

		const afterR3 = await prisma.serialNumber.findUnique({ where: { uuid: r3.uuid } });
		assert.equal(afterR3.status, SERIAL_STATUS.IN_STOCK);
		assert.equal(afterR3.issueDocUuid, null, "непроданную серию возврат не тронул");

		// Счётчик возвращённых по документу.
		assert.equal((await countReturnedSerials(retUuid)).get(product.uuid), 1);
	} finally {
		await prisma.serialNumber.deleteMany({ where: { productUuid: product.uuid } });
		await prisma.product.delete({ where: { uuid: product.uuid } });
	}
});

test("реинстейт идемпотентен: снятая из списка серия снова считается проданной", async (t) => {
	const org = await prisma.organization.findFirst({ select: { uuid: true } });
	if (!org) return t.skip("нет организации");
	const product = await prisma.product.create({
		data: { name: `SN-RET2-${crypto.randomUUID().slice(0, 8)}`, trackSerialNumbers: true },
	});
	const rcUuid = crypto.randomUUID();
	const saleUuid = crypto.randomUUID();
	const retUuid = crypto.randomUUID();
	try {
		await setReceiptSerials({
			docType: "goods_receipt", docUuid: rcUuid, productUuid: product.uuid,
			organizationUuid: org.uuid, serials: ["Q1", "Q2"],
		});
		const all = await prisma.serialNumber.findMany({
			where: { receiptDocUuid: rcUuid }, orderBy: { serialNumber: "asc" },
		});
		const [q1, q2] = all;
		await issueSerials({ docType: "sale", docUuid: saleUuid, serialUuids: [q1.uuid, q2.uuid] });

		// Сначала вернули обе.
		assert.equal(await reinstateSerials({
			docUuid: retUuid, serialUuids: [q1.uuid, q2.uuid], originIssueDocUuid: saleUuid,
		}), 2);
		assert.equal((await countReturnedSerials(retUuid)).get(product.uuid), 2);

		// Пересобрали выбор: осталась только Q1 — Q2 должна снова стать проданной.
		assert.equal(await reinstateSerials({
			docUuid: retUuid, serialUuids: [q1.uuid], originIssueDocUuid: saleUuid,
		}), 1);
		assert.equal((await countReturnedSerials(retUuid)).get(product.uuid), 1);

		const afterQ2 = await prisma.serialNumber.findUnique({ where: { uuid: q2.uuid } });
		assert.equal(afterQ2.status, SERIAL_STATUS.ISSUED, "Q2 снова выбывшая");
		assert.equal(afterQ2.issueDocUuid, saleUuid, "ссылка вернулась на исходную реализацию");
	} finally {
		await prisma.serialNumber.deleteMany({ where: { productUuid: product.uuid } });
		await prisma.product.delete({ where: { uuid: product.uuid } });
	}
});
