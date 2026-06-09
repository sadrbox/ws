// Проверка уникальности штрих-кода номенклатуры.
// Штрих-код должен принадлежать только одному товару: проверяем как
// дополнительные штрих-коды (ProductBarcode), так и основной (Product.barcode).
import { prisma } from "../prisma/prisma-client.js";

/**
 * Возвращает uuid товара, который УЖЕ владеет этим штрих-кодом
 * (кроме exceptProductUuid), либо null если штрих-код свободен.
 * @param {string} barcode
 * @param {string|null} exceptProductUuid — исключить этот товар (своё значение)
 * @param {object} client — prisma или tx
 */
export async function findBarcodeOwner(barcode, exceptProductUuid = null, client = prisma) {
	const bc = String(barcode ?? "").trim();
	if (!bc) return null;
	const notSelf = exceptProductUuid ? { not: exceptProductUuid } : undefined;

	const pb = await client.productBarcode.findFirst({
		where: { barcode: bc, deletedAt: null, ...(notSelf ? { productUuid: notSelf } : {}) },
		select: { productUuid: true },
	});
	if (pb) return pb.productUuid;

	const pr = await client.product.findFirst({
		where: { barcode: bc, deletedAt: null, ...(notSelf ? { uuid: notSelf } : {}) },
		select: { uuid: true },
	});
	if (pr) return pr.uuid;

	return null;
}

/** Бросает ошибку, если штрих-код занят другим товаром. */
export async function assertBarcodeUnique(barcode, exceptProductUuid = null, client = prisma) {
	const owner = await findBarcodeOwner(barcode, exceptProductUuid, client);
	if (owner) {
		const err = new Error(`Штрих-код «${String(barcode).trim()}» уже используется другим товаром`);
		err.code = "BARCODE_DUPLICATE";
		throw err;
	}
}
