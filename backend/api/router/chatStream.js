// ─────────────────────────────────────────────────────────────────────────────
// SSE-поток реального времени (E4, collaboration).
//
//   GET /chat/stream?token=<JWT>  — Server-Sent Events: чат + уведомления.
//
// Отдельно от chat.js и монтируется ДО authMiddleware, потому что браузерный
// EventSource НЕ УМЕЕТ слать заголовок Authorization — только query-параметр или
// cookie. Приложение хранит Bearer-токен в localStorage, поэтому здесь своя
// проверка токена из query (тот же JWT_SECRET, что и у authMiddleware).
//
// За cloudflared-туннелем открытое SSE-соединение нужно «пинговать», иначе прокси
// рвёт по таймауту простоя — шлём heartbeat-комментарий каждые 15 c.
// ─────────────────────────────────────────────────────────────────────────────
import express from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../../prisma/prisma-client.js";
import { subscribe } from "../../services/chatBus.js";

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;
const HEARTBEAT_MS = 15_000;

router.get("/chat/stream", async (req, res) => {
	// ── Авторизация по query-токену (EventSource не шлёт заголовки) ──────────
	const token = String(req.query.token || "");
	let userUuid;
	try {
		userUuid = jwt.verify(token, JWT_SECRET)?.uuid;
	} catch {
		return res.status(401).json({ success: false, message: "Требуется авторизация" });
	}
	if (!userUuid) return res.status(401).json({ success: false, message: "Требуется авторизация" });

	// Доступные пользователю организации (те же, что в tenantMiddleware).
	const dbUser = await prisma.user.findUnique({
		where: { uuid: userUuid },
		select: { isSuperAdmin: true, organizationUuid: true, accessRights: { select: { organizationUuid: true } } },
	});
	if (!dbUser) return res.status(401).json({ success: false, message: "Пользователь не найден" });

	let orgs = dbUser.accessRights.map((a) => a.organizationUuid).filter(Boolean);
	if (dbUser.organizationUuid && !orgs.includes(dbUser.organizationUuid)) orgs.push(dbUser.organizationUuid);
	// Суперадмин слушает все организации.
	if (dbUser.isSuperAdmin) {
		orgs = (await prisma.organization.findMany({ where: { deletedAt: null }, select: { uuid: true } })).map((o) => o.uuid);
	}

	// ── Заголовки SSE ────────────────────────────────────────────────────────
	res.writeHead(200, {
		"Content-Type": "text/event-stream",
		"Cache-Control": "no-cache, no-transform",
		Connection: "keep-alive",
		"X-Accel-Buffering": "no", // отключить буферизацию у прокси
	});
	res.write("retry: 3000\n\n"); // клиенту: реконнект через 3 c при обрыве

	const send = (event) => {
		res.write(`data: ${JSON.stringify(event)}\n\n`);
	};

	const unsubscribe = subscribe(orgs, send);

	// Heartbeat — комментарий SSE (строка с ':'), клиент его игнорирует, но прокси
	// видит трафик и не рвёт соединение.
	const beat = setInterval(() => res.write(": ping\n\n"), HEARTBEAT_MS);

	req.on("close", () => {
		clearInterval(beat);
		unsubscribe();
	});
});

export default router;
