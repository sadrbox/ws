// ── Загрузка переменных окружения (должен быть самым первым) ─────────────
import "dotenv/config";

// ── Проверка обязательных переменных окружения ──────────────────────────
const requiredEnv = ["JWT_SECRET", "DATABASE_URL"];
for (const key of requiredEnv) {
	if (!process.env[key]) {
		console.error(`FATAL: Переменная окружения ${key} не задана`);
		process.exit(1);
	}
}

import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { getLocalIP } from "./utils/module.js";
import {
	authMiddleware,
	tenantMiddleware,
	userAccessRightMiddleware,
} from "./utils/auth.js";

// ── Роутеры ─────────────────────────────────────────────────────────────
import authRouter from "./api/router/auth.js";
import apiv1 from "./api/v1.js";
import counterpartiesRouter from "./api/router/counterparties.js";
import activityHistoriesRouter from "./api/router/activityhistories.js";
import organizationsRouter from "./api/router/organizations.js";
import contractsRouter from "./api/router/contracts.js";
import filesRouter from "./api/router/files.js";
import bankAccountsRouter from "./api/router/bankaccounts.js";
import contactsRouter from "./api/router/contacts.js";
import contactPersonsRouter from "./api/router/contactpersons.js";
import usersRouter from "./api/router/users.js";
import todosRouter from "./api/router/todos.js";
import warehousesRouter from "./api/router/warehouses.js";
import cashboxesRouter from "./api/router/cashboxes.js";
import salesRouter from "./api/router/sales.js";
import saleReturnsRouter from "./api/router/salereturns.js";
import saleReturnItemsRouter from "./api/router/salereturnitems.js";
import purchasesRouter from "./api/router/purchases.js";
import purchaseReturnsRouter from "./api/router/purchasereturns.js";
import purchaseReturnItemsRouter from "./api/router/purchasereturnitems.js";
import outgoingInvoicesRouter from "./api/router/outgoinginvoices.js";
import incomingInvoicesRouter from "./api/router/incominginvoices.js";
import paymentInvoicesRouter from "./api/router/paymentinvoices.js";
import purchaseRequisitionsRouter from "./api/router/purchaserequisitions.js";
import documentChainRouter from "./api/router/documentchain.js";
import scheduledTasksRouter from "./api/router/scheduledtasks.js";
import inventoryTransfersRouter from "./api/router/inventorytransfers.js";
import cashReceiptOrdersRouter from "./api/router/cashreceiptorders.js";
import cashExpenseOrdersRouter from "./api/router/cashexpenseorders.js";
import brandsRouter from "./api/router/brands.js";
import productsRouter from "./api/router/products.js";
import productBarcodesRouter from "./api/router/productbarcodes.js";
import saleItemsRouter from "./api/router/saleitems.js";
import purchaseItemsRouter from "./api/router/purchaseitems.js";
import outgoingInvoiceItemsRouter from "./api/router/outgoinginvoiceitems.js";
import incomingInvoiceItemsRouter from "./api/router/incominginvoiceitems.js";
import paymentInvoiceItemsRouter from "./api/router/paymentinvoiceitems.js";
import purchaseRequisitionItemsRouter from "./api/router/purchaserequisitionitems.js";
import inventoryTransferItemsRouter from "./api/router/inventorytransferitems.js";
import commercialOffersRouter from "./api/router/commercialoffers.js";
import commercialOfferItemsRouter from "./api/router/commercialofferitems.js";
import salesOrdersRouter from "./api/router/salesorders.js";
import salesOrderItemsRouter from "./api/router/salesorderitems.js";
import reservationsRouter from "./api/router/reservations.js";
import reservationItemsRouter from "./api/router/reservationitems.js";
import purchaseOrdersRouter from "./api/router/purchaseorders.js";
import purchaseOrderItemsRouter from "./api/router/purchaseorderitems.js";
import bankStatementsRouter from "./api/router/bankstatements.js";
import currenciesRouter from "./api/router/currencies.js";
import employeesRouter from "./api/router/employees.js";
import positionsRouter from "./api/router/positions.js";
import employeeHistoriesRouter from "./api/router/employeehistories.js";
import userSettingsRouter from "./api/router/usersettings.js";
import userAccessRightsRouter from "./api/router/useraccessrights.js";
import userDefaultsRouter from "./api/router/userdefaults.js";
import payrollCalculationsRouter from "./api/router/payrollcalculations.js";
import payrollPaymentsRouter from "./api/router/payrollpayments.js";
import unitOfMeasuresRouter from "./api/router/unitofmeasures.js";
import taxesRouter from "./api/router/taxes.js";
import organizationAccountingSettingsRouter from "./api/router/organizationaccountingsettings.js";
import syncRouter from "./api/router/sync.js";
import refReplacementRouter from "./api/router/refreplacement.js";
import reportsRouter from "./api/router/reports.js";
import productRegisterRouter from "./api/router/productregister.js";
import chartOfAccountsRouter from "./api/router/chartofaccounts.js";
import subkontoTypesRouter from "./api/router/subkontotypes.js";
import accountingRouter from "./api/router/accounting.js";
import documentNumberSettingsRouter from "./api/router/documentnumbersettings.js";
import documentNumberRouter from "./api/router/documentNumber.js";
import priceTypesRouter from "./api/router/pricetypes.js";
import productPricesRouter from "./api/router/productprices.js";

