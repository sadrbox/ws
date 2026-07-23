import jwt from "jsonwebtoken";
import { prisma } from "../prisma/prisma-client.js";

// JWT_SECRET загружается из .env через dotenv (в server.js)
// Если переменная не задана — сервер не запустится (проверка в server.js)
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "24h";

/**
 * Генерирует JWT-токен для пользователя
 */
export function generateToken(user) {
	return jwt.sign(
		{
			uuid: user.uuid,
			username: user.username,
		},
		JWT_SECRET,
		{ expiresIn: JWT_EXPIRES_IN },
	);
}

/**
 * Middleware аутентификации.
 * Проверяет заголовок Authorization: Bearer <token>
 * Если токен валидный — добавляет req.user и пропускает дальше.
 */
export function authMiddleware(req, res, next) {
	// Пропускаем OPTIONS (CORS preflight)
	if (req.method === "OPTIONS") return next();

	const authHeader = req.headers.authorization;
	if (!authHeader || !authHeader.startsWith("Bearer ")) {
		return res.status(401).json({
			success: false,
			message: "Требуется авторизация",
		});
	}

	const token = authHeader.slice(7);
	try {
		const decoded = jwt.verify(token, JWT_SECRET);
		req.user = decoded;
		next();
	} catch (err) {
		return res.status(401).json({
			success: false,
			message: "Недействительный или истёкший токен",
		});
	}
}

/**
 * Middleware мультитенантности.
 * Загружает organizationUuid, isSuperAdmin и роль в активной орг из БД.
 * Должен вызываться ПОСЛЕ authMiddleware.
 *
 * Устанавливает req.user:
 *   - organizationUuid  — активная организация (из User.organizationUuid)
 *   - isSuperAdmin      — глобальный суперадмин (видит всё)
 *   - isOrgAdmin        — администратор активной организации
 */
export async function tenantMiddleware(req, res, next) {
	if (req.method === "OPTIONS") return next();
	if (!req.user?.uuid) return next();

	try {
		const dbUser = await prisma.user.findUnique({
			where: { uuid: req.user.uuid },
			select: {
				organizationUuid: true,
				isSuperAdmin: true,
				accessRights: {
					select: { organizationUuid: true, role: true },
				},
			},
		});

		if (dbUser) {
			req.user.isSuperAdmin = dbUser.isSuperAdmin || false;
			req.user.organizationUuid = dbUser.organizationUuid || null;

			// Список UUID организаций, доступных пользователю
			req.user.allowedOrgUuids = dbUser.accessRights.map(
				(uo) => uo.organizationUuid,
			);

			// Роль в активной организации
			const activeOrgEntry = dbUser.accessRights.find(
				(uo) => uo.organizationUuid === dbUser.organizationUuid,
			);
			req.user.isOrgAdmin = activeOrgEntry?.role === "admin" || false;

			// Является ли администратором хотя бы одной организации
			req.user.isAnyOrgAdmin = dbUser.accessRights.some(
				(uo) => uo.role === "admin",
			);

			// Безопасность: если активная орг не входит в список разрешённых — сбрасываем
			if (
				dbUser.organizationUuid &&
				!req.user.isSuperAdmin &&
				!req.user.allowedOrgUuids.includes(dbUser.organizationUuid)
			) {
				req.user.organizationUuid = null;
				req.user.isOrgAdmin = false;
			}
		}
	} catch (err) {
		console.error("tenantMiddleware error:", err);
	}
	next();
}

/**
 * Формирует WHERE-фильтр для изоляции данных по организации.
 * - Суперадмин: без фильтра (видит всё)
 * - Обычный пользователь: фильтр по organizationUuid активной орг
 * @param {object} req - Express request с req.user
 * @param {string} field - название поля organizationUuid в модели
 * @returns {object} prisma where-clause
 */
export function tenantFilter(req, field = "organizationUuid") {
	if (!req.user) return {};
	if (req.user.isSuperAdmin) return {}; // суперадмин видит все данные
	if (!req.user.organizationUuid) {
		// нет активной орг — показываем данные всех разрешённых организаций
		if (req.user.allowedOrgUuids?.length) {
			return { [field]: { in: req.user.allowedOrgUuids } };
		}
		return { [field]: null }; // нет ни активной, ни разрешённых — ничего не видит
	}
	return { [field]: req.user.organizationUuid };
}

/**
 * Формирует WHERE-фрагмент для фильтрации справочника по организации,
 * ВЫБРАННОЙ В ФОРМЕ (req.query.organizationUuid), а не по активной орг.
 *
 * Используется зависимыми автокомплитами (склад, касса, ответственный и т.п.):
 * при выбранной в документе организации список ограничивается записями этой
 * организации + «глобальными» (organizationUuid = null), доступными всем.
 *
 * Если query-параметр не передан — возвращает {} (фильтрация не применяется,
 * изоляцию обеспечивает tenantFilter).
 *
 * @param {object} req   — Express request
 * @param {string} field — поле организации в модели (по умолчанию organizationUuid)
 * @returns {object} prisma where-fragment ({} | { OR: [...] })
 */
