// ─────────────────────────────────────────────────────────────────────────────
// Классификация номенклатуры строк ЭСФ (Трек A). В стандарте ЭСФ нет признака
// «это основное средство» — вид определяет покупатель. Механика:
//   • память маппинга (EsfLineMapping): поставщик+ТН ВЭД+наименование → вид+карточка,
//     заполняется при разнесении, переиспользуется при следующем импорте;
//   • эвристика suggestAssetKind — ТОЛЬКО подсказка, финал за пользователем.
// ─────────────────────────────────────────────────────────────────────────────

export const ASSET_KINDS = Object.freeze(["goods", "material", "fixed_asset"]);

/** Нормализованный ключ наименования (регистр/пробелы) — для стабильного matchKey. */
export function normalizeNameKey(name) {
	return String(name ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Единый уникальный ключ маппинга: поставщик|ТН ВЭД|наименование|организация. */
export function buildMatchKey(supplierBin, tnvedCode, nameKey, organizationUuid) {
	return `${supplierBin ?? ""}|${tnvedCode ?? ""}|${nameKey}|${organizationUuid ?? ""}`;
}

/**
 * Подсказка вида актива (НЕ решение). Порог цены за единицу: дороже → предложить
 * ОС, иначе товар. Порог настраивается (учётная политика). Материал руками.
 */
export function suggestAssetKind(line, { fixedAssetPriceThreshold = 300000 } = {}) {
	const qty = Number(line?.quantity) || 0;
	const amount = Number(line?.amount) || 0;
	const unitPrice = Number(line?.price) || (qty > 0 ? amount / qty : amount) || 0;
	return unitPrice >= fixedAssetPriceThreshold ? "fixed_asset" : "goods";
}

/** Найти запомненную классификацию строки (или null). */
export async function resolveMapping(client, { supplierBin, tnvedCode, name, organizationUuid }) {
	const nameKey = normalizeNameKey(name);
	const matchKey = buildMatchKey(supplierBin, tnvedCode, nameKey, organizationUuid);
	return client.esfLineMapping.findUnique({ where: { matchKey } });
}

/** Запомнить классификацию строки (upsert по matchKey) — для будущих импортов. */
export async function rememberMapping(client, { supplierBin, tnvedCode, name, organizationUuid, assetKind, productUuid = null, fixedAssetUuid = null }) {
	const nameKey = normalizeNameKey(name);
	const matchKey = buildMatchKey(supplierBin, tnvedCode, nameKey, organizationUuid);
	return client.esfLineMapping.upsert({
		where: { matchKey },
		create: {
			matchKey, supplierBin: supplierBin ?? "", tnvedCode: tnvedCode ?? null, nameKey,
			organizationUuid: organizationUuid ?? null, assetKind, productUuid, fixedAssetUuid,
		},
		update: { assetKind, productUuid, fixedAssetUuid },
	});
}

export default { ASSET_KINDS, normalizeNameKey, buildMatchKey, suggestAssetKind, resolveMapping, rememberMapping };