const app = express();

// ═══════════════════════════════════════════════════════════════════════════
// 1. БЕЗОПАСНОСТЬ
// ═══════════════════════════════════════════════════════════════════════════

// Заголовки безопасности (XSS, clickjacking, MIME-sniffing и т.д.)
app.use(helmet());

// Не раскрывать заголовок X-Powered-By
app.disable("x-powered-by");

// CORS — только разрешённые домены
const allowedOrigins = (process.env.CORS_ORIGIN || "")
	.split(",")
	.map((o) => o.trim())
	.filter(Boolean);

app.use(
	cors({
		origin: (origin, callback) => {
			// Разрешаем запросы без origin (curl, Postman, серверные запросы)
			if (!origin) return callback(null, true);
			if (allowedOrigins.includes(origin)) return callback(null, true);
			return callback(new Error("Запрещено CORS-политикой"));
		},
		credentials: true,
		methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
		allowedHeaders: [
			"Content-Type",
			"Authorization",
			"Accept",
			"Cache-Control",
			"Pragma",
			"X-Force-Overwrite",
			"X-Organization-ID",
		],
	}),
);

// Явный обработчик preflight для всех маршрутов
app.options(
	"*",
	cors({
		origin: (origin, callback) => {
			if (!origin) return callback(null, true);
			if (allowedOrigins.includes(origin)) return callback(null, true);
			return callback(new Error("Запрещено CORS-политикой"));
		},
		credentials: true,
		methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
		allowedHeaders: [
			"Content-Type",
			"Authorization",
			"Accept",
			"Cache-Control",
			"Pragma",
			"X-Force-Overwrite",
			"X-Organization-ID",
		],
	}),
);

// Rate limiting — защита от brute-force и DDoS
const apiLimiter = rateLimit({
	windowMs: 15 * 60 * 1000, // 15 минут
	max: 2000, // максимум 2000 запросов с одного IP за 15 мин
	standardHeaders: true,
	legacyHeaders: false,
	message: {
		success: false,
		message: "Слишком много запросов, попробуйте позже",
	},
});
app.use("/api/", apiLimiter);

