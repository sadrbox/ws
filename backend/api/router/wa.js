// ─────────────────────────────────────────────────────────────────────────────
// API панели «Коммуникации» (этап W2). Под authMiddleware + tenantFilter:
// диалоги принадлежат организации канала, пользователь видит только свои.
// ─────────────────────────────────────────────────────────────────────────────
import express from "express";
import { prisma } from "../../prisma/prisma-client.js";
import { tenantFilter } from "../../utils/auth.js";
import { normalizePhone } from "../../services/wa/resolveContact.js";
import { queueOutgoing, markRead, isWindowOpen, saveIncoming } from "../../services/wa/conversations.js";

const router = express.Router();

/** Организации, доступные пользователю (для изоляции выборок). */
function orgWhere(req) {
	const f = tenantFilter(req);
	return f?.organizationUuid ? { organizationUuid: f.organizationUuid } : {};
}

// ── Диалоги ──────────────────────────────────────────────────────────────────
router.get("/wa/conversations", async (req, res) => {
	try {
		const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
		const rows = await prisma.waConversation.findMany({
			where: { deletedAt: null, ...orgWhere(req) },
			orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
			take: 200,
		});
		// Подписи собеседников: контактное лицо / контрагент — одним запросом каждый.
		const personUuids = [...new Set(rows.map((r) => r.contactPersonUuid).filter(Boolean))];
		const cpUuids = [...new Set(rows.map((r) => r.counterpartyUuid).filter(Boolean))];
		const [persons, cps] = await Promise.all([
			personUuids.length ? prisma.contactPerson.findMany({ where: { uuid: { in: personUuids } }, select: { uuid: true, fullName: true, firstName: true, lastName: true } }) : [],
			cpUuids.length ? prisma.counterparty.findMany({ where: { uuid: { in: cpUuids } }, select: { uuid: true, name: true } }) : [],
		]);
		const pMap = new Map(persons.map((p) => [p.uuid, p.fullName || [p.lastName, p.firstName].filter(Boolean).join(" ")]));
		const cMap = new Map(cps.map((c) => [c.uuid, c.name]));

		let items = rows.map((r) => ({
			...r,
			contactPersonName: r.contactPersonUuid ? pMap.get(r.contactPersonUuid) ?? null : null,
			counterpartyName: r.counterpartyUuid ? cMap.get(r.counterpartyUuid) ?? null : null,
			windowOpen: isWindowOpen(r),
		}));
		if (search) {
			const q = search.toLowerCase();
			const qPhone = normalizePhone(search);
			items = items.filter((i) =>
				i.phone.includes(qPhone) ||
				(i.displayName ?? "").toLowerCase().includes(q) ||
				(i.contactPersonName ?? "").toLowerCase().includes(q) ||
				(i.counterpartyName ?? "").toLowerCase().includes(q));
		}
		return res.json({ success: true, items });
	} catch (e) {
		console.error("GET /wa/conversations error:", e);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── Сообщения диалога ────────────────────────────────────────────────────────
router.get("/wa/conversations/:uuid/messages", async (req, res) => {
	try {
		const conv = await prisma.waConversation.findFirst({
			where: { uuid: req.params.uuid, deletedAt: null, ...orgWhere(req) },
		});
		if (!conv) return res.status(404).json({ success: false, message: "Диалог не найден" });
		const items = await prisma.waMessage.findMany({
			where: { conversationUuid: conv.uuid, deletedAt: null },
			orderBy: { createdAt: "asc" },
			take: 500,
		});
		return res.json({ success: true, items, windowOpen: isWindowOpen(conv) });
	} catch (e) {
		console.error("GET /wa/conversations/:uuid/messages error:", e);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── Отправка (провайдер подключается на W4: пока ставим в очередь) ───────────
router.post("/wa/conversations/:uuid/messages", async (req, res) => {
	try {
		if (!req.user?.uuid) return res.status(401).json({ success: false, message: "Требуется авторизация" });
		const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
		if (!body) return res.status(400).json({ success: false, message: "Пустое сообщение" });
		const conv = await prisma.waConversation.findFirst({
			where: { uuid: req.params.uuid, deletedAt: null, ...orgWhere(req) },
		});
		if (!conv) return res.status(404).json({ success: false, message: "Диалог не найден" });
		// Окно 24ч: вне его Cloud API принимает только утверждённые шаблоны.
		if (!isWindowOpen(conv)) {
			return res.status(409).json({
				success: false, code: "WINDOW_CLOSED",
				message: "Прошло больше 24 часов с последнего входящего — свободный текст недоступен, нужен утверждённый шаблон.",
			});
		}
		const message = await queueOutgoing(prisma, { conversation: conv, body, authorUuid: req.user.uuid });
		return res.json({ success: true, item: message });
	} catch (e) {
		console.error("POST /wa/conversations/:uuid/messages error:", e);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── Прочитано ────────────────────────────────────────────────────────────────
router.post("/wa/conversations/:uuid/read", async (req, res) => {
	try {
		const conv = await prisma.waConversation.findFirst({
			where: { uuid: req.params.uuid, deletedAt: null, ...orgWhere(req) },
		});
		if (!conv) return res.status(404).json({ success: false, message: "Диалог не найден" });
		const updated = await markRead(prisma, conv.uuid);
		return res.json({ success: true, item: updated });
	} catch (e) {
		console.error("POST /wa/conversations/:uuid/read error:", e);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── Ручная привязка контактного лица (для «неизвестных» номеров) ─────────────
router.post("/wa/conversations/:uuid/link", async (req, res) => {
	try {
		const { contactPersonUuid = null, counterpartyUuid = null } = req.body ?? {};
		const conv = await prisma.waConversation.findFirst({
			where: { uuid: req.params.uuid, deletedAt: null, ...orgWhere(req) },
		});
		if (!conv) return res.status(404).json({ success: false, message: "Диалог не найден" });

		let displayName = conv.displayName;
		let cpUuid = counterpartyUuid;
		if (contactPersonUuid) {
			const p = await prisma.contactPerson.findFirst({ where: { uuid: contactPersonUuid, deletedAt: null } });
			if (!p) return res.status(400).json({ success: false, message: "Контактное лицо не найдено" });
			displayName = p.fullName || [p.lastName, p.firstName].filter(Boolean).join(" ") || displayName;
			// Контрагент — владелец лица, если явно не передан.
			if (!cpUuid && p.ownerType === "Counterparty") cpUuid = p.ownerUuid;
			// Запоминаем номер в контактах лица — следующий резолвинг будет автоматическим.
			const already = await prisma.contact.findFirst({
				where: { deletedAt: null, contactType: "whatsapp", ownerType: "ContactPerson", ownerUuid: p.uuid },
			});
			if (!already) {
				await prisma.contact.create({
					data: {
						value: `+${conv.phone}`, contactType: "whatsapp",
						ownerType: "ContactPerson", ownerUuid: p.uuid,
						organizationUuid: conv.organizationUuid,
					},
				});
			}
		}
		const updated = await prisma.waConversation.update({
			where: { id: conv.id },
			data: { contactPersonUuid: contactPersonUuid || null, counterpartyUuid: cpUuid || null, displayName },
		});
		return res.json({ success: true, item: updated });
	} catch (e) {
		console.error("POST /wa/conversations/:uuid/link error:", e);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── Сводка по собеседнику (правая панель) ───────────────────────────────────
router.get("/wa/contact-summary/:uuid", async (req, res) => {
	try {
		const conversation = await prisma.waConversation.findFirst({
			where: { uuid: req.params.uuid, deletedAt: null, ...orgWhere(req) },
		});
		if (!conversation) return res.status(404).json({ success: false, message: "Диалог не найден" });

		const contactPerson = conversation.contactPersonUuid
			? await prisma.contactPerson.findFirst({
				where: { uuid: conversation.contactPersonUuid, deletedAt: null },
				select: { uuid: true, fullName: true, firstName: true, lastName: true, comment: true },
			})
			: null;
		const counterparty = conversation.counterpartyUuid
			? await prisma.counterparty.findFirst({
				where: { uuid: conversation.counterpartyUuid, deletedAt: null },
				select: { uuid: true, name: true, bin: true },
			})
			: null;

		// Все контакты собеседника: лица (если известно) либо контрагента.
		const ownerUuid = contactPerson?.uuid ?? counterparty?.uuid ?? null;
		const ownerType = contactPerson ? "ContactPerson" : counterparty ? "Counterparty" : null;
		const contacts = ownerUuid
			? await prisma.contact.findMany({
				where: { deletedAt: null, ownerType, ownerUuid },
				select: { value: true, contactType: true, isPrimary: true },
				orderBy: [{ isPrimary: "desc" }, { id: "asc" }],
			})
			: [];

		// Последние документы контрагента — контекст переписки.
		const sales = counterparty
			? await prisma.sale.findMany({
				where: { counterpartyUuid: counterparty.uuid, deletedAt: null },
				select: { uuid: true, number: true, date: true, amount: true, posted: true },
				orderBy: { date: "desc" },
				take: 5,
			})
			: [];

		return res.json({ success: true, conversation, contactPerson, counterparty, contacts, sales });
	} catch (e) {
		console.error("GET /wa/contact-summary/:uuid error:", e);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── Имитация входящего (пока провайдер не подключён) ────────────────────────
// Позволяет проверить весь путь: резолвинг номера → диалог → SSE → панель,
// не дожидаясь боевого номера WhatsApp. Только суперадмин.
router.post("/wa/simulate-incoming", async (req, res) => {
	try {
		if (!req.user?.isSuperAdmin) return res.status(403).json({ success: false, message: "Только суперадмин" });
		const phone = String(req.body?.phone ?? "").trim();
		const body = String(req.body?.body ?? "").trim();
		if (!phone || !body) return res.status(400).json({ success: false, message: "Нужны phone и body" });

		// Канал: активный канал организации пользователя (или первый активный).
		const f = tenantFilter(req);
		const channel = await prisma.waChannel.findFirst({
			where: { isActive: true, deletedAt: null, ...(f?.organizationUuid ? { organizationUuid: f.organizationUuid } : {}) },
		});
		if (!channel) {
			return res.status(400).json({ success: false, message: "Нет активного WhatsApp-канала: заведите его в справочнике каналов" });
		}
		const r = await saveIncoming(prisma, {
			channel, phone, body,
			providerMessageId: `sim.${Date.now()}`,
		});
		return res.json({ success: true, conversationUuid: r.conversation.uuid });
	} catch (e) {
		console.error("POST /wa/simulate-incoming error:", e);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

export default router;
