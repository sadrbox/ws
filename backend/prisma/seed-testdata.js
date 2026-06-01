// ─────────────────────────────────────────────────────────────────────────────
// Генератор тестового набора данных ERP (Республика Казахстан).
//
// Создаёт связанный, реалистичный набор справочников и документов для проверки
// всех бизнес-процессов: цепочки закупки/продажи/кассы/зарплаты, документы-
// основания (basisDocument*), автопроведение (бухгалтерские проводки + движения
// товаров), взаиморасчёты, остатки ТМЗ. По завершении выполняет проверку
// целостности и печатает отчёт.
//
// Идемпотентность: все тестовые сущности помечаются зарезервированным BIN-
// префиксом организаций «9990…». Перед генерацией прежние тестовые данные (и
// только они — реальные организации не затрагиваются) удаляются. Повторный
// запуск безопасен.
//
// Запуск:  node prisma/seed-testdata.js
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "./prisma-client.js";
import seedAccounting from "./seed-accounting.js";
import {
	reconcileDocumentEntries,
	POSTING_DOC_TYPES,
} from "../services/accountingPosting.js";
import {
	reconcileDocumentRegister,
	REGISTER_DOC_TYPES,
} from "../services/productRegister.js";

// ─── Конфигурация объёма ─────────────────────────────────────────────────────
const CONFIG = {
	organizations: 3,
	counterparties: 100, // распределяются по орг.: ~33 на организацию
	goods: 100,
	materials: 30,
	services: 20,
	works: 20,
	purchaseChainsPerOrg: 16,
	saleChainsPerOrg: 16,
	transfersPerOrg: 4,
	saleReturnsPerOrg: 4,
	purchaseReturnsPerOrg: 4,
	employeesPerOrg: 6,
	payrollPeriods: ["2026-01", "2026-02", "2026-03"],
};

// Зарезервированные диапазоны идентификаторов тестовых данных.
const ORG_BIN_PREFIX = "9990"; // по нему чистятся тестовые организации
const CP_BIN_PREFIX = "9991";
const EMP_IIN_PREFIX = "9992";

