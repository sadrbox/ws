import jwt from "jsonwebtoken";

const JWT_SECRET =
	process.env.JWT_SECRET || "buhprof_secret_key_2025_change_in_production";
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

export { JWT_SECRET };