export function orgQueryFilter(req, field = "organizationUuid") {
	const raw = req.query?.[field];
	if (typeof raw !== "string" || !raw.trim()) return {};
	const val = raw.trim();
	if (val === "null") return { [field]: null };
	// записи выбранной орг + глобальные (общие для всех орг)
	return { OR: [{ [field]: val }, { [field]: null }] };
}

/**
 * Проверяет, имеет ли текущий пользователь доступ к конкретной записи.
 * Возвращает false → должен следовать ответ 404 (не 403, чтобы не раскрывать существование).
 *
 * @param {object|null} item   — запись из БД (может быть null)
 * @param {object}      req    — Express request с req.user
 * @param {string}      field  — поле организации в записи (по умолчанию "organizationUuid")
 */
export function checkOwnership(item, req, field = "organizationUuid") {
	if (!item) return false;
	if (!req.user) return false;
	if (req.user.isSuperAdmin) return true;

	const itemOrgUuid = item[field] ?? null;
	if (itemOrgUuid === null) return true; // глобальная запись — доступна всем

	const activeOrg = req.user.organizationUuid ?? null;
	const allowedOrgs = req.user.allowedOrgUuids ?? [];

	if (activeOrg && itemOrgUuid === activeOrg) return true;
	if (allowedOrgs.includes(itemOrgUuid)) return true;

	return false;
}

/**
 * Проверяет, что FK-поля в body документа ссылаются на записи из организаций,
 * доступных текущему пользователю. Принимает массив { model, uuid } — пар,
 * где model — camelCase Prisma-модель с полем organizationUuid.
 *
 * Возвращает null если всё ок, или строку с сообщением об ошибке.
 *
 * @param {object} req   — Express request
 * @param {object} tx    — Prisma client или transaction
 * @param {Array}  checks — [{ model: "warehouse", uuid: "..." }, ...]
 */
