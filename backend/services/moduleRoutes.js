// КАКОМУ МОДУЛЮ ПРИНАДЛЕЖИТ МАРШРУТ (О7 плана PLAN_INSTALL_MODES_2026-09-24.md).
//
// ЗАЧЕМ. Гард модулей закрывал только СОЗДАНИЕ документов: `POST` у одиннадцати точных путей и
// лишь при `organizationUuid` в теле. У организации с отключёнными «Продажами» по-прежнему
// читались списки, правились и удалялись документы, строились отчёты, печатались формы. То есть
// отключение означало «скрыли меню и запретили кнопку» — ровно то, от чего владелец просил уйти
// (М1 разбора `docs/DESIGN_PREINSTALL_AUDIT_2026-09-24.md`).
//
// ЗДЕСЬ карта «первый сегмент пути → ключ модуля» на ВСЕ методы. Сегмента нет в карте — путь к
// модулям отношения не имеет (справочники, настройки, ядро учёта) и гардом не трогается.
//
// БЕЗ PRISMA: проверяется тестом в гейте и читается панелью установщика.

/**
 * Маршруты модулей. Ключи — первые сегменты путей (как в `ROUTE_TO_MODEL`), значения — ключи
 * модулей из `MODULE_KEYS` (`services/moduleAccess.js`).
 *
 * ЧЕГО ЗДЕСЬ НАМЕРЕННО НЕТ: справочники (товары, контрагенты, склады как справочник, валюты),
 * план счетов, проводки, закрытие периода, пользователи и права. Это ЯДРО: без него не работает
 * ни один модуль, и отключать его нечем.
 */
export const MODULE_ROUTES = {
	// ── Продажи ──────────────────────────────────────────────────────────────
	sales: "sales",
	"sale-items": "sales",
	"sale-returns": "sales",
	"sale-return-items": "sales",
	"sales-orders": "sales",
	"sales-order-items": "sales",
	"commercial-offers": "sales",
	"commercial-offer-items": "sales",
	reservations: "sales",
	"reservation-items": "sales",
	"outgoing-invoices": "sales",
	"outgoing-invoice-items": "sales",
	"fiscal-receipts": "sales",

	// ── Закупки ──────────────────────────────────────────────────────────────
	purchases: "purchase",
	"purchase-items": "purchase",
	"purchase-returns": "purchase",
	"purchase-return-items": "purchase",
	"purchase-orders": "purchase",
	"purchase-order-items": "purchase",
	"purchase-requisitions": "purchase",
	"purchase-requisition-items": "purchase",
	"incoming-invoices": "purchase",
	"incoming-invoice-items": "purchase",
	"import-declarations": "purchase",
	"import-declaration-items": "purchase",

	// ── Склад ────────────────────────────────────────────────────────────────
	"inventory-transfers": "warehouse",
	"inventory-transfer-items": "warehouse",
	writeoffs: "warehouse",
	"writeoff-items": "warehouse",
	goodsreceipts: "warehouse",
	"goodsreceipt-items": "warehouse",
	stockcounts: "warehouse",
	"stockcount-items": "warehouse",
	"serial-numbers": "warehouse",
	"product-batches": "warehouse",

	// ── Касса и банк ─────────────────────────────────────────────────────────
	"cash-receipt-orders": "cash",
	"cash-expense-orders": "cash",
	cashboxes: "cash",
	"bank-statements": "cash",
	"payment-invoices": "cash",
	"payment-invoice-items": "cash",

	// ── Кадры и зарплата ─────────────────────────────────────────────────────
	"payroll-calculations": "hr",
	"payroll-payments": "hr",
	"employee-histories": "hr",
	positions: "hr",

	// ── Гос-документы РК ─────────────────────────────────────────────────────
	awp: "govdocs",
	snt: "govdocs",
	esf: "govdocs",
	"esf-inbound": "govdocs",

	// ── ЭДО с контрагентами ──────────────────────────────────────────────────
	edo: "edo",
};

/** Ключ модуля для сегмента пути; null — маршрут к модулям не относится (ядро). */
export function moduleOfRoute(segment) {
	return MODULE_ROUTES[segment] ?? null;
}

/**
 * Режим гарда — рубильник на случай, если полное закрытие где-то окажется слишком строгим.
 *
 *   full        (по умолчанию) — модуль отключён, значит недоступен ЦЕЛИКОМ: чтение, запись,
 *                                печать, выгрузки. Это и есть заказанное поведение;
 *   create-only                — прежнее: запрещено только создание документов.
 *
 * ⚠ ПРОВЕРИТЬ ПОТОМ: отключить один модуль на тестовой организации и пройти её сценарии —
 * списки, печать, отчёты, помощник. Если что-то нужное закрылось, временно `create-only` и
 * поправить карту выше.
 */
export function guardMode() {
	return process.env.MODULE_GUARD === "create-only" ? "create-only" : "full";
}

export default { MODULE_ROUTES, moduleOfRoute, guardMode };
