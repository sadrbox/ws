// ─────────────────────────────────────────────────────────────────────────────
// Аутентификация приёмника событий 1С (POST /pipe).
//
// Раньше /pipe пускал только по JWT. Для сервер-к-серверу это неудобно: токен
// истекает, и 1С молча получала 401 — событие терялось, а в логах не оставалось
// НИЧЕГО (логгер стоит после авторизации). Симптом: «События 1С» всегда пусты.
//
// Поэтому: статический ключ в X-Api-Key (PIPE_API_KEY). JWT продолжает работать —
// человек с токеном по-прежнему может дёрнуть /pipe.
//
// Отказы логируем с причиной: молчаливый 401 — главное, что мешало найти проблему.
// ─────────────────────────────────────────────────────────────────────────────
import crypto from "node:crypto";
import { prisma } from "../prisma/prisma-client.js";
import { authMiddleware } from "./auth.js";

/** Служебный пользователь, от имени которого пишутся события 1С. */
const PIPE_USERNAME = process.env.PIPE_USERNAME || "1c-pipe";

let pipeUserUuid = null;

/**
 * Служебный аккаунт для интеграции. Заводится один раз, при первом событии.
 * password = null → войти под ним через форму нельзя, он существует только затем,
 * чтобы у события 1С был автор (audit и tenant-middleware требуют реального users.uuid).
 */
async function getPipeUserUuid() {
	if (pipeUserUuid) return pipeUserUuid;
	const existing = await prisma.user.findFirst({
		where: { username: PIPE_USERNAME },
		select: { uuid: true },
	});
	if (existing) {
		pipeUserUuid = existing.uuid;
		return pipeUserUuid;
	}
	const created = await prisma.user.create({
		// isSuperAdmin: события приходят по РАЗНЫМ организациям (резолв по БИН из тела),
		// поэтому приёмник не может быть заперт в одной активной орг.
		data: { username: PIPE_USERNAME, password: null, isSuperAdmin: true },
		select: { uuid: true },
	});
	pipeUserUuid = created.uuid;
	return pipeUserUuid;
}

/** Сравнение секретов без утечки времени (защита от подбора по таймингу). */
function safeEqual(a, b) {
	const ba = Buffer.from(String(a));
	const bb = Buffer.from(String(b));
	if (ba.length !== bb.length) return false;
	return crypto.timingSafeEqual(ba, bb);
}

export async function pipeAuth(req, res, next) {
	if (req.method === "OPTIONS") return next();

	const apiKey = req.get("x-api-key");
	const expected = process.env.PIPE_API_KEY;

	if (apiKey) {
		if (!expected) {
			console.warn("[pipe] отклонён: прислан X-Api-Key, но PIPE_API_KEY не задан в .env");
			return res.status(401).json({ success: false, message: "Приём событий не настроен" });
		}
		if (!safeEqual(apiKey, expected)) {
			console.warn(`[pipe] отклонён: неверный X-Api-Key (${req.ip})`);
			return res.status(401).json({ success: false, message: "Неверный ключ" });
		}
		try {
			req.user = { uuid: await getPipeUserUuid(), username: PIPE_USERNAME, isSuperAdmin: true };
			return next();
		} catch (e) {
			console.error("[pipe] не удалось получить служебного пользователя:", e.message);
			return res.status(500).json({ success: false, message: "Ошибка сервера" });
		}
	}

	if (!req.headers.authorization) {
		console.warn(`[pipe] отклонён: нет ни X-Api-Key, ни Bearer-токена (${req.ip})`);
		return res.status(401).json({
			success: false,
			message: "Требуется X-Api-Key или Bearer-токен",
		});
	}

	return authMiddleware(req, res, next);
}

export default pipeAuth;
