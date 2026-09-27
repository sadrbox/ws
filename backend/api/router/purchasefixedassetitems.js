// Строки табличной части «Основные средства» документа Поступление (Purchase).
// Контракт как у прочих *items: GET ?purchaseUuid=… (список) + POST /batch
// (operations: create/update/delete). НДС считается «в том числе» из amount+vatRate.
//
// Аудит 26.09 (У8): раньше пакет строк ОС писался без проверки владельца и периода, не
// пересобирал проводки (при первом сохранении проведённого поступления проводок Дт 2410
// не было), не трогал сумму шапки (она — только ТМЗ), а update без полей обнулял сумму и
// организацию строки. Теперь: владелец поступления и открытый период; строки ОС + сумма
// шапки (ТМЗ + ОС) + проводки поступления — одной транзакцией под блокировкой документа;
// update — поверх текущих значений строки.
import express from "express";
import { prisma } from "../../prisma/prisma-client.js";
import { checkOwnership } from "../../utils/auth.js";
import { assertPeriodOpen, respondPeriodLockError } from "../../services/periodLock.js";
import { reconcileDocumentEntries } from "../../services/accountingPosting.js";
import { lockDocument, POSTING_TX_OPTIONS } from "../../services/documentLock.js";
import { r2 } from "../../services/money.js";

const MODEL = "purchaseFixedAssetItem";
const ROUTE = "purchasefixedassetitems";

/** НДС «в том числе»: из суммы с НДС и ставки → (без НДС, НДС). */
function splitVat(amount, vatRate) {
	const amt = r2(amount);
	const rate = Number(vatRate) || 0;
	const net = rate > 0 ? r2(amt / (1 + rate / 100)) : amt;
	return { amountWithoutVat: net, vatAmount: r2(amt - net) };
}

/** Готовит данные строки из payload поверх текущих значений (для update — existing). */
export function buildData(d, existing = null, purchase = null) {
	const pick = (f, def) => (d[f] !== undefined ? d[f] : existing ? existing[f] : def);
	const amount = r2(pick("amount", 0));
	const rawRate = pick("vatRate", 12);
	const vatRate = rawRate != null ? Number(rawRate) : 12;
	const { amountWithoutVat, vatAmount } = splitVat(amount, vatRate);
	return {
		purchaseUuid: existing?.purchaseUuid ?? d.purchaseUuid,
		fixedAssetUuid: pick("fixedAssetUuid", null) || null,
		fixedAssetName: (pick("fixedAssetName", null)?.trim?.() ?? pick("fixedAssetName", null)) || null,
		amount,
		vatRate,
		amountWithoutVat,
		vatAmount,
		sourceRowId: pick("sourceRowId", null) || null,
		// Организация строки — организация поступления, а не то, что прислал клиент.
		organizationUuid: purchase?.organizationUuid ?? existing?.organizationUuid ?? null,
	};
}

/** Отказ в данных строки ОС (→ 422). */
class FixedAssetLineError extends Error {}