// Rate limiting по организации — дополнительная защита от утечки данных между тенантами
const orgLimiter = rateLimit({
	windowMs: 1 * 60 * 1000, // 1 минута
	max: 600, // 600 запросов от одной организации в минуту
	standardHeaders: true,
	legacyHeaders: false,
	keyGenerator: (req) => {
		// Ключ: organizationUuid из middleware (если доступен) или нормализованный IP
		if (req.user?.organizationUuid) return `org:${req.user.organizationUuid}`;
		// Нормализуем IPv6 mapped IPv4 (::ffff:x.x.x.x → x.x.x.x)
		const ip = (req.ip || "").replace(/^::ffff:/, "");
		return `ip:${ip}`;
	},
	skip: (req) => !req.user, // пропускаем неаутентифицированные запросы
	message: {
		success: false,
		message: "Слишком много запросов от организации, попробуйте позже",
	},
});
app.use("/api/v1", orgLimiter);

// Более жёсткий лимит для авторизации (защита от brute-force паролей)
const authLimiter = rateLimit({
	windowMs: 15 * 60 * 1000,
	max: 20, // 20 попыток за 15 минут
	standardHeaders: true,
	legacyHeaders: false,
	message: {
		success: false,
		message: "Слишком много попыток входа, попробуйте позже",
	},
});
app.use("/api/v1/auth/login", authLimiter);

// ═══════════════════════════════════════════════════════════════════════════
// 2. ПАРСИНГ ТЕЛА ЗАПРОСА
// ═══════════════════════════════════════════════════════════════════════════

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

// ═══════════════════════════════════════════════════════════════════════════
// 3. ЛОГИРОВАНИЕ ЗАПРОСОВ
// ═══════════════════════════════════════════════════════════════════════════

