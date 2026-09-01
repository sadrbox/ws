// ─────────────────────────────────────────────────────────────────────────────
// API панели «Коммуникации» (E14/W1-W2, ТЗ §7). Под authMiddleware/tenantFilter.
//
// Отправка наружу (provider.sendText) пока НЕ подключена — WhatsApp API не
// настроен. Исходящее сообщение сохраняется со статусом `queued`: переписка
// ведётся и хранится, а при подключении провайдера очередь начнёт уходить в сеть
// (см. W4). Это позволяет пользоваться панелью уже сейчас.
// ─────────────────────────────────────────────────────────────────────────────
import express from "express";
import { prisma } from "../../prisma/prisma-client.js";
import { tenantFilter } from "../../utils/auth.js";
import { publish } from "../../services/chatBus.js";
import { normalizePhone } from "../../services/wa/phone.js";
import { resolveContactByPhone } from "../../services/wa/resolveContact.js";

const router = express.Router();

// Орг-изоляция: tenantFilter сам отдаёт готовый WHERE-фрагмент
// ({} суперадмину, {organizationUuid} или {organizationUuid:{in:[…]}}).
const orgWhere = (req) => tenantFilter(req);

/** Активная организация пользователя (для создания записей). */
function activeOrg(req) {
	return req.user?.organizationUuid || req.user?.allowedOrgUuids?.[0] || null;
}

