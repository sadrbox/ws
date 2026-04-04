import express from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../../prisma/prisma-client.js";
import { generateToken, authMiddleware } from "../../utils/auth.js";

const router = express.Router();

// ── Полный список моделей для назначения прав ───────────────────────────
const ALL_MODEL_NAMES = [
	"Organization",
	"Counterparty",
	"Contract",
	"AttachedFile",
	"ContactType",
	"Contact",
	"ContactPerson",
	"BankAccount",
	"ActivityHistory",
	"Todo",
	"Notification",
	"Warehouse",
	"Sale",
	"Purchase",
	"OutgoingInvoice",
	"IncomingInvoice",
	"PaymentInvoice",
	"ScheduledTask",
	"InventoryTransfer",
	"CashReceiptOrder",
	"CashExpenseOrder",
	"Brand",
	"Product",
	"SaleItem",
	"Employee",
	"Position",
	"EmployeeHistory",
	"AccessRight",
	"Currency",
	"User",
];

/**
 * Генерирует виртуальные «полные права на всё» для admin-пользователя (dev-режим).
 * Не записывает в БД — возвращает массив объектов, идентичных AccessRight.
 */
function generateFullAccessRights() {
	return ALL_MODEL_NAMES.map((name) => ({
		modelName: name,
		accessLevel: "full",
	}));
}

// ============================================
// POST /auth/login
// ============================================
router.post("/auth/login", async (req, res) => {
	try {
		const { username, password } = req.body;

		if (!username || typeof username !== "string") {
			return res.status(400).json({
				success: false,
				message: "Имя пользователя обязательно",
			});
		}

		const trimmedUsername = username.trim();

		// Поиск пользователя по username (может содержать кириллицу, пробелы, знаки препинания)
		const user = await prisma.user.findFirst({
			where: {
				username: {
					equals: trimmedUsername,
					mode: "insensitive",
				},
			},
			include: { employee: true },
		});

		// Единое сообщение — не раскрываем, что именно неверно (защита от перебора)
		const INVALID_CREDENTIALS = "Неверное имя пользователя или пароль";

		if (!user) {
			return res.status(401).json({
				success: false,
				message: INVALID_CREDENTIALS,
			});
		}

		// Подгружаем accessRights отдельно (таблица может ещё не существовать после миграции)
		let accessRights = [];
		if (user.employee && prisma.accessRight) {
			try {
				accessRights = await prisma.accessRight.findMany({
					where: { employeeUuid: user.employee.uuid },
					orderBy: { modelName: "asc" },
				});
			} catch (_) {
				// Таблица access_rights ещё не создана — игнорируем
			}
		}

		// Есть ли у пользователя установленный пароль?
		const hasPassword = user.password && user.password.trim() !== "";
		const isDev = process.env.NODE_ENV !== "production";

		if (!hasPassword) {
			if (isDev) {
				// В dev-режиме разрешаем вход без пароля (для удобства разработки)
				console.warn(`[DEV] Вход без пароля: ${user.username}`);
			} else {
				return res.status(401).json({
					success: false,
					message: "Пароль не установлен. Обратитесь к администратору",
				});
			}
		} else {
			// Пароль установлен — проверяем
			if (!password || typeof password !== "string") {
				return res.status(401).json({
					success: false,
					message: INVALID_CREDENTIALS,
				});
			}

			// Проверяем: если пароль — bcrypt-хэш
			const isHashed =
				user.password.startsWith("$2a$") || user.password.startsWith("$2b$");

			let passwordValid = false;
			if (isHashed) {
				passwordValid = await bcrypt.compare(password, user.password);
			} else {
				// Миграция со старых plain text паролей: проверяем и хешируем
				passwordValid = password === user.password;
				if (passwordValid) {
					const hashed = await bcrypt.hash(password, 12);
					await prisma.user.update({
						where: { uuid: user.uuid },
						data: { password: hashed },
					});
				}
			}

			if (!passwordValid) {
				return res.status(401).json({
					success: false,
					message: INVALID_CREDENTIALS,
				});
			}
		}

		// Генерируем JWT-токен
		const token = generateToken(user);

		// Для admin в dev-режиме — виртуальные полные права на все модели
		let employeeData = user.employee || null;
		if (employeeData) {
			const rights =
				isDev && trimmedUsername.toLowerCase() === "admin"
					? generateFullAccessRights()
					: accessRights;
			employeeData = { ...employeeData, accessRights: rights };
		}

		return res.status(200).json({
			success: true,
			token,
			user: {
				uuid: user.uuid,
				username: user.username,
				email: user.email,
				employee: employeeData,
			},
		});
	} catch (error) {
		console.error("POST /auth/login error:", error);
		return res.status(500).json({
			success: false,
			message: "Ошибка сервера",
		});
	}
});

