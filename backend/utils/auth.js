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
