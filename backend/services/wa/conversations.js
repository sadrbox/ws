// ─────────────────────────────────────────────────────────────────────────────
// Диалоги «Коммуникаций» (этап W1): find-or-create диалога по номеру, приём
// входящих с идемпотентностью, постановка исходящих, счётчик непрочитанных.
//
// Ключевой инвариант ТЗ: один внешний номер = ОДИН диалог на канал
// (@@unique(channelUuid, phone)). Поэтому история переписки сохраняется сама
// собой — повторное сообщение с того же номера попадает в существующий диалог.
// ─────────────────────────────────────────────────────────────────────────────
import { normalizePhone } from "./phone.js";
import { resolveContactByPhone } from "./resolveContact.js";
import { publish } from "../chatBus.js";

/**
 * Найти или создать диалог канала с внешним номером. При создании выполняется
 * резолвинг контакта; у существующего диалога привязку НЕ перетираем (её мог
 * поправить пользователь вручную), но пустую — дозаполняем.
 */
export async function findOrCreateConversation(client, { channel, phone }) {
	const norm = normalizePhone(phone);
	if (!norm) throw new Error("Пустой номер собеседника");

	const existing = await client.waConversation.findFirst({
		where: { channelUuid: channel.uuid, phone: norm, deletedAt: null },
	});
	if (existing) {
		// Ручная привязка приоритетна; добираем только недостающее.
		if (!existing.contactPersonUuid && !existing.counterpartyUuid) {
			const r = await resolveContactByPhone(client, { phone: norm, organizationUuid: channel.organizationUuid });
			if (r.contactPersonUuid || r.counterpartyUuid) {
				return client.waConversation.update({
					where: { id: existing.id },
					data: {
						contactPersonUuid: r.contactPersonUuid,
						counterpartyUuid: r.counterpartyUuid,
					},
				});
			}
		}
		return existing;
	}

	const r = await resolveContactByPhone(client, { phone: norm, organizationUuid: channel.organizationUuid });
	return client.waConversation.create({
		data: {
			channelUuid: channel.uuid,
			organizationUuid: channel.organizationUuid,
			phone: norm,
			contactPersonUuid: r.contactPersonUuid,
			counterpartyUuid: r.counterpartyUuid,
		},
	});
}

/**
 * Сохранить ВХОДЯЩЕЕ сообщение. Идемпотентно по providerMessageId (wamid):
 * повторная доставка вебхука не создаёт дубль.
 * @returns {{message:object, conversation:object, duplicate:boolean}}
 */
export async function saveIncoming(client, { channel, phone, body, providerMessageId, mediaType = null, mediaFileUuid = null, at = null }) {
	if (providerMessageId) {
		const dup = await client.waMessage.findUnique({ where: { providerMessageId } });
		if (dup) {
			const conv = await client.waConversation.findFirst({ where: { uuid: dup.conversationUuid } });
			return { message: dup, conversation: conv, duplicate: true };
		}
	}
	const conversation = await findOrCreateConversation(client, { channel, phone });
	const when = at ? new Date(at) : new Date();

	const message = await client.waMessage.create({
		data: {
			conversationUuid: conversation.uuid,
			organizationUuid: conversation.organizationUuid,
			direction: "in",
			body: body ?? null,
			mediaType,
			mediaFileUuid,
			providerMessageId: providerMessageId ?? null,
			status: "received",
			createdAt: when,
		},
	});
	const updated = await client.waConversation.update({
		where: { id: conversation.id },
		data: { lastMessageAt: when, lastIncomingAt: when, unreadCount: { increment: 1 } },
	});

	publishSafe(updated.organizationUuid, {
		type: "wa", kind: "message",
		conversationUuid: updated.uuid, direction: "in", messageUuid: message.uuid,
	});
	return { message, conversation: updated, duplicate: false };
}

/** Поставить ИСХОДЯЩЕЕ сообщение (провайдер подключается на этапе W4). */
export async function queueOutgoing(client, { conversation, body, authorUuid, mediaFileUuid = null, mediaType = null }) {
	const when = new Date();
	const message = await client.waMessage.create({
		data: {
			conversationUuid: conversation.uuid,
			organizationUuid: conversation.organizationUuid,
			direction: "out",
			body: body ?? null,
			mediaType, mediaFileUuid,
			authorUuid: authorUuid ?? null,
			status: "queued",
			createdAt: when,
		},
	});
	const updated = await client.waConversation.update({
		where: { id: conversation.id }, data: { lastMessageAt: when },
	});
	publishSafe(updated.organizationUuid, {
		type: "wa", kind: "message",
		conversationUuid: updated.uuid, direction: "out", messageUuid: message.uuid,
	});
	return message;
}

/** Окно 24ч Cloud API: свободный текст можно слать только после входящего. */
export function isWindowOpen(conversation, now = Date.now()) {
	const last = conversation?.lastIncomingAt;
	if (!last) return false;
	return now - new Date(last).getTime() < 24 * 60 * 60 * 1000;
}

/** Сбросить счётчик непрочитанных. */
export async function markRead(client, conversationUuid) {
	const conv = await client.waConversation.findFirst({ where: { uuid: conversationUuid, deletedAt: null } });
	if (!conv || conv.unreadCount === 0) return conv;
	const updated = await client.waConversation.update({ where: { id: conv.id }, data: { unreadCount: 0 } });
	publishSafe(updated.organizationUuid, { type: "wa", kind: "conversation", conversationUuid: updated.uuid });
	return updated;
}

// SSE-шина опциональна: её сбой не должен ронять приём сообщения.
function publishSafe(orgUuid, event) {
	try { publish(orgUuid, event); } catch { /* realtime не критичен */ }
}

export default { findOrCreateConversation, saveIncoming, queueOutgoing, isWindowOpen, markRead };