export async function checkFkOwnership(req, tx, checks) {
	if (!req.user || req.user.isSuperAdmin) return null;
	for (const { model, uuid } of checks) {
		if (!uuid) continue;
		try {
			const record = await tx[model].findUnique({
				where: { uuid },
				select: { organizationUuid: true },
			});
			if (!checkOwnership(record, req)) {
				return `Запись ${model} (${uuid}) не принадлежит вашей организации`;
			}
		} catch {
			// Модель не имеет organizationUuid — пропускаем
		}
	}
	return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Маппинг URL-путей → имя модели в AccessPermission (PascalCase из ALL_MODEL_NAMES)
// ═══════════════════════════════════════════════════════════════════════════
export const ROUTE_TO_MODEL = {
	organizations: "Organization",
	counterparties: "Counterparty",
	contracts: "Contract",
	"contract-files": "AttachedFile",
	contacts: "Contact",
	contactpersons: "ContactPerson",
	bankaccounts: "BankAccount",
	activityhistories: "ActivityHistory",
	// Входящие события 1С — тот же журнал, только внешний источник: право общее.
	pipeactivities: "ActivityHistory",
	// Ввод остатков серий/партий меняет учётные данные товара → право номенклатуры.
	"opening-balance": "Product",
	todos: "Todo",
	// Справочник статусов задач — КОНФИГУРАЦИЯ, а не пользовательский контент:
	// переименование/удаление статуса влияет на все задачи организации, поэтому
	// требует того же права, что и сами задачи (фронт гейтит меню так же).
	"todo-statuses": "Todo",
	warehouses: "Warehouse",
	cashboxes: "Cashbox",
	sales: "Sale",
	"sale-returns": "SaleReturn",
	"sale-return-items": "SaleReturnItem",
	purchases: "Purchase",
	"purchase-returns": "PurchaseReturn",
	"purchase-return-items": "PurchaseReturnItem",
	"outgoing-invoices": "OutgoingInvoice",
	"incoming-invoices": "IncomingInvoice",
	"payment-invoices": "PaymentInvoice",
	"purchase-requisitions": "PurchaseRequisition",
	"purchase-requisition-items": "PurchaseRequisitionItem",
	"commercial-offers": "CommercialOffer",
	"commercial-offer-items": "CommercialOfferItem",
	"sales-orders": "SalesOrder",
	"sales-order-items": "SalesOrderItem",
	"reservations": "Reservation",
	"reservation-items": "ReservationItem",
	"purchase-orders": "PurchaseOrder",
	"purchase-order-items": "PurchaseOrderItem",
	importdeclarations: "ImportDeclaration",
	importdeclarationitems: "ImportDeclarationItem",
	writeoffs: "WriteOff",
	writeoffitems: "WriteOffItem",
	goodsreceipts: "GoodsReceipt",
	goodsreceiptitems: "GoodsReceiptItem",
	stockcounts: "StockCount",
	stockcountitems: "StockCountItem",
	serialnumbers: "SerialNumber",
	productbatches: "ProductBatch",
	"bank-statements": "BankStatement",
	"scheduled-tasks": "ScheduledTask",
	"inventory-transfers": "InventoryTransfer",
	"cash-receipt-orders": "CashReceiptOrder",
	"cash-expense-orders": "CashExpenseOrder",
	brands: "Brand",
	products: "Product",
	productbarcodes: "Product",
	saleitems: "SaleItem",
	employees: "Employee",
	positions: "Position",
	"employee-histories": "EmployeeHistory",
	"access-permissions": "AccessPermission",
	currencies: "Currency",
	"unit-of-measures": "UnitOfMeasure",
	"vat-rates": "VatRate",
	"payroll-calculations": "PayrollCalculation",
	"payroll-payments": "PayrollPayment",
	"chart-of-accounts": "ChartOfAccount",
	"subkonto-types": "SubkontoType",
	accounting: "AccountingEntry",
	users: "User",
	files: "AttachedFile",
};

/**
 * Middleware проверки прав доступа.
 *
 * Определяет имя модели из URL, загружает `accessLevel` пользователя
 * и проверяет разрешение:
 *   - GET  → требуется "readonly" или "full"
 *   - POST / PUT / DELETE → требуется "full"
 *   - "none" или отсутствие записи → 403 Forbidden
 *
 * Суперадмин и dev-admin пропускаются без проверки.
 *
 * ДОЛЖЕН вызываться ПОСЛЕ authMiddleware + tenantMiddleware.
 */
export async function accessPermissionMiddleware(req, res, next) {
	if (req.method === "OPTIONS") return next();

	// Суперадмин — пропускаем
	if (req.user?.isSuperAdmin) return next();

	// Org admin — полный доступ ко всем разделам своей организации
	if (req.user?.isOrgAdmin || req.user?.isAnyOrgAdmin) return next();

	// Dev-режим: admin пропускается
	const isDev = process.env.NODE_ENV !== "production";
	if (isDev && req.user?.username?.toLowerCase() === "admin") return next();

	// Определяем имя модели из URL
	const pathSegments = req.path.replace(/^\/+/, "").split("/");
	const routeSegment = pathSegments[0];

	const modelName = ROUTE_TO_MODEL[routeSegment];
	if (!modelName) return next();

	try {
		// Ищем права с учётом активной организации пользователя.
		// Приоритет: org-specific право для активной орг > право для любой allowedOrg > глобальное (organizationUuid = null)
		const orgUuid = req.user?.organizationUuid || null;
		const allowedOrgUuids = req.user?.allowedOrgUuids || [];

		// Все организации для поиска прав: активная + все разрешённые
		const orgsToCheck = orgUuid
			? [orgUuid, ...allowedOrgUuids.filter((u) => u !== orgUuid)]
			: allowedOrgUuids;

		const [anyOrgRight, globalRight] = await Promise.all([
			orgsToCheck.length > 0
				? prisma.accessPermission.findFirst({
						where: {
							userUuid: req.user.uuid,
							modelName,
							organizationUuid: { in: orgsToCheck },
						},
						// Приоритет: активная org выше, чем любая другая
						orderBy: orgUuid
							? [{ organizationUuid: "asc" }] // активная будет найдена через in
							: undefined,
						select: { accessLevel: true, organizationUuid: true },
					})
				: null,
			prisma.accessPermission.findFirst({
				where: { userUuid: req.user.uuid, modelName, organizationUuid: null },
				select: { accessLevel: true },
			}),
		]);

		// Если несколько org-прав — ищем активную отдельно для точного приоритета
		let orgRight = anyOrgRight;
		if (orgUuid && anyOrgRight && anyOrgRight.organizationUuid !== orgUuid) {
			// Есть право для другой орг, но не для активной — оставляем как fallback
			// Дополнительно ищем именно для активной
			const activeOrgRight = await prisma.accessPermission.findFirst({
				where: {
					userUuid: req.user.uuid,
					modelName,
					organizationUuid: orgUuid,
				},
				select: { accessLevel: true },
			});
			orgRight = activeOrgRight ?? anyOrgRight;
		}

		const level = orgRight?.accessLevel ?? globalRight?.accessLevel ?? "none";

		if (req.method === "GET") {
			if (level === "readonly" || level === "full") return next();
		} else {
			if (level === "full") return next();
		}

		// Логируем попытку несанкционированного доступа
		const orgCtx = orgUuid || allowedOrgUuids.join(",") || "no-org";
		console.warn(
			`[AccessDenied] user=${req.user?.username} org=${orgCtx} model=${modelName} method=${req.method} level=${level} ip=${req.ip}`,
		);

		return res.status(403).json({
			success: false,
			message: `Нет доступа к ${modelName}`,
		});
	} catch (err) {
		console.error("accessPermissionMiddleware error:", err);
		return next();
	}
}