// ── Список диалогов ──────────────────────────────────────────────────────────
router.get("/wa/conversations", async (req, res) => {
	try {
		const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
		const items = await prisma.waConversation.findMany({
			where: {
				deletedAt: null,
				...orgWhere(req),
				...(search
					? { OR: [{ phone: { contains: normalizePhone(search) || search } }, { displayName: { contains: search, mode: "insensitive" } }] }
					: {}),
			},
			orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
			take: 200,
		});
		// Подписи: контактное лицо и контрагент — одним проходом, без N+1.
		const personUuids = [...new Set(items.map((i) => i.contactPersonUuid).filter(Boolean))];
		const cpUuids = [...new Set(items.map((i) => i.counterpartyUuid).filter(Boolean))];
		const [persons, counterparties] = await Promise.all([
			personUuids.length ? prisma.contactPerson.findMany({ where: { uuid: { in: personUuids } }, select: { uuid: true, fullName: true, firstName: true, lastName: true } }) : [],
			cpUuids.length ? prisma.counterparty.findMany({ where: { uuid: { in: cpUuids } }, select: { uuid: true, name: true } }) : [],
		]);
		const pName = (p) => p.fullName || [p.lastName, p.firstName].filter(Boolean).join(" ") || null;
		const pm = new Map(persons.map((p) => [p.uuid, pName(p)]));
		const cm = new Map(counterparties.map((c) => [c.uuid, c.name]));
		return res.json({
			success: true,
			items: items.map((i) => ({ ...i, contactPersonName: pm.get(i.contactPersonUuid) ?? null, counterpartyName: cm.get(i.counterpartyUuid) ?? null })),
		});
	} catch (e) {
		console.error("GET /wa/conversations error:", e);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── Сообщения диалога ────────────────────────────────────────────────────────
router.get("/wa/conversations/:uuid/messages", async (req, res) => {
	try {
		const conv = await prisma.waConversation.findFirst({ where: { uuid: req.params.uuid, deletedAt: null, ...orgWhere(req) } });
		if (!conv) return res.status(404).json({ success: false, message: "Диалог не найден" });
		const items = await prisma.waMessage.findMany({
			where: { conversationUuid: conv.uuid, deletedAt: null },
			orderBy: { createdAt: "asc" },
			take: 500,
		});
		return res.json({ success: true, items });
	} catch (e) {
		console.error("GET /wa/messages error:", e);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── Отправить сообщение (пока в очередь: провайдер не подключён) ─────────────
router.post("/wa/conversations/:uuid/messages", async (req, res) => {
	try {
		if (!req.user?.uuid) return res.status(401).json({ success: false, message: "Требуется авторизация" });
		const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
		if (!body) return res.status(400).json({ success: false, message: "Пустое сообщение" });
		const conv = await prisma.waConversation.findFirst({ where: { uuid: req.params.uuid, deletedAt: null, ...orgWhere(req) } });
		if (!conv) return res.status(404).json({ success: false, message: "Диалог не найден" });

		const msg = await prisma.waMessage.create({
			data: {
				conversationUuid: conv.uuid,
				organizationUuid: conv.organizationUuid,
				direction: "out",
				body,
				authorUuid: req.user.uuid,
				status: "queued", // отправка наружу — после подключения провайдера (W4)
			},
		});
		await prisma.waConversation.update({ where: { uuid: conv.uuid }, data: { lastMessageAt: msg.createdAt } });
		publish(conv.organizationUuid, { type: "wa", kind: "message", conversationUuid: conv.uuid });
		return res.json({ success: true, item: msg });
	} catch (e) {
		console.error("POST /wa/messages error:", e);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── Отметить прочитанным ─────────────────────────────────────────────────────
router.post("/wa/conversations/:uuid/read", async (req, res) => {
	try {
		const conv = await prisma.waConversation.findFirst({ where: { uuid: req.params.uuid, deletedAt: null, ...orgWhere(req) } });
		if (!conv) return res.status(404).json({ success: false, message: "Диалог не найден" });
		await prisma.waConversation.update({ where: { uuid: conv.uuid }, data: { unreadCount: 0 } });
		return res.json({ success: true });
	} catch (e) {
		console.error("POST /wa/read error:", e);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── Привязать контактное лицо вручную (незнакомый номер) ─────────────────────
router.post("/wa/conversations/:uuid/link", async (req, res) => {
	try {
		const { contactPersonUuid = null, counterpartyUuid = null } = req.body || {};
		const conv = await prisma.waConversation.findFirst({ where: { uuid: req.params.uuid, deletedAt: null, ...orgWhere(req) } });
		if (!conv) return res.status(404).json({ success: false, message: "Диалог не найден" });

		// Контрагент выводим из лица, если явно не передан.
		let cpUuid = counterpartyUuid;
		if (contactPersonUuid && !cpUuid) {
			const person = await prisma.contactPerson.findFirst({ where: { uuid: contactPersonUuid, deletedAt: null }, select: { ownerType: true, ownerUuid: true } });
			if (person?.ownerType === "Counterparty") cpUuid = person.ownerUuid;
		}
		const updated = await prisma.waConversation.update({
			where: { uuid: conv.uuid },
			data: { contactPersonUuid, counterpartyUuid: cpUuid },
		});

		// Запоминаем номер за владельцем — следующий резолвинг будет автоматическим (ТЗ §5.5).
		const ownerUuid = contactPersonUuid || cpUuid;
		const ownerType = contactPersonUuid ? "ContactPerson" : cpUuid ? "Counterparty" : null;
		if (ownerType) {
			const exists = await prisma.contact.findFirst({
				where: { deletedAt: null, contactType: "whatsapp", ownerType, ownerUuid, value: { contains: conv.phone.slice(-7) } },
				select: { id: true },
			});
			if (!exists) {
				await prisma.contact.create({
					data: { value: `+${conv.phone}`, contactType: "whatsapp", ownerType, ownerUuid, organizationUuid: conv.organizationUuid },
				});
			}
		}
		return res.json({ success: true, item: updated });
	} catch (e) {
		console.error("POST /wa/link error:", e);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── Сводка по собеседнику (правая панель, ТЗ §8.3) ───────────────────────────
router.get("/wa/contact-summary/:uuid", async (req, res) => {
	try {
		const conv = await prisma.waConversation.findFirst({ where: { uuid: req.params.uuid, deletedAt: null, ...orgWhere(req) } });
		if (!conv) return res.status(404).json({ success: false, message: "Диалог не найден" });

		const person = conv.contactPersonUuid
			? await prisma.contactPerson.findFirst({ where: { uuid: conv.contactPersonUuid, deletedAt: null } })
			: null;
		const counterparty = conv.counterpartyUuid
			? await prisma.counterparty.findFirst({ where: { uuid: conv.counterpartyUuid, deletedAt: null }, select: { uuid: true, name: true, bin: true } })
			: null;
		// Контакты владельца (телефоны/почта) — для карточки.
		const contacts = person || counterparty
			? await prisma.contact.findMany({
				where: {
					deletedAt: null,
					ownerType: person ? "ContactPerson" : "Counterparty",
					ownerUuid: person ? person.uuid : counterparty.uuid,
				},
				select: { value: true, contactType: true, isPrimary: true },
			})
			: [];
		// Последние документы контрагента.
		const sales = counterparty
			? await prisma.sale.findMany({
				where: { deletedAt: null, counterpartyUuid: counterparty.uuid },
				orderBy: { date: "desc" }, take: 5,
				select: { uuid: true, number: true, date: true, amount: true, posted: true },
			})
			: [];
		return res.json({ success: true, conversation: conv, contactPerson: person, counterparty, contacts, sales });
	} catch (e) {
		console.error("GET /wa/contact-summary error:", e);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// ── Тестовый диалог: имитация входящего (пока провайдер не подключён) ────────
// Позволяет проверить панель/резолвинг без Meta. Доступно суперадмину.
router.post("/wa/simulate-incoming", async (req, res) => {
	try {
		if (!req.user?.isSuperAdmin) return res.status(403).json({ success: false, message: "Только суперадмин" });
		const phone = normalizePhone(req.body?.phone);
		const text = typeof req.body?.body === "string" ? req.body.body : "";
		const organizationUuid = req.body?.organizationUuid || activeOrg(req);
		if (!phone || !organizationUuid) return res.status(400).json({ success: false, message: "Нужны phone и organizationUuid" });

		let channel = await prisma.waChannel.findFirst({ where: { organizationUuid, deletedAt: null } });
		if (!channel) {
			channel = await prisma.waChannel.create({ data: { organizationUuid, name: "Тестовый канал", phone: "0", provider: "mock" } });
		}
		let conv = await prisma.waConversation.findFirst({ where: { channelUuid: channel.uuid, phone } });
		if (!conv) {
			const resolved = await resolveContactByPhone(prisma, { phone, organizationUuid });
			conv = await prisma.waConversation.create({
				data: { channelUuid: channel.uuid, organizationUuid, phone, contactPersonUuid: resolved.contactPersonUuid, counterpartyUuid: resolved.counterpartyUuid },
			});
		}
		const now = new Date();
		const msg = await prisma.waMessage.create({
			data: { conversationUuid: conv.uuid, organizationUuid, direction: "in", body: text, status: "received" },
		});
		await prisma.waConversation.update({
			where: { uuid: conv.uuid },
			data: { lastMessageAt: now, lastIncomingAt: now, unreadCount: { increment: 1 } },
		});
		publish(organizationUuid, { type: "wa", kind: "message", conversationUuid: conv.uuid });
		return res.json({ success: true, conversationUuid: conv.uuid, item: msg });
	} catch (e) {
		console.error("POST /wa/simulate-incoming error:", e);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

export default router;
