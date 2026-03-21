import express from "express";
import cors from "cors";
import bcrypt from "bcryptjs";
import { prisma } from "../../prisma/prisma-client.js";
import { generateToken, authMiddleware } from "../../utils/auth.js";

const router = express.Router();
router.use(cors());

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

		if (!user) {
			return res.status(401).json({
				success: false,
				message: "Пользователь не найден",
			});
		}

		// Если у пользователя пароль не задан (null/пустой) — вход без пароля
		const hasPassword = user.password && user.password.trim() !== "";

		if (hasPassword) {
			// Пароль задан — требуем ввод пароля
			if (!password || typeof password !== "string") {
				return res.status(401).json({
					success: false,
					message: "Требуется пароль",
				});
			}

			// Проверяем: если пароль начинается с $2a$ или $2b$ — это bcrypt-хэш
			const isHashed =
				user.password.startsWith("$2a$") || user.password.startsWith("$2b$");

			let passwordValid = false;
			if (isHashed) {
				passwordValid = await bcrypt.compare(password, user.password);
			} else {
				// Простое сравнение (для миграции со старых паролей)
				passwordValid = password === user.password;

				// Если пароль совпал — хешируем и сохраняем для безопасности
				if (passwordValid) {
					const hashed = await bcrypt.hash(password, 10);
					await prisma.user.update({
						where: { uuid: user.uuid },
						data: { password: hashed },
					});
				}
			}

			if (!passwordValid) {
				return res.status(401).json({
					success: false,
					message: "Неверный пароль",
				});
			}
		}

		// Генерируем JWT-токен
		const token = generateToken(user);

		return res.status(200).json({
			success: true,
			token,
			user: {
				uuid: user.uuid,
				username: user.username,
				email: user.email,
				employee: user.employee || null,
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
			newPassword.length < 1
		) {
			return res
				.status(400)
				.json({ success: false, message: "Новый пароль обязателен" });
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
			const valid = isHashed
				? await bcrypt.compare(oldPassword, user.password)
				: oldPassword === user.password;
			if (!valid) {
				return res
					.status(401)
					.json({ success: false, message: "Неверный текущий пароль" });
			}
		}

		const hashed = await bcrypt.hash(newPassword, 10);
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
