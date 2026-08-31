// ─────────────────────────────────────────────────────────────────────────────
// Вебхук WhatsApp Cloud API (P0 трека «Коммуникации», ТЗ §4.2). БЕЗ auth —
// монтируется на /api1 ДО express.json: подписи Meta считаются по СЫРОМУ телу,
// поэтому здесь свой express.raw-парсер.
//
// P0-скелет: подтверждение подписки (GET) + приём событий (POST) с проверкой
// подписи и логом сводки (id, без контента — переписка = персональные данные).
// Сохранение в WaConversation/WaMessage и резолвинг контакта — следующий шаг P0
// (после миграции моделей).
// ─────────────────────────────────────────────────────────────────────────────
import express from "express";
import { checkVerifyRequest, checkSignature, extractEvents } from "../../services/wa/webhookVerify.js";

const router = express.Router();

// Подтверждение подписки: Meta дергает GET при нажатии «Подтвердить и сохранить».
router.get("/wa/webhook", (req, res) => {
	const challenge = checkVerifyRequest(req.query, process.env.WA_VERIFY_TOKEN);
	if (!challenge) {
		console.warn("[wa] верификация вебхука отклонена (mode/token)");
		return res.sendStatus(403);
	}
	console.log("[wa] вебхук подтверждён (subscribe)");
	return res.status(200).type("text/plain").send(challenge);
});

// События: сообщения и статусы доставки. Отвечаем 200 быстро и всегда (иначе
// Meta ретраит и может отключить вебхук); ошибки обработки — внутрь, в лог.
router.post("/wa/webhook", express.raw({ type: "application/json", limit: "2mb" }), (req, res) => {
	try {
		const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
		if (!checkSignature(raw, req.headers["x-hub-signature-256"], process.env.WA_APP_SECRET || "")) {
			console.warn("[wa] событие с неверной подписью отклонено");
			return res.sendStatus(403);
		}
		let body;
		try { body = JSON.parse(raw.toString("utf8")); } catch { body = null; }
		const events = extractEvents(body);
		for (const ev of events) {
			// Лог без контента: только идентификаторы и типы.
			if (ev.messages.length) {
				console.log(`[wa] входящих: ${ev.messages.length} (канал ${ev.phoneNumberId}) ids=${ev.messages.map((m) => m.id).join(",")}`);
			}
			if (ev.statuses.length) {
				console.log(`[wa] статусов: ${ev.statuses.length} (${ev.statuses.map((s) => `${s.id}:${s.status}`).join(",")})`);
			}
			// TODO(P0-2): find-or-create WaConversation + резолвинг контакта +
			// downloadMedia + WaMessage + publish(type:"wa") — после миграции моделей.
		}
	} catch (e) {
		console.error("[wa] ошибка обработки вебхука:", e?.message || e);
	}
	return res.sendStatus(200);
});

export default router;
