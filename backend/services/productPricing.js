// ─────────────────────────────────────────────────────────────────────────────
// Денормализация текущих цен товара из документов «Установка цен номенклатуры».
//
// Текущие цены Product (price/purchasePrice/wholesalePrice) = значения из
// ПОСЛЕДНЕГО по дате ПРОВЕДЁННОГО (posted, !deleted) документа установки цен,
// содержащего этот товар. Пересчитывается при проведении/правке/удалении
// документа. Если проведённых документов по товару нет — цены не трогаем.
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "../prisma/prisma-client.js";

/** Пересчитывает текущие цены указанных товаров из проведённых документов. */
export async function reconcileProductPrices(productUuids, client = prisma) {
	const uuids = [...new Set((productUuids || []).filter(Boolean))];
	for (const productUuid of uuids) {
		try {
			const items = await client.productPriceSettingItem.findMany({
				where: { productUuid, deletedAt: null, priceSetting: { posted: true, deletedAt: null } },
				select: {
					salePrice: true, purchasePrice: true, wholesalePrice: true,
					priceSetting: { select: { date: true } },
				},
			});
			if (!items.length) continue;
			items.sort((a, b) => new Date(b.priceSetting.date) - new Date(a.priceSetting.date));
			const it = items[0];
			await client.product.update({
				where: { uuid: productUuid },
				data: { price: it.salePrice, purchasePrice: it.purchasePrice, wholesalePrice: it.wholesalePrice },
			});
		} catch (err) {
			console.error(`reconcileProductPrices(${productUuid}) error:`, err);
		}
	}
}

/** Пересчитывает цены товаров, входящих в документ установки цен. */
export async function reconcilePricesForDoc(priceSettingUuid, client = prisma) {
	if (!priceSettingUuid) return;
	try {
		const items = await client.productPriceSettingItem.findMany({
			where: { priceSettingUuid },
			select: { productUuid: true },
		});
		await reconcileProductPrices(items.map((i) => i.productUuid), client);
	} catch (err) {
		console.error(`reconcilePricesForDoc(${priceSettingUuid}) error:`, err);
	}
}

export default { reconcileProductPrices, reconcilePricesForDoc };
