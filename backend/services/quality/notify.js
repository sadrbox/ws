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
 * ЛИЧНЫЙ КАНАЛ ПОЛЬЗОВАТЕЛЯ в шине (Б13 аудита 26.09). Личные уведомления (нарушения, меры,
 * заявки) раньше публиковались в канал ОРГАНИЗАЦИИ, а отбор по адресату делал браузер — то есть
 * каждый сотрудник фирмы получал по SSE чужие. Теперь они идут в канал адресата, на который
 * подписан только он сам (api/router/chatStream.js).
 */
export const personalChannel = (userUuid) => (userUuid ? `user:${userUuid}` : null);

/**
 * @param {string} userUuid
 * @param {{kind:string,title:string,body?:string,link?:object,organizationUuid?:string,dedupKey?:string,telegram?:boolean}} n
 * @returns {Promise<object|null>} запись или null (нет адресата / повтор по dedupKey)
 */
export async function notifyUser(userUuid, { kind, title, body = null, link = null, organizationUuid = null, dedupKey = null, telegram = true }) {
	if (!userUuid || !title) return null;
	let row;
	try {
		/*
		 * Повтор по dedupKey отсекает сама запись (ON CONFLICT DO NOTHING через skipDuplicates),
		 * а не упавший INSERT: правила SLA срабатывают каждые 5 минут, и ловля P2002 оставляла
		 * тысячи ошибок уникальности в журнале PostgreSQL (передача «backend-платформа», Н6).
		 */
		const rows = await prisma.userNotification.createManyAndReturn({
			data: [{ userUuid, kind, title: String(title).slice(0, 300), body: body ? String(body).slice(0, 2000) : null, link: link ?? undefined, organizationUuid, dedupKey }],
			skipDuplicates: true,
		});
		row = rows[0];
		if (!row) return null; // уже уведомляли — правило сработало повторно
	} catch (e) {
		if (e?.code === "P2002") return null;
		console.warn("[quality] notifyUser:", e.message);
		return null;
	}
	// Только адресату — в его личный канал; организация уведомления здесь роли не играет.
	publish(personalChannel(userUuid), { type: "notify", userUuid, organizationUuid, notification: { uuid: row.uuid, kind, title: row.title, body: row.body, link } });
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

export default { notifyUser, notifyMany, personalChannel };
