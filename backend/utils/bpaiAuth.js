// ─────────────────────────────────────────────────────────────────────────────
// Аутентификация служебного канала BuhProf AI (/bpai).
//
// Сюда ходит НЕ человек, а AI-сервис: он принял ход диалога из 1С, знает базу по
// её токену и организацию по БИН, и теперь читает или пишет задачи и заметки ERP.
// JWT пользователя ERP у него нет и быть не может — пользователь сидит в 1С.
//
// Поэтому статический ключ в X-Api-Key (BPAI_API_KEY), как у /pipe. Ключ ОТДЕЛЬНЫЙ
// от PIPE_API_KEY: у каналов разные владельцы и разный доступ, и утечка одного не
// должна открывать второй.
//
// Автор записи здесь НЕ служебный: пользователя 1С резолвит сам маршрут
// (services/bpaiActor.js) — в панели должно быть видно, кто поставил задачу.
// ─────────────────────────────────────────────────────────────────────────────
import crypto from "node:crypto";

/** Сравнение секретов без утечки времени (защита от подбора по таймингу). */
function safeEqual(a, b) {
	const ba = Buffer.from(String(a));
	const bb = Buffer.from(String(b));
	if (ba.length !== bb.length) return false;
	return crypto.timingSafeEqual(ba, bb);
}

export function bpaiAuth(req, res, next) {
	if (req.method === "OPTIONS") return next();

	const apiKey = req.get("x-api-key");
	const expected = process.env.BPAI_API_KEY;

	if (!expected) {
		console.warn("[bpai] отклонён: BPAI_API_KEY не задан в .env");
		return res.status(503).json({ success: false, message: "Служебный канал BuhProf AI не настроен" });
	}
	if (!apiKey) {
		console.warn(`[bpai] отклонён: нет X-Api-Key (${req.ip})`);
		return res.status(401).json({ success: false, message: "Требуется X-Api-Key" });
	}
	if (!safeEqual(apiKey, expected)) {
		console.warn(`[bpai] отклонён: неверный X-Api-Key (${req.ip})`);
		return res.status(401).json({ success: false, message: "Неверный ключ" });
	}
	return next();
}

export default bpaiAuth;
