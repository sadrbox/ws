// ─────────────────────────────────────────────────────────────────────────────
// Сид подсистемы бухучёта: справочник «Виды субконто» + типовой план счетов РК.
//
// Идемпотентно: записи ищутся по уникальному ключу (code) и обновляются, если
// уже существуют. Счета создаются как ТИПОВЫЕ (organizationUuid = null) — они
// доступны всем организациям; организация может добавить собственные счета.
//
// Запуск: node prisma/seed-accounting.js   (или импорт seedAccounting из seed.js)
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "./prisma-client.js";

// Виды субконто (типы аналитики). referenceEndpoint/referenceModel — справочник
// для резолва objectUuid → наименование. NULL — «свободная» аналитика.
export const SUBKONTO_TYPES = [
	{ code: "Nomenclature", name: "Номенклатура", referenceEndpoint: "products", referenceModel: "product", sortOrder: 10 },
	{ code: "Warehouse", name: "Склад", referenceEndpoint: "warehouses", referenceModel: "warehouse", sortOrder: 20 },
	{ code: "Counterparty", name: "Контрагент", referenceEndpoint: "counterparties", referenceModel: "counterparty", sortOrder: 30 },
	{ code: "Contract", name: "Договор", referenceEndpoint: "contracts", referenceModel: "contract", sortOrder: 40 },
	{ code: "Employee", name: "Сотрудник", referenceEndpoint: "employees", referenceModel: "employee", sortOrder: 50 },
	{ code: "Department", name: "Подразделение", referenceEndpoint: null, referenceModel: null, sortOrder: 60 },
	{ code: "FixedAsset", name: "Основное средство", referenceEndpoint: null, referenceModel: null, sortOrder: 70 },
	{ code: "Project", name: "Проект", referenceEndpoint: null, referenceModel: null, sortOrder: 80 },
	{ code: "CostItem", name: "Статья затрат", referenceEndpoint: null, referenceModel: null, sortOrder: 90 },
	{ code: "Currency", name: "Валюта", referenceEndpoint: "currencies", referenceModel: "currency", sortOrder: 100 },
];

// Типовой план счетов РК (минимальный рабочий набор).
// sub — массив кодов субконто (до трёх).
export const KZ_CHART_OF_ACCOUNTS = [
	{ code: "1010", name: "Касса", accountType: "active", isCurrency: true },
	{ code: "1030", name: "Денежные средства на текущих банковских счетах", accountType: "active", isCurrency: true },
	{ code: "1210", name: "Краткосрочная дебиторская задолженность покупателей и заказчиков", accountType: "active", sub: ["Counterparty", "Contract"] },
	{ code: "1310", name: "Сырьё и материалы", accountType: "active", isQuantitative: true, sub: ["Nomenclature", "Warehouse"] },
	{ code: "1330", name: "Товары", accountType: "active", isQuantitative: true, sub: ["Nomenclature", "Warehouse"] },
	{ code: "2410", name: "Основные средства", accountType: "active", sub: ["FixedAsset"] },
	{ code: "3310", name: "Краткосрочная задолженность поставщикам и подрядчикам", accountType: "passive", sub: ["Counterparty", "Contract"] },
	{ code: "3350", name: "Краткосрочная задолженность по оплате труда", accountType: "passive", sub: ["Employee"] },
	{ code: "5510", name: "Нераспределённая прибыль (непокрытый убыток) отчётного года", accountType: "passive" },
	{ code: "6010", name: "Доход от реализации продукции и оказания услуг", accountType: "passive", sub: ["Counterparty", "Nomenclature"] },
	{ code: "7010", name: "Себестоимость реализованных товаров и услуг", accountType: "active", sub: ["Nomenclature", "Warehouse"] },
	{ code: "7210", name: "Административные расходы", accountType: "active", sub: ["Department", "CostItem"] },
];

export async function seedAccounting(client = prisma) {
	// 1. Виды субконто
	for (const st of SUBKONTO_TYPES) {
		const existing = await client.subkontoType.findUnique({ where: { code: st.code } });
		if (existing) {
			await client.subkontoType.update({
				where: { code: st.code },
				data: {
					name: st.name,
					referenceEndpoint: st.referenceEndpoint,
					referenceModel: st.referenceModel,
					sortOrder: st.sortOrder,
					isActive: true,
					deletedAt: null,
				},
			});
		} else {
			await client.subkontoType.create({ data: { ...st, isActive: true } });
		}
	}

	// 2. Типовой план счетов (глобальные счета: organizationUuid = null)
	for (const acc of KZ_CHART_OF_ACCOUNTS) {
		const sub = acc.sub ?? [];
		const data = {
			code: acc.code,
			name: acc.name,
			accountType: acc.accountType ?? "active",
			isActive: true,
			isCurrency: acc.isCurrency ?? false,
			isQuantitative: acc.isQuantitative ?? false,
			isOffBalance: acc.isOffBalance ?? false,
			subkonto1Type: sub[0] ?? null,
			subkonto2Type: sub[1] ?? null,
			subkonto3Type: sub[2] ?? null,
			organizationUuid: null,
			deletedAt: null,
		};
		const existing = await client.chartOfAccount.findFirst({
			where: { code: acc.code, organizationUuid: null },
		});
		if (existing) {
			await client.chartOfAccount.update({ where: { uuid: existing.uuid }, data });
		} else {
			await client.chartOfAccount.create({ data });
		}
	}

	const [stCount, accCount] = await Promise.all([
		client.subkontoType.count({ where: { deletedAt: null } }),
		client.chartOfAccount.count({ where: { organizationUuid: null, deletedAt: null } }),
	]);
	return { subkontoTypes: stCount, accounts: accCount };
}

// Прямой запуск
if (import.meta.url === `file://${process.argv[1]}`) {
	seedAccounting()
		.then((r) => {
			console.log(`✅ Бухучёт засеян: видов субконто=${r.subkontoTypes}, счетов=${r.accounts}`);
		})
		.catch((e) => {
			console.error("❌ seed-accounting error:", e);
			process.exit(1);
		})
		.finally(async () => {
			await prisma.$disconnect();
		});
}

export default seedAccounting;