app.use((req, res, next) => {
	const start = Date.now();
	res.on("finish", () => {
		const duration = Date.now() - start;
		console.log(`${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
	});
	next();
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. HEALTH CHECK (без авторизации)
// ═══════════════════════════════════════════════════════════════════════════

app.get("/api/health", (_req, res) => {
	res.json({
		status: "ok",
		timestamp: new Date().toISOString(),
		version: "1.0.0",
	});
});

app.head("/api/health", (_req, res) => {
	res.status(200).end();
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. ОТКРЫТЫЕ МАРШРУТЫ (без авторизации)
// ═══════════════════════════════════════════════════════════════════════════

app.use("/api/v1", authRouter);

// ═══════════════════════════════════════════════════════════════════════════
// 6. ЗАЩИЩЁННЫЕ МАРШРУТЫ (требуют JWT)
// ═══════════════════════════════════════════════════════════════════════════

app.use("/api/v1", authMiddleware);
app.use("/api/v1", tenantMiddleware);
app.use("/api/v1", userAccessRightMiddleware);

app.use("/api/v1", apiv1);
app.use("/api/v1", counterpartiesRouter);
app.use("/api/v1", activityHistoriesRouter);
app.use("/api/v1", organizationsRouter);
app.use("/api/v1", contractsRouter);
app.use("/api/v1", filesRouter);
app.use("/api/v1", bankAccountsRouter);
app.use("/api/v1", contactsRouter);
app.use("/api/v1", contactPersonsRouter);
app.use("/api/v1", usersRouter);
app.use("/api/v1", todosRouter);
app.use("/api/v1", warehousesRouter);
app.use("/api/v1", cashboxesRouter);
app.use("/api/v1", documentChainRouter);
app.use("/api/v1", salesRouter);
app.use("/api/v1", saleReturnsRouter);
app.use("/api/v1", saleReturnItemsRouter);
app.use("/api/v1", purchasesRouter);
app.use("/api/v1", purchaseReturnsRouter);
app.use("/api/v1", purchaseReturnItemsRouter);
app.use("/api/v1", outgoingInvoicesRouter);
app.use("/api/v1", incomingInvoicesRouter);
app.use("/api/v1", paymentInvoicesRouter);
app.use("/api/v1", purchaseRequisitionsRouter);
app.use("/api/v1", scheduledTasksRouter);
app.use("/api/v1", inventoryTransfersRouter);
app.use("/api/v1", cashReceiptOrdersRouter);
app.use("/api/v1", cashExpenseOrdersRouter);
app.use("/api/v1", brandsRouter);
app.use("/api/v1", productsRouter);
app.use("/api/v1", productBarcodesRouter);
app.use("/api/v1", saleItemsRouter);
app.use("/api/v1", purchaseItemsRouter);
app.use("/api/v1", outgoingInvoiceItemsRouter);
app.use("/api/v1", incomingInvoiceItemsRouter);
app.use("/api/v1", paymentInvoiceItemsRouter);
app.use("/api/v1", purchaseRequisitionItemsRouter);
app.use("/api/v1", inventoryTransferItemsRouter);
app.use("/api/v1", commercialOffersRouter);
app.use("/api/v1", commercialOfferItemsRouter);
app.use("/api/v1", salesOrdersRouter);
app.use("/api/v1", salesOrderItemsRouter);
app.use("/api/v1", reservationsRouter);
app.use("/api/v1", reservationItemsRouter);
app.use("/api/v1", purchaseOrdersRouter);
app.use("/api/v1", purchaseOrderItemsRouter);
app.use("/api/v1", bankStatementsRouter);
app.use("/api/v1", currenciesRouter);
app.use("/api/v1", employeesRouter);
app.use("/api/v1", positionsRouter);
app.use("/api/v1", employeeHistoriesRouter);
app.use("/api/v1", userSettingsRouter);
app.use("/api/v1", userAccessRightsRouter);
app.use("/api/v1", userDefaultsRouter);
app.use("/api/v1", payrollCalculationsRouter);
app.use("/api/v1", payrollPaymentsRouter);
app.use("/api/v1", unitOfMeasuresRouter);
app.use("/api/v1", taxesRouter);
app.use("/api/v1", organizationAccountingSettingsRouter);
app.use("/api/v1", syncRouter);
app.use("/api/v1", refReplacementRouter);
app.use("/api/v1", reportsRouter);
app.use("/api/v1", productRegisterRouter);
app.use("/api/v1", chartOfAccountsRouter);
app.use("/api/v1", subkontoTypesRouter);
app.use("/api/v1", accountingRouter);
app.use("/api/v1", documentNumberSettingsRouter);
app.use("/api/v1", documentNumberRouter);
app.use("/api/v1", priceTypesRouter);
app.use("/api/v1", productPricesRouter);

// ═══════════════════════════════════════════════════════════════════════════
// 7. ОБРАБОТКА 404
// ═══════════════════════════════════════════════════════════════════════════

app.use((_req, res) => {
	res.status(404).json({
		success: false,
		message: "Endpoint не найден",
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. ГЛОБАЛЬНЫЙ ОБРАБОТЧИК ОШИБОК
// ═══════════════════════════════════════════════════════════════════════════

app.use((err, _req, res, _next) => {
	console.error("Global error handler:", err);

	// CORS ошибки
	if (err.message === "Запрещено CORS-политикой") {
		return res.status(403).json({ success: false, message: err.message });
	}

	const statusCode = err.status || 500;
	res.status(statusCode).json({
		success: false,
		message: statusCode === 500 ? "Внутренняя ошибка сервера" : err.message,
		...(process.env.NODE_ENV !== "production" && { stack: err.stack }),
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// 9. ЗАПУСК СЕРВЕРА
// ═══════════════════════════════════════════════════════════════════════════

const port = parseInt(process.env.PORT, 10) || 3000;
const ip = getLocalIP();

const server = app.listen(port, () => {
	console.log(`Server is running on http://${ip}:${port}`);
	console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
});

// Graceful shutdown
const gracefulShutdown = (signal) => {
	console.log(`${signal} received: closing HTTP server`);
	server.close(() => {
		console.log("HTTP server closed");
		process.exit(0);
	});

	// Принудительное завершение через 10 секунд
	setTimeout(() => {
		console.error("Forced shutdown after timeout");
		process.exit(1);
	}, 10_000);
};

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
