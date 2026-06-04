// ─────────────────────────────────────────────────────────────────────────────
// Денормализация текущей цены продажи товара из вкладки «Цены» (ProductPrice).
//
// Product.price = последняя по дате (date <= now) цена товара по типу,
// помеченному как «по умолчанию» (PriceType.isDefault). Используется терминалом
// и автоподстановкой в строки продаж. Пересчитывается при изменении цен товара.
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "../prisma/prisma-client.js";

/** Пересчитывает Product.price из актуальной цены типа «по умолчанию». */
export async function reconcileProductPrice(productUuids, client = prisma) {
	const uuids = [...new Set((productUuids || []).filter(Boolean))];
	if (!uuids.length) return;
	const def = await client.priceType.findFirst({ where: { isDefault: true, deletedAt: null }, select: { uuid: true } });
	if (!def) return;
	const now = new Date();
	for (const productUuid of uuids) {
		try {
			const row = await client.productPrice.findFirst({
				where: { productUuid, priceTypeUuid: def.uuid, deletedAt: null, date: { lte: now } },
				orderBy: { date: "desc" },
				select: { price: true },
			});
			if (row) await client.product.update({ where: { uuid: productUuid }, data: { price: row.price } });
		} catch (err) {
			console.error(`reconcileProductPrice(${productUuid}) error:`, err);
		}
	}
}

export default { reconcileProductPrice };
