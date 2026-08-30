// ─────────────────────────────────────────────────────────────────────────────
// Импорт входящего ЭСФ → документ «Поступление» (Трек B).
//
// Разносит строки входящего ЭСФ по ТМЗ/ОС (классификация: overrides мастера →
// поле строки → память маппинга → эвристика), делает find-or-create справочников
// (Contractor по БИН, Product по ТН ВЭД+наименованию, FixedAsset по наименованию —
// это T7.14: единый резолвер, чтобы не плодить дубли), собирает Purchase +
// purchaseItems (ТМЗ) + purchaseFixedAssetItems (ОС). Суммы ОС уже вливаются в итог
// и проводятся на 2410 (см. accountingPosting.purchase). Помечает inbound как processed.
//
// Урок 1С (H1): если контрагент/товар не найден — НЕ оставляем null, а создаём и
// ЗАПОМИНАЕМ (rememberMapping), чтобы связанные документы сделки не рвались.
// ─────────────────────────────────────────────────────────────────────────────
import { ensureDocumentNumber } from "../documentNumberAssign.js";
import { resolveMapping, rememberMapping, suggestAssetKind } from "./classification.js";
import {
	createResolverContext,
	resolveCounterpartyByBin,
	resolveOrCreateProduct,
	resolveOrCreateFixedAsset,
} from "./resolver.js";

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Резолверы справочников вынесены в общий модуль (T7.14): единый кэш на сделку для
// ЭСФ+СНТ+ЭАВР. Реэкспортируем чистые функции для обратной совместимости.
export { resolveCounterpartyByBin, resolveOrCreateProduct, resolveOrCreateFixedAsset };

/** Итоговый вид строки: overrides мастера → поле строки → память → подсказка. */
export function decideAssetKind(line, override, mapping) {
	return override?.assetKind || line.assetKind || mapping?.assetKind || suggestAssetKind(line);
}

/**
 * Собрать Поступление из входящего ЭСФ.
 * @param {object} client — prisma (или транзакция)
 * @param {string} inboundUuid
 * @param {object} p
 * @param {string} p.authorUuid — обязателен (Purchase.authorUuid NOT NULL)
 * @param {Record<string, {assetKind?:string, productUuid?:string, fixedAssetUuid?:string}>} [p.overrides] — по uuid строки
 * @returns {Promise<{purchaseUuid, purchaseId?, productCount, fixedAssetCount, alreadyProcessed?}>}
 */
export async function buildPurchaseFromInbound(client, inboundUuid, { authorUuid, overrides = {} } = {}) {
	if (!authorUuid) throw new Error("authorUuid обязателен (автор Поступления)");
	const inbound = await client.esfInbound.findUnique({ where: { uuid: inboundUuid }, include: { lines: true } });
	if (!inbound) throw new Error("Входящий ЭСФ не найден");
	if (inbound.status === "processed" && inbound.processedPurchaseUuid) {
		return { purchaseUuid: inbound.processedPurchaseUuid, productCount: 0, fixedAssetCount: 0, alreadyProcessed: true };
	}

	const org = inbound.organizationUuid;
	const resolver = createResolverContext(client, { organizationUuid: org }); // общий кэш сделки (T7.14)
	const counterparty = await resolver.counterpartyByBin({ bin: inbound.supplierBin, name: inbound.supplierName });
	const date = inbound.invoiceDate || new Date();
	const number = await ensureDocumentNumber({ docType: "purchase", modelName: "purchase", organizationUuid: org, date }, client);

	// Итог документа = ТМЗ + ОС (= кредит 3310), согласовано с проводками покупки.
	const total = inbound.lines.reduce((s, l) => s + Number(l.amount || 0), 0);
	const vatTotal = inbound.lines.reduce((s, l) => s + Number(l.vatAmount || 0), 0);

	const purchase = await client.purchase.create({
		data: {
			number, date, authorUuid,
			counterpartyUuid: counterparty.uuid, organizationUuid: org,
			amount: round2(total), vatAmount: round2(vatTotal), amountWithoutVat: round2(total - vatTotal),
			posted: false,
		},
	});

	const productItems = [];
	const faItems = [];
	for (const line of inbound.lines) {
		const ov = overrides[line.uuid] || {};
		const mapping = await resolveMapping(client, { supplierBin: inbound.supplierBin, tnvedCode: line.tnvedCode, name: line.name, organizationUuid: org });
		const assetKind = decideAssetKind(line, ov, mapping);

		if (assetKind === "fixed_asset") {
			const fixedAssetUuid = ov.fixedAssetUuid
				|| await resolver.fixedAsset({ line, mapping });
			faItems.push({
				purchaseUuid: purchase.uuid, fixedAssetUuid, fixedAssetName: line.name,
				amount: round2(line.amount), amountWithoutVat: round2(line.amountWithoutVat),
				vatRate: Number(line.vatRate), vatAmount: round2(line.vatAmount), organizationUuid: org,
			});
			await rememberMapping(client, { supplierBin: inbound.supplierBin, tnvedCode: line.tnvedCode, name: line.name, organizationUuid: org, assetKind: "fixed_asset", fixedAssetUuid });
		} else {
			const productUuid = ov.productUuid
				|| await resolver.product({ line: { ...line, assetKind }, mapping });
			productItems.push({
				purchaseUuid: purchase.uuid, productUuid,
				quantity: Number(line.quantity), price: Number(line.price),
				amount: round2(line.amount), amountWithoutVat: round2(line.amountWithoutVat),
				vatRate: Number(line.vatRate), vatAmount: round2(line.vatAmount), date, organizationUuid: org,
			});
			await rememberMapping(client, { supplierBin: inbound.supplierBin, tnvedCode: line.tnvedCode, name: line.name, organizationUuid: org, assetKind, productUuid });
		}
	}

	if (productItems.length) await client.purchaseItem.createMany({ data: productItems });
	if (faItems.length) await client.purchaseFixedAssetItem.createMany({ data: faItems });

	await client.esfInbound.update({ where: { uuid: inboundUuid }, data: { status: "processed", processedPurchaseUuid: purchase.uuid } });
	return { purchaseUuid: purchase.uuid, purchaseId: purchase.id, productCount: productItems.length, fixedAssetCount: faItems.length };
}

export default { resolveCounterpartyByBin, resolveOrCreateProduct, resolveOrCreateFixedAsset, buildPurchaseFromInbound };
