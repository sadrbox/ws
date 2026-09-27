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
import { personalChannel } from "../../services/quality/notify.js";
import { servicedOrgsFor } from "../../services/serviceLinks.js";
import { operatorAccessMode, operatorSeesData, getSupportMode } from "../../services/supportMode.js";

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;
const HEARTBEAT_MS = 15_000;

/**
 * ЧТО ИЗ КАНАЛА ОРГАНИЗАЦИИ ОТДАВАТЬ ЭТОМУ ПОЛЬЗОВАТЕЛЮ (Б13 аудита 26.09).
 *
 * Личные события (уведомления качества, назначение задачи) теперь идут в личный канал адресата,
 * но часть отправителей (канал /bpai, старые воркеры кластера до перезапуска) ещё пишет их в
 * канал организации. Отбор по адресату делаем здесь, на сервере: раньше его делал только
 * браузер, и чужое уведомление всё равно уходило по сети каждому сотруднику.
 */
export function eventVisibleTo(event, userUuid) {
	if (!event || typeof event !== "object") return false;
	if (event.type === "notify") return !!event.userUuid && event.userUuid === userUuid;
	if (event.type === "task") return !!event.todo?.executorUuid && event.todo.executorUuid === userUuid;
	return true;
}

/**
 * Каналы подписки: организации по ЧЛЕНСТВУ и по обслуживанию (как в tenantMiddleware) плюс
 * личный канал. Активная организация без членства больше не добавляется (после отзыва
 * членства поток продолжал работать). Суперадмин слушает все организации — если ему сейчас
 * открыты данные (О5: режим поддержки).
 */
export async function streamChannels(dbUser, userUuid, { db = prisma } = {}) {
	let orgs = dbUser.accessRights.map((a) => a.organizationUuid).filter(Boolean);
	const serviced = await servicedOrgsFor(userUuid, { db });
	orgs.push(...serviced.map((s) => s.organizationUuid));
	if (dbUser.isSuperAdmin) {
		const sees = operatorAccessMode() === "support-mode" ? operatorSeesData({ support: await getSupportMode() }) : true;
		if (sees) orgs = (await db.organization.findMany({ where: { deletedAt: null }, select: { uuid: true } })).map((o) => o.uuid);
	}
	return [...new Set([...orgs, personalChannel(userUuid)])].filter(Boolean);
}

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

	// Доступные пользователю организации (те же, что в tenantMiddleware). Сбой БД — ответ 503,
	// а не необработанный reject: без try Express 4 ронял воркер, а EventSource переподключается
	// раз в 3 с — сбой базы превращался в цикл падений (Н1 аудита 26.09).
	let channels;
	try {
		const dbUser = await prisma.user.findUnique({
			where: { uuid: userUuid },
			select: { isSuperAdmin: true, deletedAt: true, accessRights: { select: { organizationUuid: true } } },
		});
		if (!dbUser || dbUser.deletedAt) return res.status(401).json({ success: false, message: "Пользователь не найден" });
		channels = await streamChannels(dbUser, userUuid);
	} catch (err) {
		console.error("GET /chat/stream error:", err);
		return res.status(503).json({ success: false, message: "Поток событий временно недоступен" });
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
		if (!eventVisibleTo(event, userUuid)) return;
		res.write(`data: ${JSON.stringify(event)}\n\n`);
	};

	const unsubscribe = subscribe(channels, send);

	// Heartbeat — комментарий SSE (строка с ':'), клиент его игнорирует, но прокси
	// видит трафик и не рвёт соединение.
	const beat = setInterval(() => res.write(": ping\n\n"), HEARTBEAT_MS);

	req.on("close", () => {
		clearInterval(beat);
		unsubscribe();
	});
});

export default router;
