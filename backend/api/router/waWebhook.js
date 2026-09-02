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
import { prisma } from "../../prisma/prisma-client.js";
import { saveIncoming } from "../../services/wa/conversations.js";

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
		// Обработка асинхронная: Мете отвечаем 200 сразу (иначе ретраи и отключение
		// вебхука), ошибки разбора/записи остаются в логе.
		void ingest(events).catch((e) => console.error("[wa] ошибка приёма:", e?.message || e));
		return res.sendStatus(200);
	} catch (e) {
		console.error("[wa] ошибка обработки вебхука:", e?.message || e);
		return res.sendStatus(200);
	}
});

/** Сохранить входящие сообщения и статусы. Канал ищем по phone_number_id. */
async function ingest(events) {
	for (const ev of events) {
		const channel = ev.phoneNumberId
			? await prisma.waChannel.findFirst({
				where: { providerAccountId: ev.phoneNumberId, isActive: true, deletedAt: null },
			})
			: null;
		if (!channel) {
			// Канал не заведён в справочнике — сообщение принять некуда.
			console.warn(`[wa] неизвестный канал phone_number_id=${ev.phoneNumberId}`);
			continue;
		}
		for (const m of ev.messages) {
			// Лог без контента: переписка — персональные данные.
			const r = await saveIncoming(prisma, {
				channel,
				phone: m.from,
				body: m.text?.body ?? m.caption ?? null,
				providerMessageId: m.id,
				mediaType: m.type && m.type !== "text" ? m.type : null,
				at: m.timestamp ? new Date(Number(m.timestamp) * 1000) : null,
			});
			console.log(`[wa] входящее ${m.id} → диалог ${r.conversation?.uuid}${r.duplicate ? " (дубль, пропущено)" : ""}`);
		}
		for (const st of ev.statuses) {
			// Статус доставки исходящего: обновляем по wamid, если сообщение наше.
			await prisma.waMessage.updateMany({
				where: { providerMessageId: st.id },
				data: { status: normalizeStatus(st.status) },
			});
		}
	}
}

/** Статус Cloud API → enum WaMsgStatus (неизвестное не трогаем). */
function normalizeStatus(s) {
	return ["sent", "delivered", "read", "failed"].includes(s) ? s : "sent";
}

export default router;