// ─── Утилиты ─────────────────────────────────────────────────────────────────
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Детерминированный ГПСЧ (mulberry32) — повторяемые прогоны.
let _seed = 20260601;
function rnd() {
	_seed |= 0;
	_seed = (_seed + 0x6d2b79f5) | 0;
	let t = Math.imul(_seed ^ (_seed >>> 15), 1 | _seed);
	t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const randint = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const pickN = (arr, n) => {
	const copy = [...arr];
	const out = [];
	while (out.length < n && copy.length) out.push(copy.splice(Math.floor(rnd() * copy.length), 1)[0]);
	return out;
};
const pad = (n, len) => String(n).padStart(len, "0");
const D = (y, m, day) => new Date(Date.UTC(y, m, day, 10, 0, 0)); // m: 0-based

// ─── Накопители результата ───────────────────────────────────────────────────
const stats = { refs: {}, docs: {}, chains: {} };
// registry: все созданные документы для проверки целостности и цепочек.
const registry = [];
let ADMIN = null;
// Настройки учёта НДС по организации: orgUuid → { useVat, vatRate, method, startDate }.
// НДС в строке начисляется только если useVat=true, ставка>0 И дата документа
// не раньше даты начала действия настроек (startDate).
const orgVatSettings = new Map();

function recordDoc(type, parent, header) {
	stats.docs[type] = (stats.docs[type] || 0) + 1;
	registry.push({
		type,
		uuid: parent.uuid,
		id: parent.id,
		org: header.organizationUuid ?? null,
		cp: header.counterpartyUuid ?? null,
		basisType: header.basisDocumentType ?? null,
		basisUuid: header.basisDocumentUuid ?? null,
	});
}

// ─── Метаданные документов с позициями ───────────────────────────────────────
const DOC_DEFS = {
	purchase_requisition: { model: "purchaseRequisition", item: "purchaseRequisitionItem", fk: "purchaseRequisitionUuid", vat: true },
	purchase_order: { model: "purchaseOrder", item: "purchaseOrderItem", fk: "purchaseOrderUuid", vat: true },
	purchase: { model: "purchase", item: "purchaseItem", fk: "purchaseUuid", vat: true },
	incoming_invoice: { model: "incomingInvoice", item: "incomingInvoiceItem", fk: "incomingInvoiceUuid", vat: true },
	commercial_offer: { model: "commercialOffer", item: "commercialOfferItem", fk: "commercialOfferUuid", vat: true },
	sales_order: { model: "salesOrder", item: "salesOrderItem", fk: "salesOrderUuid", vat: true },
	reservation: { model: "reservation", item: "reservationItem", fk: "reservationUuid", vat: true },
	sale: { model: "sale", item: "saleItem", fk: "saleUuid", vat: true },
	outgoing_invoice: { model: "outgoingInvoice", item: "outgoingInvoiceItem", fk: "outgoingInvoiceUuid", vat: true },
	payment_invoice: { model: "paymentInvoice", item: "paymentInvoiceItem", fk: "paymentInvoiceUuid", vat: true },
	sale_return: { model: "saleReturn", item: "saleReturnItem", fk: "saleReturnUuid", vat: true },
	purchase_return: { model: "purchaseReturn", item: "purchaseReturnItem", fk: "purchaseReturnUuid", vat: true },
	inventory_transfer: { model: "inventoryTransfer", item: "inventoryTransferItem", fk: "inventoryTransferUuid", vat: false, transfer: true },
};

// НДС строки по настройкам учёта организации, действующим на дату документа.
// Зеркалит api/router/_documentItemsFactory.js (INCLUDED/ADDED).
function vatForLine(orgUuid, date, base) {
	const s = orgVatSettings.get(orgUuid);
	const effective = !!(s && s.useVat && Number(s.vatRate) > 0 && date && date >= s.startDate);
	const rate = effective ? Number(s.vatRate) : 0;
	const method = s?.method === "ADDED" ? "ADDED" : "INCLUDED";
	if (!rate) return { amount: base, vatAmount: 0, amountWithoutVat: base, vatRate: 0 };
	if (method === "ADDED") {
		const vatAmount = round2((base * rate) / 100);
		return { amount: round2(base + vatAmount), vatAmount, amountWithoutVat: base, vatRate: rate };
	}
	const vatAmount = round2((base * rate) / (100 + rate));
	return { amount: base, vatAmount, amountWithoutVat: round2(base - vatAmount), vatRate: rate };
}

// Строка документа: { product, uom, qty, price }. Возвращает данные позиции.
function buildLine(def, line, header) {
	const base = round2(Number(line.qty) * Number(line.price));
	if (def.transfer) {
		return { quantity: line.qty, price: line.price, amount: base, productUuid: line.product.uuid, unitOfMeasureUuid: line.uom };
	}
	const v = vatForLine(header.organizationUuid, header.date, base);
	return {
		quantity: line.qty, price: line.price, amount: v.amount,
		amountWithoutVat: v.amountWithoutVat, vatRate: v.vatRate, vatAmount: v.vatAmount,
		exciseRate: 0, exciseAmount: 0, discountPercent: 0, discountAmount: 0,
		productUuid: line.product.uuid, unitOfMeasureUuid: line.uom,
		organizationUuid: header.organizationUuid ?? null,
		counterpartyUuid: header.counterpartyUuid ?? null,
		posted: header.posted ?? false, date: header.date ?? null,
	};
}

/** Создаёт документ-с-позициями и регистрирует его. header — поля шапки. */
async function createDoc(type, rawHeader, lines) {
	const def = DOC_DEFS[type];
	const header = applyBasis(type, rawHeader);
	const items = lines.map((l) => buildLine(def, l, header));
	const totals = items.reduce(
		(a, it) => ({
			amount: a.amount + Number(it.amount),
			awv: a.awv + Number(it.amountWithoutVat || 0),
			vat: a.vat + Number(it.vatAmount || 0),
		}),
		{ amount: 0, awv: 0, vat: 0 },
	);
	const data = { ...header, authorUuid: ADMIN, amount: round2(totals.amount) };
	if (def.vat) {
		data.amountWithoutVat = round2(totals.awv);
		data.vatAmount = round2(totals.vat);
	}
	const parent = await prisma[def.model].create({ data });
	if (items.length) {
		await prisma[def.item].createMany({ data: items.map((it) => ({ ...it, [def.fk]: parent.uuid })) });
	}
	recordDoc(type, parent, header);
	return parent;
}

// RU-названия типов документов (для канонической метки основания
// «{Тип}: ID {n} · {дата}», как формирует UI при выборе основания).
const DOC_TYPE_RU = {
	purchase: "Поступление товаров и услуг",
	sale: "Реализация товаров и услуг",
	sale_return: "Возврат от покупателя",
	purchase_return: "Возврат поставщику",
	purchase_requisition: "Заявка на закупку",
	purchase_order: "Заказ поставщику",
	commercial_offer: "Коммерческое предложение",
	sales_order: "Заказ покупателя",
	reservation: "Резервирование товара",
	incoming_invoice: "Счёт-фактура (входящая)",
	outgoing_invoice: "Счёт-фактура (исходящая, ЭСФ)",
	payment_invoice: "Счёт на оплату",
	bank_statement: "Банковская выписка",
};

// Поля-основания для удобного связывания дочернего документа с родителем.
// Метка — в каноническом виде «{Тип}: ID {n} · {ДД.ММ.ГГГГ}».
function basisOf(type, parent) {
	const d = parent.date instanceof Date ? parent.date : (parent.date ? new Date(parent.date) : null);
	const dateStr = d ? `${pad(d.getUTCDate(), 2)}.${pad(d.getUTCMonth() + 1, 2)}.${d.getUTCFullYear()}` : "";
	const name = DOC_TYPE_RU[type] ?? type;
	return {
		basisDocumentType: type,
		basisDocumentUuid: parent.uuid,
		basisDocumentLabel: `${name}: ID ${parent.id}${dateStr ? ` · ${dateStr}` : ""}`,
	};
}

// Модели, у которых в схеме ЕСТЬ поля basisDocument*. Остальным (incoming_invoice,
// payment_invoice, кассовые ордера, зарплата) основание не записывается — колонок
// нет; логическая связь сохраняется через цепочку и реквизиты.
const BASIS_SUPPORTED = new Set([
	"purchase", "sale", "outgoing_invoice", "sale_return", "purchase_return",
	"purchase_requisition", "commercial_offer", "sales_order", "reservation",
	"purchase_order", "bank_statement",
]);
function applyBasis(type, header) {
	if (BASIS_SUPPORTED.has(type)) return header;
	const { basisDocumentType, basisDocumentUuid, basisDocumentLabel, ...rest } = header;
	return rest;
}

// ─── Очистка прежних тестовых данных ─────────────────────────────────────────
async function cleanup() {
	const testOrgs = await prisma.organization.findMany({
		where: { bin: { startsWith: ORG_BIN_PREFIX } },
		select: { uuid: true },
	});
	const orgUuids = testOrgs.map((o) => o.uuid);
	if (!orgUuids.length) return 0;
	const byOrg = { where: { organizationUuid: { in: orgUuids } } };

	// 1. Регистры (полиморфные, без FK).
	await prisma.accountingEntry.deleteMany(byOrg); // аналитика — каскадом
	await prisma.productRegister.deleteMany(byOrg);

	// 2. Документы (их позиции — каскадом по onDelete: Cascade).
	for (const def of Object.values(DOC_DEFS)) {
		await prisma[def.model].deleteMany(byOrg);
	}
	await prisma.bankStatement.deleteMany(byOrg);
	await prisma.cashReceiptOrder.deleteMany(byOrg);
	await prisma.cashExpenseOrder.deleteMany(byOrg);
	await prisma.payrollPayment.deleteMany(byOrg);
	await prisma.payrollCalculation.deleteMany(byOrg);

	// 3. Справочники, зависящие от организации.
	await prisma.employeeHistory.deleteMany(byOrg);
	await prisma.contract.deleteMany(byOrg);
	await prisma.position.deleteMany(byOrg);
	await prisma.employee.deleteMany(byOrg);
	await prisma.product.deleteMany(byOrg);
	await prisma.brand.deleteMany(byOrg);
	await prisma.counterparty.deleteMany(byOrg);
	await prisma.warehouse.deleteMany(byOrg);
	await prisma.cashbox.deleteMany(byOrg);
	await prisma.bankAccount.deleteMany(byOrg);
	await prisma.organizationAccountingSetting.deleteMany(byOrg);

	// 4. Сами организации.
	await prisma.organization.deleteMany({ where: { uuid: { in: orgUuids } } });
	return orgUuids.length;
}

// ─── Глобальные справочники (общие, не удаляются при очистке) ─────────────────
async function ensureGlobals() {
	const admin = await prisma.user.findFirst({ where: { username: "admin" } });
	if (!admin) throw new Error("Не найден пользователь admin — запустите prisma/seed.js");
	ADMIN = admin.uuid;

	await seedAccounting(); // план счетов + виды субконто (идемпотентно)

	// Валюта KZT.
	let kzt = await prisma.currency.findUnique({ where: { code: "KZT" } });
	if (!kzt) kzt = await prisma.currency.create({ data: { code: "KZT", name: "Тенге", symbol: "₸" } });

	// Единицы измерения (общие, по code).
	const uomDefs = [
		{ code: "796", name: "Штука" },
		{ code: "166", name: "Килограмм" },
		{ code: "112", name: "Литр" },
		{ code: "006", name: "Метр" },
		{ code: "778", name: "Упаковка" },
		{ code: "356", name: "Час" },
		{ code: "839", name: "Комплект" },
	];
	const uoms = {};
	for (const u of uomDefs) {
		let rec = await prisma.unitOfMeasure.findFirst({ where: { code: u.code } });
		if (!rec) rec = await prisma.unitOfMeasure.create({ data: u });
		uoms[u.code] = rec.uuid;
	}
	return { kztUuid: kzt.uuid, uoms };
}

// ─── Справочные данные тестовых организаций ──────────────────────────────────
async function createReferenceData(globals) {
	const orgNames = ["Альфа", "Бета", "Гамма", "Дельта", "Эпсилон"];
	const orgs = [];

	for (let i = 0; i < CONFIG.organizations; i++) {
		const bin = ORG_BIN_PREFIX + pad(i + 1, 8);
		const org = await prisma.organization.create({
			data: { bin, name: `ТОО ${orgNames[i]} (ТЕСТ)`, legalName: `Товарищество с ограниченной ответственностью «${orgNames[i]}»` },
		});
		// Разные профили учёта НДС — чтобы проверить INCLUDED / ADDED / без НДС
		// и дату начала действия. У «Беты» НДС включается только с 01.03.2026,
		// поэтому её февральские закупки попадают в период без НДС.
		const vatProfiles = [
			{ useVat: true, vatRate: 12, method: "INCLUDED", startDate: D(2026, 0, 1) },
			{ useVat: true, vatRate: 12, method: "ADDED", startDate: D(2026, 2, 1) },
			{ useVat: false, vatRate: 0, method: "INCLUDED", startDate: D(2026, 0, 1) },
		];
		const vp = vatProfiles[i % vatProfiles.length];
		orgVatSettings.set(org.uuid, vp);
		await prisma.organizationAccountingSetting.create({
			data: {
				organizationUuid: org.uuid, useVat: vp.useVat, vatRate: vp.vatRate,
				vatCalculationMethod: vp.method, startDate: vp.startDate,
				useDiscount: false, useExcise: false,
			},
		});

		// Склады, кассы, банк-счета.
		const warehouses = {
			main: await prisma.warehouse.create({ data: { organizationUuid: org.uuid, name: "Основной склад" } }),
			retail: await prisma.warehouse.create({ data: { organizationUuid: org.uuid, name: "Розничный склад" } }),
			materials: await prisma.warehouse.create({ data: { organizationUuid: org.uuid, name: "Склад материалов" } }),
		};
		const cashboxes = [
			await prisma.cashbox.create({ data: { organizationUuid: org.uuid, name: "Основная касса" } }),
			await prisma.cashbox.create({ data: { organizationUuid: org.uuid, name: "Операционная касса" } }),
		];
		const bankAccounts = [];
		for (let b = 0; b < 2; b++) {
			bankAccounts.push(await prisma.bankAccount.create({
				data: {
					organizationUuid: org.uuid, ownerType: "organization", ownerUuid: org.uuid,
					iban: `KZ${pad(i, 2)}${pad(b, 2)}` + "00000000" + pad(randint(100000, 999999), 6),
					bik: "HSBKKZKX", bankName: "АО «Народный банк»", name: `Расчётный счёт №${b + 1}`,
					currencyUuid: globals.kztUuid, isPrimary: b === 0,
				},
			}));
		}

		// Должности и сотрудники + история приёма.
		const positionNames = ["Директор", "Главный бухгалтер", "Менеджер по продажам", "Кладовщик", "Снабженец", "Кассир"];
		const positions = [];
		for (const pn of positionNames) positions.push(await prisma.position.create({ data: { organizationUuid: org.uuid, name: pn } }));

		const lastNames = ["Ахметов", "Иванов", "Қасымова", "Петров", "Серікбай", "Smith", "Нұрланова", "Ким"];
		const firstNames = ["Асхат", "Дмитрий", "Айгүл", "Сергей", "Нұрлан", "John", "Алия", "Виктор"];
		const employees = [];
		for (let e = 0; e < CONFIG.employeesPerOrg; e++) {
			const ln = pick(lastNames), fn = pick(firstNames);
			const emp = await prisma.employee.create({
				data: {
					organizationUuid: org.uuid, lastName: ln, firstName: fn,
					fullName: `${ln} ${fn}`, iin: EMP_IIN_PREFIX + pad(i * 100 + e, 8),
				},
			});
			const pos = positions[e % positions.length];
			const salary = randint(200, 600) * 1000;
			await prisma.employeeHistory.create({
				data: { organizationUuid: org.uuid, employeeUuid: emp.uuid, positionUuid: pos.uuid, eventType: "hire", eventDate: D(2025, 11, 1), salary },
			});
			employees.push({ ...emp, positionUuid: pos.uuid, salary });
		}

		// Бренд.
		const brand = await prisma.brand.create({ data: { organizationUuid: org.uuid, name: `Бренд ${orgNames[i]}` } });

		orgs.push({ rec: org, name: orgNames[i], warehouses, cashboxes, bankAccounts, positions, employees, brand,
			counterparties: { suppliers: [], customers: [], both: [] }, contracts: {}, products: { goods: [], materials: [], services: [], works: [] } });
	}

	// Контрагенты, распределённые по организациям, с категориями.
	const cpNames = ["Снабжение", "ТоргДом", "ОптЦентр", "Логистик", "ПромРесурс", "Восток", "Меридиан", "Альянс", "Капитал", "Стандарт",
		"Глобал", "Сервис", "Импорт", "Партнёр", "Ресурс", "Технопарк", "Мегаполис", "Вектор", "Гранд", "Элит"];
	for (let c = 0; c < CONFIG.counterparties; c++) {
		// Категория НЕ должна коррелировать с организацией (иначе у части
		// организаций не окажется ни поставщиков, ни покупателей).
		const org = orgs[c % orgs.length];
		const cat = Math.floor(c / orgs.length) % 3;
		const category = cat === 0 ? "suppliers" : cat === 1 ? "customers" : "both";
		const role = category === "suppliers" ? "Поставщик" : category === "customers" ? "Покупатель" : "Партнёр";
		const cp = await prisma.counterparty.create({
			data: {
				organizationUuid: org.rec.uuid, bin: CP_BIN_PREFIX + pad(c + 1, 8),
				name: `${role} «${pick(cpNames)}-${c + 1}»`, legalName: `ТОО «${pick(cpNames)} ${c + 1}»`,
			},
		});
		// Договоры (1–3 на контрагента).
		const contracts = [];
		const nContracts = randint(1, 4);
		for (let k = 0; k < nContracts; k++) {
			const ct = await prisma.contract.create({
				data: {
					organizationUuid: org.rec.uuid, counterpartyUuid: cp.uuid,
					name: `Договор №${c + 1}/${k + 1}`, contractNumber: `${c + 1}-${k + 1}`,
					startDate: D(2025, 11, 1), isPrimary: k === 0,
				},
			});
			contracts.push(ct);
		}
		org.contracts[cp.uuid] = contracts;
		const entry = { rec: cp, contracts };
		org.counterparties[category].push(entry);
		if (category === "both") {
			org.counterparties.suppliers.push(entry);
			org.counterparties.customers.push(entry);
		}
	}

	// Номенклатура: товары/материалы/услуги/работы, распределены по организациям.
	const mk = async (org, kind, idx, isService, uomCode) => {
		const labels = { goods: "Товар", materials: "Материал", services: "Услуга", works: "Работа" };
		const p = await prisma.product.create({
			data: {
				organizationUuid: org.rec.uuid, brandUuid: org.brand.uuid, unitOfMeasureUuid: globals.uoms[uomCode],
				name: `${labels[kind]} ${idx} (${org.name})`, sku: `${kind.toUpperCase().slice(0, 3)}-${idx}`,
				isService,
			},
		});
		org.products[kind].push({ ...p, uom: globals.uoms[uomCode] });
	};
	for (let g = 0; g < CONFIG.goods; g++) await mk(orgs[g % orgs.length], "goods", g + 1, false, pick(["796", "778", "839"]));
	for (let m = 0; m < CONFIG.materials; m++) await mk(orgs[m % orgs.length], "materials", m + 1, false, pick(["166", "112", "006"]));
	for (let s = 0; s < CONFIG.services; s++) await mk(orgs[s % orgs.length], "services", s + 1, true, "356");
	for (let w = 0; w < CONFIG.works; w++) await mk(orgs[w % orgs.length], "works", w + 1, true, "356");

	stats.refs = {
		organizations: orgs.length,
		counterparties: await prisma.counterparty.count({ where: { bin: { startsWith: CP_BIN_PREFIX } } }),
		contracts: await prisma.contract.count({ where: { organizationUuid: { in: orgs.map((o) => o.rec.uuid) } } }),
		warehouses: orgs.length * 3,
		cashboxes: orgs.length * 2,
		bankAccounts: orgs.length * 2,
		positions: orgs.reduce((a, o) => a + o.positions.length, 0),
		employees: orgs.reduce((a, o) => a + o.employees.length, 0),
		products: CONFIG.goods + CONFIG.materials + CONFIG.services + CONFIG.works,
	};
	return orgs;
}

// ─── Простые денежные документы (без позиций) ────────────────────────────────
async function createCashReceipt(rawHeader) {
	const header = applyBasis("cash_receipt_order", rawHeader);
	const rec = await prisma.cashReceiptOrder.create({ data: { ...header, authorUuid: ADMIN, posted: true } });
	recordDoc("cash_receipt_order", rec, header);
	return rec;
}
async function createCashExpense(rawHeader) {
	const header = applyBasis("cash_expense_order", rawHeader);
	const rec = await prisma.cashExpenseOrder.create({ data: { ...header, authorUuid: ADMIN, posted: true } });
	recordDoc("cash_expense_order", rec, header);
	return rec;
}
async function createBankStatement(rawHeader) {
	const header = applyBasis("bank_statement", rawHeader);
	const rec = await prisma.bankStatement.create({ data: { ...header, authorUuid: ADMIN, posted: true } });
	recordDoc("bank_statement", rec, header);
	return rec;
}

// ─── Учёт планируемых остатков (чтобы не уйти в минус) ────────────────────────
const stock = new Map(); // `${org}|${wh}|${product}` → qty
const stockKey = (o, w, p) => `${o}|${w}|${p}`;
const addStock = (o, w, p, q) => stock.set(stockKey(o, w, p), (stock.get(stockKey(o, w, p)) || 0) + q);
const getStock = (o, w, p) => stock.get(stockKey(o, w, p)) || 0;

// ─── Цепочка ЗАКУПКИ ──────────────────────────────────────────────────────────
// Запрос → Заказ поставщику → Поступление → Счёт-фактура полученная → Оплата.
async function purchaseChain(org, idx) {
	const supplier = pick(org.counterparties.suppliers);
	if (!supplier) return;
	const contract = pick(supplier.contracts);
	// Товары — на основной склад, материалы — на склад материалов.
	const isMaterials = idx % 4 === 0;
	const kind = isMaterials ? "materials" : "goods";
	const wh = isMaterials ? org.warehouses.materials : org.warehouses.main;
	const products = pickN(org.products[kind], randint(2, 4));
	if (!products.length) return;
	const day = randint(1, 24);
	const baseHeader = { organizationUuid: org.rec.uuid, counterpartyUuid: supplier.rec.uuid, contractUuid: contract.uuid };
	const lines = products.map((p) => ({ product: p, uom: p.uom, qty: randint(80, 200), price: randint(300, 5000) }));

	// 1. Запрос поставщику (заявка).
	const req = await createDoc("purchase_requisition", { ...baseHeader, date: D(2026, 1, day), comment: "Заявка на закупку" }, lines);
	// 2. Заказ поставщику.
	const order = await createDoc("purchase_order", { ...baseHeader, date: D(2026, 1, day + 1), comment: "Заказ поставщику", ...basisOf("purchase_requisition", req) }, lines);
	// 3. Поступление товаров (проводится).
	const purchase = await createDoc("purchase", { ...baseHeader, warehouseUuid: wh.uuid, date: D(2026, 1, day + 2), posted: true, comment: "Поступление товаров", ...basisOf("purchase_order", order) }, lines);
	for (const l of lines) addStock(org.rec.uuid, wh.uuid, l.product.uuid, l.qty);
	// 4. Счёт-фактура полученная.
	const inv = await createDoc("incoming_invoice", { ...baseHeader, date: D(2026, 1, day + 3), comment: "Счёт-фактура полученная", ...basisOf("purchase", purchase) }, lines);
	// 5. Оплата поставщику (часть — банк, часть — касса; иногда частичная).
	const total = Number(inv.amount); // валовая сумма счёта-фактуры (с учётом НДС)
	const payRatio = idx % 5 === 0 ? 0.6 : 1; // часть закупок оплачена не полностью (открытая задолженность)
	const payAmount = round2(total * payRatio);
	if (idx % 2 === 0) {
		await createBankStatement({ ...baseHeader, bankAccountUuid: pick(org.bankAccounts).uuid, direction: "bankStatementOut", amount: payAmount, date: D(2026, 1, day + 5), comment: "Оплата поставщику (банк)", ...basisOf("incoming_invoice", inv) });
	} else {
		await createCashExpense({ ...baseHeader, cashboxUuid: pick(org.cashboxes).uuid, amount: payAmount, date: D(2026, 1, day + 5), comment: "Оплата поставщику (касса)", ...basisOf("incoming_invoice", inv) });
	}
	stats.chains.purchase = (stats.chains.purchase || 0) + 1;
	return { purchase, wh, supplier };
}

// ─── Цепочка ПРОДАЖИ ─────────────────────────────────────────────────────────
// КП → Заказ покупателя → Резерв → Реализация → ЭСФ → Счёт на оплату → Оплата.
async function saleChain(org, idx) {
	const customer = pick(org.counterparties.customers);
	if (!customer) return;
	const contract = pick(customer.contracts);
	const wh = org.warehouses.main;
	// Товары с достаточным остатком на основном складе.
	const available = org.products.goods.filter((p) => getStock(org.rec.uuid, wh.uuid, p.uuid) >= 10);
	if (available.length < 1) return;
	const products = pickN(available, Math.min(randint(2, 4), available.length));
	const day = randint(1, 22);
	const baseHeader = { organizationUuid: org.rec.uuid, counterpartyUuid: customer.rec.uuid, contractUuid: contract.uuid };
	const lines = products.map((p) => {
		const avail = getStock(org.rec.uuid, wh.uuid, p.uuid);
		const qty = Math.max(1, Math.min(randint(5, 40), Math.floor(avail * 0.5)));
		return { product: p, uom: p.uom, qty, price: randint(1500, 9000) };
	});
	// Услуги/работы в КП/ЭСФ (не двигают ТМЗ) — для разнообразия номенклатуры.
	const serviceLines = pickN([...org.products.services, ...org.products.works], randint(0, 2))
		.map((p) => ({ product: p, uom: p.uom, qty: randint(1, 5), price: randint(5000, 30000) }));

	// 1. Коммерческое предложение (с услугами).
	const offer = await createDoc("commercial_offer", { ...baseHeader, date: D(2026, 2, day), comment: "Коммерческое предложение" }, [...lines, ...serviceLines]);
	// 2. Заказ покупателя.
	const order = await createDoc("sales_order", { ...baseHeader, warehouseUuid: wh.uuid, date: D(2026, 2, day + 1), comment: "Заказ покупателя", ...basisOf("commercial_offer", offer) }, lines);
	// 3. Резервирование товара.
	const reserve = await createDoc("reservation", { ...baseHeader, warehouseUuid: wh.uuid, date: D(2026, 2, day + 2), comment: "Резервирование товара", ...basisOf("sales_order", order) }, lines);
	// 4. Реализация товаров (проводится → расход ТМЗ + проводки).
	const sale = await createDoc("sale", { ...baseHeader, warehouseUuid: wh.uuid, date: D(2026, 2, day + 3), posted: true, comment: "Реализация товаров и услуг", ...basisOf("sales_order", order) }, lines);
	for (const l of lines) addStock(org.rec.uuid, wh.uuid, l.product.uuid, -l.qty);
	// 5. Электронный счёт-фактура (с услугами).
	const esf = await createDoc("outgoing_invoice", { ...baseHeader, date: D(2026, 2, day + 4), comment: "ЭСФ (счёт-фактура выданная)", ...basisOf("sale", sale) }, [...lines, ...serviceLines]);
	// 6. Счёт на оплату.
	const bill = await createDoc("payment_invoice", { ...baseHeader, date: D(2026, 2, day + 4), comment: "Счёт на оплату", ...basisOf("sale", sale) }, lines);
	// 7. Оплата от покупателя (касса/банк; иногда частичная — открытая ДЗ).
	const total = Number(sale.amount); // валовая сумма реализации (с учётом НДС)
	const payRatio = idx % 4 === 0 ? 0.5 : 1;
	const payAmount = round2(total * payRatio);
	if (idx % 2 === 0) {
		await createCashReceipt({ ...baseHeader, cashboxUuid: pick(org.cashboxes).uuid, amount: payAmount, date: D(2026, 2, day + 6), comment: "Поступление оплаты (ПКО)", ...basisOf("payment_invoice", bill) });
	} else {
		await createBankStatement({ ...baseHeader, bankAccountUuid: pick(org.bankAccounts).uuid, direction: "bankStatementIn", amount: payAmount, date: D(2026, 2, day + 6), comment: "Поступление оплаты (банк)", ...basisOf("payment_invoice", bill) });
	}
	stats.chains.sale = (stats.chains.sale || 0) + 1;
	return { sale, wh, customer, lines };
}

// ─── Перемещение ТМЗ (основной → розничный) ──────────────────────────────────
async function transferChain(org) {
	const from = org.warehouses.main, to = org.warehouses.retail;
	const available = org.products.goods.filter((p) => getStock(org.rec.uuid, from.uuid, p.uuid) >= 10);
	if (!available.length) return;
	const products = pickN(available, Math.min(randint(1, 3), available.length));
	const lines = products.map((p) => {
		const qty = Math.max(1, Math.min(randint(3, 15), Math.floor(getStock(org.rec.uuid, from.uuid, p.uuid) * 0.3)));
		return { product: p, uom: p.uom, qty, price: randint(300, 5000) };
	});
	const t = await createDoc("inventory_transfer", {
		organizationUuid: org.rec.uuid, fromWarehouseUuid: from.uuid, toWarehouseUuid: to.uuid,
		date: D(2026, 2, randint(24, 27)), posted: true, comment: "Перемещение на розничный склад",
	}, lines);
	for (const l of lines) {
		addStock(org.rec.uuid, from.uuid, l.product.uuid, -l.qty);
		addStock(org.rec.uuid, to.uuid, l.product.uuid, l.qty);
	}
	stats.chains.transfer = (stats.chains.transfer || 0) + 1;
	return t;
}

// ─── Возвраты ────────────────────────────────────────────────────────────────
async function saleReturnChain(org, sale) {
	if (!sale) return;
	const line = pick(sale.lines);
	const qty = Math.max(1, Math.floor(line.qty * 0.2));
	const header = {
		organizationUuid: org.rec.uuid, counterpartyUuid: sale.customer.rec.uuid,
		contractUuid: pick(sale.customer.contracts).uuid, warehouseUuid: sale.wh.uuid,
		date: D(2026, 3, randint(1, 12)), posted: true, comment: "Возврат от покупателя",
		...basisOf("sale", sale.sale),
	};
	await createDoc("sale_return", header, [{ product: line.product, uom: line.uom, qty, price: line.price }]);
	addStock(org.rec.uuid, sale.wh.uuid, line.product.uuid, qty);
	stats.chains.sale_return = (stats.chains.sale_return || 0) + 1;
}

async function purchaseReturnChain(org, purchase) {
	if (!purchase) return;
	const items = await prisma.purchaseItem.findMany({ where: { purchaseUuid: purchase.purchase.uuid } });
	const it = pick(items);
	if (!it) return;
	const wh = purchase.wh;
	const maxQty = getStock(org.rec.uuid, wh.uuid, it.productUuid);
	if (maxQty < 1) return;
	const qty = Math.max(1, Math.min(Math.floor(Number(it.quantity) * 0.15), Math.floor(maxQty)));
	const header = {
		organizationUuid: org.rec.uuid, counterpartyUuid: purchase.supplier.rec.uuid,
		contractUuid: pick(purchase.supplier.contracts).uuid, warehouseUuid: wh.uuid,
		date: D(2026, 3, randint(1, 12)), posted: true, comment: "Возврат поставщику",
		...basisOf("purchase", purchase.purchase),
	};
	await createDoc("purchase_return", header, [{ product: { uuid: it.productUuid }, uom: it.unitOfMeasureUuid, qty, price: Number(it.price) }]);
	addStock(org.rec.uuid, wh.uuid, it.productUuid, -qty);
	stats.chains.purchase_return = (stats.chains.purchase_return || 0) + 1;
}

// ─── Цепочка ЗАРПЛАТЫ ────────────────────────────────────────────────────────
// Приём (история) → Начисление → Выплата (ведомость+выплата).
async function payrollChain(org) {
	for (const period of CONFIG.payrollPeriods) {
		const [py, pm] = period.split("-").map(Number);
		for (const emp of org.employees) {
			const base = emp.salary;
			const opv = round2(base * 0.1);
			const vosms = round2(base * 0.02);
			const ipn = round2((base - opv - vosms) * 0.1);
			const socialTax = round2(base * 0.095);
			const socialContrib = round2(base * 0.035);
			const oosms = round2(base * 0.03);
			const net = round2(base - opv - ipn - vosms);
			const calc = await prisma.payrollCalculation.create({
				data: {
					organizationUuid: org.rec.uuid, employeeUuid: emp.uuid, positionUuid: emp.positionUuid,
					authorUuid: ADMIN, posted: true, period, date: D(py, pm - 1, 28),
					baseSalary: base, opv, ipn, vosms, oosms, socialTax, socialContrib,
					netSalary: net, totalExpense: base, comment: `Начисление зарплаты за ${period}`,
				},
			});
			recordDoc("payroll_calculation", calc, { organizationUuid: org.rec.uuid });
			// Выплата: большинство — банк, часть — касса. Иногда частичная.
			const method = org.employees.indexOf(emp) % 3 === 0 ? "cash" : "bank_transfer";
			const pay = await prisma.payrollPayment.create({
				data: {
					organizationUuid: org.rec.uuid, employeeUuid: emp.uuid, authorUuid: ADMIN, posted: true,
					period, paymentMethod: method, amount: base, date: D(py, pm, 5),
					comment: `Выплата зарплаты за ${period}`,
				},
			});
			// Логическая связь начисление→выплата (модель PayrollPayment не имеет
			// колонок basisDocument*; связь фиксируется по сотруднику+периоду).
			registry.push({ type: "payroll_payment", uuid: pay.uuid, id: pay.id, org: org.rec.uuid, cp: null, basisType: null, basisUuid: null });
			stats.docs.payroll_payment = (stats.docs.payroll_payment || 0) + 1;
		}
	}
	stats.chains.payroll = (stats.chains.payroll || 0) + org.employees.length * CONFIG.payrollPeriods.length;
}

// ─── Генерация всех документов ───────────────────────────────────────────────
async function createDocuments(orgs) {
	for (const org of orgs) {
		// Закупки (строят остатки).
		const purchases = [];
		for (let i = 0; i < CONFIG.purchaseChainsPerOrg; i++) purchases.push(await purchaseChain(org, i));
		// Перемещения.
		for (let i = 0; i < CONFIG.transfersPerOrg; i++) await transferChain(org);
		// Продажи (расходуют остатки).
		const sales = [];
		for (let i = 0; i < CONFIG.saleChainsPerOrg; i++) { const s = await saleChain(org, i); if (s) sales.push(s); }
		// Возвраты.
		for (let i = 0; i < CONFIG.saleReturnsPerOrg && i < sales.length; i++) await saleReturnChain(org, sales[i]);
		const goodsPurchases = purchases.filter(Boolean).filter((p) => p.wh.uuid === org.warehouses.main.uuid);
		for (let i = 0; i < CONFIG.purchaseReturnsPerOrg && i < goodsPurchases.length; i++) await purchaseReturnChain(org, goodsPurchases[i]);
		// Зарплата.
		await payrollChain(org);
	}
}

// ─── Автопроведение всех проведённых документов ──────────────────────────────
async function postAll() {
	// Порядок важен: приходы ТМЗ → перемещения → реализации (себестоимость по
	// средней из регистра приходов) → возвраты → денежные/зарплата.
	const order = [
		"purchase", "inventory_transfer", "sale", "sale_return", "purchase_return",
		"cash_receipt_order", "cash_expense_order", "bank_statement",
		"payroll_calculation", "payroll_payment",
	];
	const posted = registry.filter((d) => order.includes(d.type));
	posted.sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
	let regCount = 0, entCount = 0;
	for (const d of posted) {
		if (REGISTER_DOC_TYPES.includes(d.type)) { await reconcileDocumentRegister(d.type, d.uuid); regCount++; }
		if (POSTING_DOC_TYPES.includes(d.type)) { await reconcileDocumentEntries(d.type, d.uuid); entCount++; }
	}
	return { regCount, entCount };
}

// ─── Проверка целостности ────────────────────────────────────────────────────
async function integrityCheck(orgUuids) {
	const errors = [];
	const exists = async (model, uuid) => (uuid ? !!(await prisma[model].findUnique({ where: { uuid } })) : true);
	const modelByType = Object.fromEntries(Object.entries(DOC_DEFS).map(([t, d]) => [t, d.model]));
	modelByType.cash_receipt_order = "cashReceiptOrder";
	modelByType.cash_expense_order = "cashExpenseOrder";
	modelByType.bank_statement = "bankStatement";
	modelByType.payroll_calculation = "payrollCalculation";
	modelByType.payroll_payment = "payrollPayment";

	const docByUuid = new Map(registry.map((d) => [d.uuid, d]));

	// 1. Битые ссылки оснований + согласованность организации/контрагента.
	for (const d of registry) {
		if (d.basisType || d.basisUuid) {
			if (!(d.basisType && d.basisUuid)) { errors.push(`Документ ${d.type}#${d.id}: основание заполнено частично`); continue; }
			const base = docByUuid.get(d.basisUuid);
			if (!base) {
				const ok = await exists(modelByType[d.basisType], d.basisUuid);
				if (!ok) errors.push(`Документ ${d.type}#${d.id}: основание ${d.basisType} не найдено`);
			} else {
				if (base.org !== d.org) errors.push(`Документ ${d.type}#${d.id}: организация не совпадает с основанием`);
				if (d.cp && base.cp && d.cp !== base.cp) errors.push(`Документ ${d.type}#${d.id}: контрагент не совпадает с основанием`);
			}
		}
	}

	// 2. Циклические зависимости оснований.
	for (const d of registry) {
		const seen = new Set();
		let cur = d;
		while (cur && cur.basisUuid) {
			if (seen.has(cur.uuid)) { errors.push(`Циклическая зависимость оснований у ${d.type}#${d.id}`); break; }
			seen.add(cur.uuid);
			cur = docByUuid.get(cur.basisUuid);
		}
	}

	// 3. Проведённые документы имеют проводки.
	const postableWithEntries = new Set(POSTING_DOC_TYPES);
	for (const d of registry) {
		if (!postableWithEntries.has(d.type)) continue;
		const model = modelByType[d.type];
		const doc = await prisma[model].findUnique({ where: { uuid: d.uuid } });
		if (!doc || doc.posted !== true) continue;
		const cnt = await prisma.accountingEntry.count({ where: { documentType: d.type, documentUuid: d.uuid } });
		if (cnt === 0) errors.push(`Проведённый ${d.type}#${d.id} без проводок`);
	}

	// 4. Проведённые товарные документы имеют движения.
	for (const d of registry) {
		if (!REGISTER_DOC_TYPES.includes(d.type)) continue;
		const cnt = await prisma.productRegister.count({ where: { documentType: d.type, documentUuid: d.uuid } });
		if (cnt === 0) errors.push(`Проведённый товарный ${d.type}#${d.id} без движений ТМЗ`);
	}

	// 5. Нет отрицательных остатков (товар+склад+организация).
	const reg = await prisma.productRegister.findMany({
		where: { organizationUuid: { in: orgUuids } },
		select: { productUuid: true, warehouseUuid: true, organizationUuid: true, movementType: true, quantity: true },
	});
	const bal = new Map();
	for (const r of reg) {
		const k = `${r.organizationUuid}|${r.warehouseUuid}|${r.productUuid}`;
		const q = Number(r.quantity) * (r.movementType === "in" ? 1 : -1);
		bal.set(k, (bal.get(k) || 0) + q);
	}
	let negatives = 0;
	for (const [k, q] of bal) if (round2(q) < 0) { negatives++; if (negatives <= 5) errors.push(`Отрицательный остаток: ${k} = ${round2(q)}`); }

	// 6. Взаиморасчёты: есть и открытые, и закрытые сальдо по контрагентам.
	const analytics = await prisma.accountingEntryAnalytic.findMany({
		where: { subkontoType: "Counterparty", entry: { organizationUuid: { in: orgUuids } } },
		select: { side: true, objectUuid: true, entry: { select: { debitAccountCode: true, creditAccountCode: true, amount: true } } },
	});
	const arBal = new Map(); // дебиторка по покупателям (1210)
	const apBal = new Map(); // кредиторка по поставщикам (3310)
	for (const a of analytics) {
		const amt = Number(a.entry.amount);
		const acc = a.side === "debit" ? a.entry.debitAccountCode : a.entry.creditAccountCode;
		const sign = a.side === "debit" ? 1 : -1;
		if (acc === "1210") arBal.set(a.objectUuid, (arBal.get(a.objectUuid) || 0) + sign * amt);
		if (acc === "3310") apBal.set(a.objectUuid, (apBal.get(a.objectUuid) || 0) + (-sign) * amt); // пассив: кредит +
	}
	// 7. НДС по настройкам учёта: должны быть строки и с НДС (>0), и без НДС
	// (профиль «без НДС» у Гаммы + февральские закупки Беты до даты начала).
	const [vatLines, noVatLines] = await Promise.all([
		prisma.purchaseItem.count({ where: { organizationUuid: { in: orgUuids }, vatAmount: { gt: 0 } } }),
		prisma.purchaseItem.count({ where: { organizationUuid: { in: orgUuids }, vatAmount: 0 } }),
	]);
	if (vatLines === 0) errors.push("Нет строк с НДС — настройки учёта не применились");
	if (noVatLines === 0) errors.push("Нет строк без НДС — профиль «без НДС»/дата начала не применились");

	const openAR = [...arBal.values()].filter((v) => round2(v) > 0.01).length;
	const openAP = [...apBal.values()].filter((v) => round2(v) > 0.01).length;
	const closedAR = [...arBal.values()].filter((v) => Math.abs(round2(v)) <= 0.01).length;
	const closedAP = [...apBal.values()].filter((v) => Math.abs(round2(v)) <= 0.01).length;
	if (openAR === 0) errors.push("Нет открытой дебиторской задолженности (ожидались частичные оплаты)");
	if (openAP === 0) errors.push("Нет открытой кредиторской задолженности");

	return { errors, balances: bal.size, negatives, openAR, openAP, closedAR, closedAP, vatLines, noVatLines };
}

// ─── Печать отчёта ───────────────────────────────────────────────────────────
function printReport(post, integrity) {
	const totalDocs = Object.values(stats.docs).reduce((a, b) => a + b, 0);
	const line = (s) => console.log(s);
	line("\n══════════════════════════════════════════════════════════════");
	line("  ОТЧЁТ О ГЕНЕРАЦИИ ТЕСТОВЫХ ДАННЫХ ERP (РК)");
	line("══════════════════════════════════════════════════════════════");
	line("\n▸ Справочники:");
	for (const [k, v] of Object.entries(stats.refs)) line(`    ${k.padEnd(18)} ${v}`);
	line("\n▸ Документы по типам:");
	for (const [k, v] of Object.entries(stats.docs).sort()) line(`    ${k.padEnd(22)} ${v}`);
	line(`    ${"ИТОГО документов".padEnd(22)} ${totalDocs}`);
	line("\n▸ Цепочки:");
	for (const [k, v] of Object.entries(stats.chains).sort()) line(`    ${k.padEnd(18)} ${v}`);
	line("\n▸ Проведение:");
	line(`    Документов с движениями ТМЗ:   ${post.regCount}`);
	line(`    Документов с проводками:       ${post.entCount}`);
	line("\n▸ Взаиморасчёты:");
	line(`    Открытая дебиторка (покупатели): ${integrity.openAR}, закрытая: ${integrity.closedAR}`);
	line(`    Открытая кредиторка (поставщики): ${integrity.openAP}, закрытая: ${integrity.closedAP}`);
	line(`    Остатков (товар+склад): ${integrity.balances}, отрицательных: ${integrity.negatives}`);
	line("\n▸ НДС по настройкам учёта (профили организаций):");
	line("    Альфа: 12% «в т.ч.» (INCLUDED) с 01.01.2026");
	line("    Бета:  12% «сверху» (ADDED) с 01.03.2026 — февральские закупки без НДС");
	line("    Гамма: без НДС");
	line(`    Строк закупок с НДС: ${integrity.vatLines}, без НДС: ${integrity.noVatLines}`);
	line("\n▸ Проверка целостности:");
	if (integrity.errors.length === 0) line("    ✅ Ошибок не обнаружено");
	else { line(`    ❌ Найдено ошибок: ${integrity.errors.length}`); integrity.errors.slice(0, 30).forEach((e) => line(`       • ${e}`)); }
	line("══════════════════════════════════════════════════════════════\n");
}

// ─── Точка входа ─────────────────────────────────────────────────────────────
async function main() {
	const t0 = Date.now();
	console.log("🧹 Очистка прежних тестовых данных…");
	const removed = await cleanup();
	console.log(`   удалено тестовых организаций: ${removed}`);

	console.log("🌐 Глобальные справочники (план счетов, валюта, единицы)…");
	const globals = await ensureGlobals();

	console.log("📚 Справочные данные (организации, контрагенты, договоры, …)…");
	const orgs = await createReferenceData(globals);
	const orgUuids = orgs.map((o) => o.rec.uuid);

	console.log("📄 Документы и цепочки…");
	await createDocuments(orgs);

	console.log("⚙️  Автопроведение (проводки + движения ТМЗ)…");
	const post = await postAll();

	console.log("🔎 Проверка целостности…");
	const [entriesTotal, registerTotal] = await Promise.all([
		prisma.accountingEntry.count({ where: { organizationUuid: { in: orgUuids } } }),
		prisma.productRegister.count({ where: { organizationUuid: { in: orgUuids } } }),
	]);
	// Строки документов (по всем моделям позиций с привязкой к организации).
	let lineTotal = 0;
	for (const def of Object.values(DOC_DEFS)) {
		if (def.transfer) { lineTotal += await prisma[def.item].count({ where: { inventoryTransfer: { organizationUuid: { in: orgUuids } } } }); continue; } // у позиций перемещения нет колонки org
		lineTotal += await prisma[def.item].count({ where: { organizationUuid: { in: orgUuids } } });
	}
	const integrity = await integrityCheck(orgUuids);

	printReport(post, integrity);
	console.log(`Строк документов: ${lineTotal}, проводок: ${entriesTotal}, движений ТМЗ: ${registerTotal}`);
	console.log(`⏱  Готово за ${((Date.now() - t0) / 1000).toFixed(1)} c`);
}

main()
	.catch((e) => { console.error("❌ Ошибка генерации:", e); process.exitCode = 1; })
	.finally(async () => { await prisma.$disconnect(); });
