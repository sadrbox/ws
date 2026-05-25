import express from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { prisma } from "../../prisma/prisma-client.js";
import { generateToken, authMiddleware } from "../../utils/auth.js";

const router = express.Router();

/**
 * Загружает accessRights, отфильтрованные по активной организации.
 * Возвращает только права для activeOrg + глобальные права (organizationUuid = null).
 * Если нет активной орг — только глобальные права.
 */
async function loadAccessRights(userUuid, organizationUuid) {
	try {
		const orgUuid = organizationUuid || null;
		const where = orgUuid
			? { userUuid, OR: [{ organizationUuid: orgUuid }, { organizationUuid: null }] }
			: { userUuid, organizationUuid: null };
		return await prisma.accessRight.findMany({ where, orderBy: { modelName: "asc" } });
	} catch (_) {
		return [];
	}
}

// ── Полный список моделей для назначения прав ───────────────────────────
const ALL_MODEL_NAMES = [
	"Organization",
	"Counterparty",
	"Contract",
	"AttachedFile",
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
	"UnitOfMeasure",
	"VatRate",
	"PayrollCalculation",
	"PayrollPayment",
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

		// Поиск пользователя через Prisma — выбираем явные поля, чтобы
		// не пытаться читать несуществующие колонки из БД при рассинхронизации схемы
		const user = await prisma.user.findFirst({
			where: { username: { equals: trimmedUsername, mode: "insensitive" } },
			select: {
				uuid: true,
				username: true,
				password: true,
				employeeUuid: true,
				organizationUuid: true,
				isSuperAdmin: true,
				avatarPath: true,
				userPermissions: {
					select: {
						organizationUuid: true,
						role: true,
						organization: {
							select: {
								uuid: true,
								name: true,
								displayName: true,
								bin: true,
							},
						},
					},
				},
				employee: {
					select: {
						uuid: true,
						fullName: true,
						firstName: true,
						lastName: true,
						middleName: true,
						iin: true,
						avatarPath: true,
						organizationUuid: true,
						organization: {
							select: {
								uuid: true,
								name: true,
							},
						},
					},
				},
			},
		});

		const INVALID_CREDENTIALS = "Неверное имя пользователя или пароль";

		if (!user) {
			return res.status(401).json({
				success: false,
				message: INVALID_CREDENTIALS,
			});
		}

		// Подгружаем accessRights (только для активной орг + глобальные)
		const accessRights = await loadAccessRights(user.uuid, user.organizationUuid);

		// Есть ли у пользователя установленный пароль?
		const hasPassword = user.password && user.password.trim() !== "";
		const isDev = process.env.NODE_ENV !== "production";

		if (!hasPassword) {
			if (isDev) {
				console.warn(`[DEV] Вход без пароля: ${user.username}`);
			} else {
				return res.status(401).json({
					success: false,
					message: "Пароль не установлен. Обратитесь к администратору",
				});
			}
		} else {
			if (!password || typeof password !== "string") {
				return res.status(401).json({
					success: false,
					message: INVALID_CREDENTIALS,
				});
			}

			const isHashed =
				user.password.startsWith("$2a$") || user.password.startsWith("$2b$");

			let passwordValid = false;
			if (isHashed) {
				passwordValid = await bcrypt.compare(password, user.password);
			} else {
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

		// Определяем Разрешения пользователей
		const isSuperOrDevAdmin =
			user.isSuperAdmin || (isDev && trimmedUsername.toLowerCase() === "admin");
		const rights = isSuperOrDevAdmin
			? generateFullAccessRights()
			: accessRights;

		const allowedOrgUuids = (user.userPermissions || []).map(
			(uo) => uo.organizationUuid,
		);

		let employeeData = user.employee || null;
		if (employeeData) {
			employeeData = { ...employeeData, accessRights: rights };
		}

		return res.status(200).json({
			success: true,
			token,
			user: {
				uuid: user.uuid,
				username: user.username,
				organizationUuid: user.organizationUuid,
				isSuperAdmin: user.isSuperAdmin,
				allowedOrgUuids,
				userPermissions: user.userPermissions || [],
				employee: employeeData,
				accessRights: rights,
			},
		});
	} catch (error) {
		console.error("POST /auth/login error:", error.message);
		console.error("POST /auth/login stack:", error.stack);
		return res.status(500).json({
			success: false,
			message: "Ошибка сервера: " + error.message,
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
				employeeUuid: true,
				organizationUuid: true,
				isSuperAdmin: true,
				userPermissions: {
					select: {
						organizationUuid: true,
						role: true,
						organization: {
							select: {
								uuid: true,
								name: true,
								displayName: true,
								bin: true,
							},
						},
					},
				},
				employee: {
					include: { organization: true },
				},
			},
		});

		if (!user) {
			return res
				.status(404)
				.json({ success: false, message: "Пользователь не найден" });
		}

		// Подгружаем accessRights (только для активной орг + глобальные)
		const accessRights = await loadAccessRights(user.uuid, user.organizationUuid);

		// Определяем Разрешения пользователей
		const isDev = process.env.NODE_ENV !== "production";
		const isSuperOrDevAdmin =
			user.isSuperAdmin || (isDev && user.username?.toLowerCase() === "admin");
		const rights = isSuperOrDevAdmin
			? generateFullAccessRights()
			: accessRights;

		const allowedOrgUuids = (user.userPermissions || []).map(
			(uo) => uo.organizationUuid,
		);

		let employeeData = user.employee || null;
		if (employeeData) {
			employeeData = { ...employeeData, accessRights: rights };
		}

		return res.status(200).json({
			success: true,
			user: {
				...user,
				employee: employeeData,
				accessRights: rights,
				allowedOrgUuids,
			},
		});
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

// ============================================
// POST /auth/register — Регистрация организации
// Создаёт организацию + первого пользователя (admin) + сотрудника + invite-код
// ============================================
router.post("/auth/register", async (req, res) => {
	try {
		const { bin, name, displayName, username, password } = req.body;

		// Валидация
		if (!bin || typeof bin !== "string" || !/^\d{12}$/.test(bin.trim())) {
			return res
				.status(400)
				.json({
					success: false,
					message: "БИН должен состоять ровно из 12 цифр",
				});
		}
		const trimmedBin = bin.trim();
		const trimmedUsername = (username || "").trim();
		if (!trimmedUsername) {
			return res
				.status(400)
				.json({ success: false, message: "Имя пользователя обязательно" });
		}
		if (!password || typeof password !== "string" || password.length < 6) {
			return res
				.status(400)
				.json({
					success: false,
					message: "Пароль должен быть не менее 6 символов",
				});
		}

		// Проверяем, что БИН не занят
		const existingOrg = await prisma.organization.findUnique({
			where: { bin: trimmedBin },
		});
		if (existingOrg) {
			return res
				.status(409)
				.json({
					success: false,
					message: "Организация с таким БИН уже зарегистрирована",
				});
		}

		// Проверяем, что username не занят
		const existingUser = await prisma.user.findFirst({
			where: { username: trimmedUsername },
		});
		if (existingUser) {
			return res
				.status(409)
				.json({ success: false, message: "Имя пользователя уже занято" });
		}

		// Генерируем invite-код (8 символов hex)
		const inviteCode = crypto.randomBytes(4).toString("hex").toUpperCase();
		const hashedPassword = await bcrypt.hash(password, 12);

		// Создаём всё в транзакции через Prisma
		const result = await prisma.$transaction(async (tx) => {
			// 1. Организация
			const org = await tx.organization.create({
				data: {
					bin: trimmedBin,
					name: (name || "").trim() || null,
					displayName: (displayName || "").trim() || null,
					inviteCode,
				},
			});

			// 2. Сотрудник
			const employee = await tx.employee.create({
				data: {
					fullName: trimmedUsername,
					lastName: trimmedUsername,
					organizationUuid: org.uuid,
				},
			});

			// 3. Пользователь
			const user = await tx.user.create({
				data: {
					username: trimmedUsername,
					password: hashedPassword,
					employeeUuid: employee.uuid,
					organizationUuid: org.uuid,
					isSuperAdmin: false,
				},
				include: { employee: { include: { organization: true } } },
			});

			return { org, user };
		});

		const token = generateToken(result.user);

		return res.status(201).json({
			success: true,
			token,
			inviteCode,
			user: {
				uuid: result.user.uuid,
				username: result.user.username,
				organizationUuid: result.user.organizationUuid,
				isSuperAdmin: result.user.isSuperAdmin,
				employee: result.user.employee,
			},
		});
	} catch (error) {
		console.error("POST /auth/register error:", error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ============================================
// POST /auth/join — Присоединение к организации по invite-коду
// Создаёт нового пользователя + сотрудника в организации
// ============================================
router.post("/auth/join", async (req, res) => {
	try {
		const { inviteCode, username, password } = req.body;

		if (!inviteCode || typeof inviteCode !== "string") {
			return res
				.status(400)
				.json({ success: false, message: "Код приглашения обязателен" });
		}
		const trimmedCode = inviteCode.trim().toUpperCase();
		const trimmedUsername = (username || "").trim();
		if (!trimmedUsername) {
			return res
				.status(400)
				.json({ success: false, message: "Имя пользователя обязательно" });
		}
		if (!password || typeof password !== "string" || password.length < 6) {
			return res
				.status(400)
				.json({
					success: false,
					message: "Пароль должен быть не менее 6 символов",
				});
		}

		// Находим организацию по invite-коду
		const org = await prisma.organization.findUnique({
			where: { inviteCode: trimmedCode },
		});
		if (!org) {
			return res
				.status(404)
				.json({
					success: false,
					message: "Организация с таким кодом приглашения не найдена",
				});
		}

		// Проверяем, что username не занят
		const existingUser = await prisma.user.findFirst({
			where: { username: trimmedUsername },
		});
		if (existingUser) {
			return res
				.status(409)
				.json({ success: false, message: "Имя пользователя уже занято" });
		}

		const hashedPassword = await bcrypt.hash(password, 12);

		// Создаём в транзакции через Prisma
		const result = await prisma.$transaction(async (tx) => {
			// 1. Сотрудник
			const employee = await tx.employee.create({
				data: {
					fullName: trimmedUsername,
					lastName: trimmedUsername,
					organizationUuid: org.uuid,
				},
			});

			// 2. Пользователь
			const user = await tx.user.create({
				data: {
					username: trimmedUsername,
					password: hashedPassword,
					employeeUuid: employee.uuid,
					organizationUuid: org.uuid,
					isSuperAdmin: false,
				},
				include: { employee: { include: { organization: true } } },
			});

			return user;
		});

		const token = generateToken(result);

		return res.status(201).json({
			success: true,
			token,
			user: {
				uuid: result.uuid,
				username: result.username,
				organizationUuid: result.organizationUuid,
				isSuperAdmin: result.isSuperAdmin,
				employee: result.employee,
			},
		});
	} catch (error) {
		console.error("POST /auth/join error:", error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ============================================
// PATCH /auth/switch-org — Переключение активной организации (без перелогина)
// ============================================
router.patch("/auth/switch-org", authMiddleware, async (req, res) => {
	try {
		if (!req.user?.uuid) {
			return res
				.status(401)
				.json({ success: false, message: "Не авторизован" });
		}

		const { organizationUuid } = req.body;

		// Загружаем пользователя с организациями
		const user = await prisma.user.findUnique({
			where: { uuid: req.user.uuid },
			select: {
				uuid: true,
				username: true,
				isSuperAdmin: true,
				organizationUuid: true,
				userPermissions: {
					select: {
						organizationUuid: true,
						role: true,
						organization: {
							select: {
								uuid: true,
								name: true,
								displayName: true,
								bin: true,
							},
						},
					},
				},
				employee: {
					include: { organization: true },
				},
			},
		});

		if (!user) {
			return res
				.status(404)
				.json({ success: false, message: "Пользователь не найден" });
		}

		// Суперадмин может переключаться в любую орг
		// Обычный — только в разрешённые
		if (!user.isSuperAdmin) {
			const allowed = user.userPermissions.map((uo) => uo.organizationUuid);
			if (organizationUuid !== null && !allowed.includes(organizationUuid)) {
				console.warn(
					`[Security] User ${user.username} (${user.uuid}) attempted to switch to unauthorized org ${organizationUuid}`,
				);
				return res
					.status(403)
					.json({ success: false, message: "Нет доступа к этой организации" });
			}
		}

		// Обновляем активную организацию в БД
		await prisma.user.update({
			where: { uuid: user.uuid },
			data: { organizationUuid: organizationUuid ?? null },
		});

		// Подгружаем права для новой орг (только для активной орг + глобальные)
		const accessRights = await loadAccessRights(user.uuid, organizationUuid ?? null);

		const isDev = process.env.NODE_ENV !== "production";
		const isSuperOrDevAdmin =
			user.isSuperAdmin || (isDev && user.username?.toLowerCase() === "admin");
		const rights = isSuperOrDevAdmin
			? generateFullAccessRights()
			: accessRights;

		const allowedOrgUuids = user.userPermissions.map(
			(uo) => uo.organizationUuid,
		);

		// Формируем обновлённый объект пользователя
		const updatedUser = {
			uuid: user.uuid,
			username: user.username,
			organizationUuid: organizationUuid ?? null,
			isSuperAdmin: user.isSuperAdmin,
			allowedOrgUuids,
			userPermissions: user.userPermissions,
			employee: user.employee,
			accessRights: rights,
		};

		// Выдаём новый JWT с обновлённым uuid (organizationUuid не в токене, берётся из БД)
		const token = generateToken(updatedUser);

		return res.status(200).json({ success: true, token, user: updatedUser });
	} catch (error) {
		console.error("PATCH /auth/switch-org error:", error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ============================================
// POST /auth/regenerate-invite — Перегенерация invite-кода (требует авторизации)
// ============================================
router.post("/auth/regenerate-invite", authMiddleware, async (req, res) => {
	try {
		if (!req.user || !req.user.uuid) {
			return res
				.status(401)
				.json({ success: false, message: "Не авторизован" });
		}

		const user = await prisma.user.findUnique({
			where: { uuid: req.user.uuid },
		});
		if (!user || !user.organizationUuid) {
			return res
				.status(400)
				.json({
					success: false,
					message: "Пользователь не привязан к организации",
				});
		}

		const newCode = crypto.randomBytes(4).toString("hex").toUpperCase();
		await prisma.organization.update({
			where: { uuid: user.organizationUuid },
			data: { inviteCode: newCode },
		});

		return res.status(200).json({ success: true, inviteCode: newCode });
	} catch (error) {
		console.error("POST /auth/regenerate-invite error:", error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

export default router;
