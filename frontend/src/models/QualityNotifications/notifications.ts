/**
 * «Мои уведомления» (E17) — порядок списка и куда ведёт уведомление. Чистые функции:
 * index.tsx отдаёт только компоненты (Fast Refresh), а это проверяется юнит-тестом.
 */
import type { UserNotification } from "src/services/quality/api";

/** Непрочитанные — сверху, внутри групп — новые первыми. */
export function sortNotifications(items: readonly UserNotification[] | null | undefined): UserNotification[] {
	return [...(items ?? [])].sort((a, b) => {
		const unread = Number(!b.readAt) - Number(!a.readAt);
		if (unread) return unread;
		return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
	});
}

export type NotificationTarget =
	| { kind: "form"; endpoint: string; uuid: string }
	| { kind: "view"; name: string }
	| null;

/**
 * Куда ведёт уведомление: запись (endpoint + uuid — задача, нарушение, заявка) или панель по
 * имени (pane). Без ссылки уведомление только отмечается прочитанным.
 */
export function notificationTarget(n: Pick<UserNotification, "link">): NotificationTarget {
	const l = n.link;
	if (!l) return null;
	if (l.endpoint && l.uuid) return { kind: "form", endpoint: l.endpoint, uuid: l.uuid };
	if (l.pane) return { kind: "view", name: l.pane };
	return null;
}

export const unreadCount = (items: readonly UserNotification[] | null | undefined): number =>
	(items ?? []).reduce((n, i) => n + (i.readAt ? 0 : 1), 0);