// ============================================
// GET /auth/me — текущий пользователь
// ============================================
router.get("/auth/me", authMiddleware, async (req, res) => {
	try {
		// req.user установлен middleware
		if (!req.user || !req.user.uuid) {
			return res
				.status(401)
				.json({ success: false, message: "Не авторизован" });
		}

		const user = await prisma.user.findUnique({
			where: { uuid: req.user.uuid },
			select: {
				uuid: true,
				username: true,
				email: true,
				employeeUuid: true,
				employee: true,
			},
		});

		if (!user) {
			return res
				.status(404)
				.json({ success: false, message: "Пользователь не найден" });
		}

		// Подгружаем accessRights отдельно (таблица может ещё не существовать)
		let accessRights = [];
		if (user.employee && prisma.accessRight) {
			try {
				accessRights = await prisma.accessRight.findMany({
					where: { employeeUuid: user.employee.uuid },
					orderBy: { modelName: "asc" },
				});
			} catch (_) {
				// Таблица access_rights ещё не создана — игнорируем
			}
		}

		// Для admin в dev-режиме — виртуальные полные права на все модели
		const isDev = process.env.NODE_ENV !== "production";
		if (user.employee) {
			const rights =
				isDev && user.username?.toLowerCase() === "admin"
					? generateFullAccessRights()
					: accessRights;
			user.employee = { ...user.employee, accessRights: rights };
		}

		return res.status(200).json({ success: true, user });
	} catch (error) {
		console.error("GET /auth/me error:", error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ============================================
// POST /auth/change-password
// ============================================
router.post("/auth/change-password", authMiddleware, async (req, res) => {
	try {
		if (!req.user || !req.user.uuid) {
			return res
				.status(401)
				.json({ success: false, message: "Не авторизован" });
		}

		const { oldPassword, newPassword } = req.body;
		if (
			!newPassword ||
			typeof newPassword !== "string" ||
			newPassword.length < 6
		) {
			return res.status(400).json({
				success: false,
				message: "Новый пароль должен быть не менее 6 символов",
			});
		}

		const user = await prisma.user.findUnique({
			where: { uuid: req.user.uuid },
		});
		if (!user) {
			return res
				.status(404)
				.json({ success: false, message: "Пользователь не найден" });
		}

		// Проверяем старый пароль, если он был задан
		const hasOldPassword = user.password && user.password.trim() !== "";
		if (hasOldPassword) {
			if (!oldPassword) {
				return res
					.status(400)
					.json({ success: false, message: "Текущий пароль обязателен" });
			}
			const isHashed =
				user.password.startsWith("$2a$") || user.password.startsWith("$2b$");
			let valid = false;
			if (isHashed) {
				valid = await bcrypt.compare(oldPassword, user.password);
			} else {
				// Миграция: plain text → bcrypt
				valid = oldPassword === user.password;
			}
			if (!valid) {
				return res
					.status(401)
					.json({ success: false, message: "Неверный текущий пароль" });
			}
		}

		const hashed = await bcrypt.hash(newPassword, 12);
		await prisma.user.update({
			where: { uuid: req.user.uuid },
			data: { password: hashed },
		});

		return res.status(200).json({ success: true, message: "Пароль изменён" });
	} catch (error) {
		console.error("POST /auth/change-password error:", error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

export default router;
