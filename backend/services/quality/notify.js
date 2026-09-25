// Уведомления пользователю (E17): запись в user_notifications + событие по SSE + Telegram.
//
// Хранится, а не только летит по шине: шина (services/chatBus.js) между воркерами кластера ходит
// через Postgres LISTEN/NOTIFY, но событие, пришедшее в разрыв соединения шины, теряется, а
// пользователь мог быть и не в сети. Панель поэтому ещё и опрашивает непрочитанные
// (GET /quality/notifications?unread=1), а SSE — лишь ускоритель.
import { prisma } from "../../prisma/prisma-client.js";
import { publish } from "../chatBus.js";
import { sendTelegramToUser } from "./telegram.js";

/**
 * @param {string} userUuid
 * @param {{kind:string,title:string,body?:string,link?:object,organizationUuid?:string,dedupKey?:string,telegram?:boolean}} n
 * @returns {Promise<object|null>} запись или null (нет адресата / повтор по dedupKey)
 */
export async function notifyUser(userUuid, { kind, title, body = null, link = null, organizationUuid = null, dedupKey = null, telegram = true }) {
	if (!userUuid || !title) return null;
	let row;
	try {
		row = await prisma.userNotification.create({
			data: { userUuid, kind, title: String(title).slice(0, 300), body: body ? String(body).slice(0, 2000) : null, link: link ?? undefined, organizationUuid, dedupKey },
		});
	} catch (e) {
		if (e?.code === "P2002") return null; // уже уведомляли — правило сработало повторно
		console.warn("[quality] notifyUser:", e.message);
		return null;
	}
	if (organizationUuid) {
		publish(organizationUuid, { type: "notify", userUuid, notification: { uuid: row.uuid, kind, title: row.title, body: row.body, link } });
	}
	if (telegram) void sendTelegramToUser(userUuid, body ? `${row.title}\n${row.body}` : row.title).catch(() => {});
	return row;
}

/** Нескольким адресатам; dedupKey дополняется адресатом, чтобы повтор ловился у каждого свой. */
export async function notifyMany(userUuids, n) {
	const out = [];
	for (const uid of new Set((userUuids || []).filter(Boolean))) {
		out.push(await notifyUser(uid, { ...n, dedupKey: n.dedupKey ? `${n.dedupKey}:${uid}` : null }));
	}
	return out.filter(Boolean);
}

export default { notifyUser, notifyMany };