export function createPurchaseFixedAssetItemsRouter({ client = prisma } = {}) {
	const router = express.Router();
	const db = client;

	/** Поступление пользователя (404, если чужое/нет). write — ещё и открытый период (423). */
	async function ownedPurchase(purchaseUuid, req, res, { write = false } = {}) {
		const purchase = purchaseUuid
			? await db.purchase.findUnique({ where: { uuid: purchaseUuid }, select: { uuid: true, organizationUuid: true, date: true } })
			: null;
		if (!purchase || !checkOwnership(purchase, req)) {
			res.status(404).json({ success: false, message: "Документ не найден" });
			return null;
		}
		if (write) {
			try {
				await assertPeriodOpen(purchase.organizationUuid, purchase.date, db);
			} catch (err) {
				if (respondPeriodLockError(err, res)) return null;
				throw err;
			}
		}
		return purchase;
	}

	// Сумма шапки поступления = строки ТМЗ + строки ОС.
	async function recalcPurchaseTotals(purchaseUuid, tx) {
		// Последовательно — внутри транзакции (одно соединение).
		const tmz = await tx.purchaseItem.aggregate({ where: { purchaseUuid }, _sum: { amount: true, vatAmount: true, discountAmount: true } });
		const fa = await tx[MODEL].aggregate({ where: { purchaseUuid, deletedAt: null }, _sum: { amount: true, vatAmount: true } });
		const amount = r2((Number(tmz._sum.amount) || 0) + (Number(fa._sum.amount) || 0));
		const vatAmount = r2((Number(tmz._sum.vatAmount) || 0) + (Number(fa._sum.vatAmount) || 0));
		await tx.purchase.update({
			where: { uuid: purchaseUuid },
			data: { amount, vatAmount, discountAmount: r2(Number(tmz._sum.discountAmount) || 0), amountWithoutVat: r2(amount - vatAmount) },
		});
	}

	// GET /purchasefixedassetitems?purchaseUuid=…
	router.get(`/${ROUTE}`, async (req, res) => {
		try {
			const purchaseUuid = typeof req.query.purchaseUuid === "string" ? req.query.purchaseUuid : "";
			if (!purchaseUuid) return res.json({ success: true, items: [], total: 0 });
			if (!(await ownedPurchase(purchaseUuid, req, res))) return;
			const items = await db[MODEL].findMany({
				where: { purchaseUuid, deletedAt: null },
				orderBy: [{ id: "asc" }],
			});
			return res.json({ success: true, items, total: items.length });
		} catch (err) {
			console.error(`GET /${ROUTE} error:`, err);
			return res.status(500).json({ success: false, message: "Ошибка сервера" });
		}
	});

	// POST /purchasefixedassetitems/batch  { operations: [{action, data|uuid}] }
	router.post(`/${ROUTE}/batch`, async (req, res) => {
		try {
			const ops = Array.isArray(req.body?.operations) ? req.body.operations : [];
			if (!ops.length) return res.json({ success: true });

			// Все затронутые поступления: create — по data, update/delete — по строке.
			const refUuids = ops.filter((op) => (op.action === "update" || op.action === "delete") && op.uuid).map((op) => op.uuid);
			const refRows = refUuids.length
				? await db[MODEL].findMany({ where: { uuid: { in: refUuids } }, select: { uuid: true, purchaseUuid: true } })
				: [];
			const purchaseUuids = new Set([
				...ops.filter((op) => op.action === "create" && op.data?.purchaseUuid).map((op) => op.data.purchaseUuid),
				...refRows.map((r) => r.purchaseUuid).filter(Boolean),
			]);
			const purchases = new Map();
			for (const pu of purchaseUuids) {
				const p = await ownedPurchase(pu, req, res, { write: true });
				if (!p) return;
				purchases.set(pu, p);
			}
			for (const op of ops) {
				if ((op.action === "create" || op.action === "update") && op.data?.amount != null && Number(op.data.amount) < 0) {
					throw new FixedAssetLineError("Сумма основного средства не может быть отрицательной");
				}
			}

			const sorted = [...purchaseUuids].sort();
			await db.$transaction(async (tx) => {
				for (const pu of sorted) await lockDocument(tx, "purchase", pu);
				for (const op of ops) {
					if (op.action === "create" && op.data?.purchaseUuid) {
						await tx[MODEL].create({ data: buildData(op.data, null, purchases.get(op.data.purchaseUuid)) });
					} else if (op.action === "update" && op.uuid) {
						const existing = await tx[MODEL].findUnique({ where: { uuid: op.uuid } });
						if (!existing) continue;
						await tx[MODEL].update({ where: { uuid: op.uuid }, data: buildData(op.data ?? {}, existing, purchases.get(existing.purchaseUuid)) });
					} else if (op.action === "delete" && op.uuid) {
						await tx[MODEL].deleteMany({ where: { uuid: op.uuid } });
					}
				}
				for (const pu of sorted) {
					await recalcPurchaseTotals(pu, tx);
					// Проводки поступления (Дт 2410 по ОС) — вместе со строками.
					await reconcileDocumentEntries("purchase", pu, tx);
				}
			}, POSTING_TX_OPTIONS);
			return res.json({ success: true });
		} catch (err) {
			if (err instanceof FixedAssetLineError) return res.status(422).json({ success: false, message: err.message });
			if (respondPeriodLockError(err, res)) return;
			console.error(`POST /${ROUTE}/batch error:`, err);
			return res.status(500).json({ success: false, message: "Ошибка сервера" });
		}
	});

	return router;
}

export default createPurchaseFixedAssetItemsRouter();
