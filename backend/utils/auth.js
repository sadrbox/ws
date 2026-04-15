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
 * Загружает organizationUuid и isSuperAdmin из БД и добавляет в req.user.
 * Должен вызываться ПОСЛЕ authMiddleware.
 */
export async function tenantMiddleware(req, res, next) {
	if (req.method === "OPTIONS") return next();
	if (!req.user?.uuid) return next();

	try {
		const dbUser = await prisma.user.findUnique({
			where: { uuid: req.user.uuid },
			select: { organizationUuid: true, isSuperAdmin: true },
		});
		if (dbUser) {
			req.user.organizationUuid = dbUser.organizationUuid;
			req.user.isSuperAdmin = dbUser.isSuperAdmin || false;
		}
	} catch (err) {
		console.error("tenantMiddleware error:", err);
		// Не блокируем запрос, если поля ещё не существуют (миграция)
	}
	next();
}

/**
 * Формирует WHERE-фильтр для изоляции данных по организации.
 * - Суперадмин: без фильтра (видит всё)
 * - Обычный пользователь: фильтр по organizationUuid
 * @param {object} req - Express request с req.user
 * @param {string} field - название поля organizationUuid в модели (по умолчанию "organizationUuid")
 * @returns {object} prisma where-clause для добавления через spread
 */
export function tenantFilter(req, field = "organizationUuid") {
	if (!req.user) return {};
	if (req.user.isSuperAdmin) return {}; // суперадмин видит все данные
	if (!req.user.organizationUuid) return {}; // пользователь не привязан к организации — без фильтра
	return { [field]: req.user.organizationUuid };
}

// ═══════════════════════════════════════════════════════════════════════════
// Маппинг URL-путей → имя модели в AccessRight (PascalCase из ALL_MODEL_NAMES)
// ═══════════════════════════════════════════════════════════════════════════
const ROUTE_TO_MODEL = {
	organizations: "Organization",
	counterparties: "Counterparty",
	contracts: "Contract",
	"contract-files": "AttachedFile",
	contacttypes: "ContactType",
	contacts: "Contact",
	contactpersons: "ContactPerson",
	bankaccounts: "BankAccount",
	activityhistories: "ActivityHistory",
	todos: "Todo",
	notifications: "Notification",
	warehouses: "Warehouse",
	sales: "Sale",
	purchases: "Purchase",
	"outgoing-invoices": "OutgoingInvoice",
	"incoming-invoices": "IncomingInvoice",
	"payment-invoices": "PaymentInvoice",
	"scheduled-tasks": "ScheduledTask",
	"inventory-transfers": "InventoryTransfer",
	"cash-receipt-orders": "CashReceiptOrder",
	"cash-expense-orders": "CashExpenseOrder",
	brands: "Brand",
	products: "Product",
	saleitems: "SaleItem",
	employees: "Employee",
	positions: "Position",
	"employee-histories": "EmployeeHistory",
	"access-rights": "AccessRight",
	currencies: "Currency",
	"payroll-calculations": "PayrollCalculation",
	"payroll-payments": "PayrollPayment",
	users: "User",
	files: "AttachedFile",
	todofiles: "Todo",
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
export async function accessRightMiddleware(req, res, next) {
	if (req.method === "OPTIONS") return next();

	// Суперадмин — пропускаем
	if (req.user?.isSuperAdmin) return next();

	// Dev-режим: admin пропускается
	const isDev = process.env.NODE_ENV !== "production";
	if (isDev && req.user?.username?.toLowerCase() === "admin") return next();

	// Определяем имя модели из URL
	// URL вида: /api/v1/<route>/... — нам нужен первый сегмент пути
	const pathSegments = req.path.replace(/^\/+/, "").split("/");
	const routeSegment = pathSegments[0]; // например "organizations", "access-rights"

	const modelName = ROUTE_TO_MODEL[routeSegment];
	if (!modelName) {
		// Маршрут не найден в маппинге — пропускаем (например v1.js)
		return next();
	}

	try {
		const accessRight = await prisma.accessRight.findFirst({
			where: {
				userUuid: req.user.uuid,
				modelName,
			},
			select: { accessLevel: true },
		});

		const level = accessRight?.accessLevel || "none";

		// GET-запросы требуют "readonly" или "full"
		if (req.method === "GET") {
			if (level === "readonly" || level === "full") return next();
		} else {
			// POST, PUT, DELETE, PATCH — требуют "full"
			if (level === "full") return next();
		}

		return res.status(403).json({
			success: false,
			message: `Нет доступа к ${modelName} (уровень: ${level})`,
		});
	} catch (err) {
		console.error("accessRightMiddleware error:", err);
		// Если таблица access_rights ещё не создана — пропускаем
		return next();
	}
}
