// ─────────────────────────────────────────────────────────────────────────────
// T7.14 (H2) — единый резолвер справочников для импортов ОДНОЙ сделки.
//
// find-or-create контрагента (по БИН), номенклатуры (по ТН ВЭД+наименованию) и
// ОС (по наименованию). Три импорта одной сделки — ЭСФ, СНТ, ЭАВР — часто ссылаются
// на один и тот же товар/контрагента; без общего кэша каждый импорт заново делал бы
// find-or-create и мог плодить дубли (или лишние SELECT'ы). `createResolverContext`
// даёт контекст с общим кэшем: один БИН/товар/ОС резолвится ОДИН раз за сделку и
// переиспользуется всеми импортами. Кэшируем промис (in-flight) — дедуп и при
// параллельном разносе строк.
//
// Урок 1С (H1): если справочник не найден — НЕ оставляем null, а создаём, чтобы
// связанные документы сделки не рвались. Адресный маппинг (overrides/EsfLineMapping)
// идёт мимо кэша: он точечный по строке, кэш — по «естественному ключу» строки.
// ─────────────────────────────────────────────────────────────────────────────

/** Контрагент по БИН, иначе создаём минимального (find-or-create). */
export async function resolveCounterpartyByBin(client, { bin, name, organizationUuid }) {
	if (bin) {
		const found = await client.counterparty.findFirst({ where: { bin, deletedAt: null } });
		if (found) return found;
	}
	return client.counterparty.create({
		data: {
			bin: bin || null,
			name: name || bin || "Контрагент (ЭСФ)",
			legalName: name || null,
			organizationUuid: organizationUuid || null,
		},
	});
}

/** Номенклатура для строки: маппинг → ТН ВЭД+наименование → создать (find-or-create). */
export async function resolveOrCreateProduct(client, { line, mapping, organizationUuid }) {
	if (mapping?.productUuid) {
		const p = await client.product.findFirst({ where: { uuid: mapping.productUuid, deletedAt: null } });
		if (p) return p.uuid;
	}
	const existing = await client.product.findFirst({
		where: { deletedAt: null, name: line.name, ...(line.tnvedCode ? { tnvedCode: line.tnvedCode } : {}) },
	});
	if (existing) return existing.uuid;
	const created = await client.product.create({
		data: {
			name: line.name || "Номенклатура (ЭСФ)",
			tnvedCode: line.tnvedCode || null,
			catalogTruId: line.catalogTruId || null,
			assetKind: line.assetKind === "material" ? "material" : "goods",
			organizationUuid: organizationUuid || null,
		},
	});
	return created.uuid;
}

/** ОС для строки: маппинг → наименование → создать (find-or-create). */
export async function resolveOrCreateFixedAsset(client, { line, mapping, organizationUuid }) {
	if (mapping?.fixedAssetUuid) {
		const fa = await client.fixedAsset.findFirst({ where: { uuid: mapping.fixedAssetUuid, deletedAt: null } });
		if (fa) return fa.uuid;
	}
	const existing = await client.fixedAsset.findFirst({ where: { deletedAt: null, name: line.name } });
	if (existing) return existing.uuid;
	const created = await client.fixedAsset.create({
		data: { name: line.name || "Основное средство (ЭСФ)", organizationUuid: organizationUuid || null },
	});
	return created.uuid;
}

// ── Ключи кэша по «естественному ключу» строки (без учёта адресного маппинга). ──
const normName = (s) => (s || "").trim().toLowerCase();
const cpKey = (bin) => `cp:${bin || ""}`;
const productKey = (line) => `product:${line.tnvedCode || ""}|${normName(line.name)}`;
const fixedAssetKey = (line) => `fa:${normName(line.name)}`;

/**
 * Контекст резолвинга справочников на ОДНУ сделку (общий кэш для ЭСФ+СНТ+ЭАВР).
 * @param {object} client — prisma (или транзакция)
 * @param {{organizationUuid?: string}} [opts]
 */
export function createResolverContext(client, { organizationUuid } = {}) {
	const cache = new Map(); // key → Promise<uuid | counterparty>
	const memo = (key, fn) => {
		if (cache.has(key)) return cache.get(key);
		const p = Promise.resolve().then(fn); // кэшируем in-flight промис → дедуп при параллели
		cache.set(key, p);
		return p;
	};

	return {
		cache, // на случай интроспекции/тестов
		/** Контрагент по БИН (кэш по БИН; без БИН — всегда создаём, не кэшируем). */
		counterpartyByBin: ({ bin, name }) =>
			bin
				? memo(cpKey(bin), () => resolveCounterpartyByBin(client, { bin, name, organizationUuid }))
				: resolveCounterpartyByBin(client, { bin, name, organizationUuid }),
		/** Номенклатура; адресный маппинг → мимо кэша. */
		product: ({ line, mapping }) =>
			mapping?.productUuid
				? resolveOrCreateProduct(client, { line, mapping, organizationUuid })
				: memo(productKey(line), () => resolveOrCreateProduct(client, { line, mapping, organizationUuid })),
		/** ОС; адресный маппинг → мимо кэша. */
		fixedAsset: ({ line, mapping }) =>
			mapping?.fixedAssetUuid
				? resolveOrCreateFixedAsset(client, { line, mapping, organizationUuid })
				: memo(fixedAssetKey(line), () => resolveOrCreateFixedAsset(client, { line, mapping, organizationUuid })),
	};
}

export default {
	resolveCounterpartyByBin,
	resolveOrCreateProduct,
	resolveOrCreateFixedAsset,
	createResolverContext,
};
