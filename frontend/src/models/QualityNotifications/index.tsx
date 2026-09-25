/**
 * «Мои уведомления» — личные уведомления учёта качества (E17): SLA и эскалации по задачам,
 * кандидаты и решения по нарушениям, напоминания и возвраты клиента.
 *
 * Уведомления хранятся на сервере (а не только летят по SSE): шина событий живёт в памяти
 * процесса, а backend работает кластером. Новые приходят тостом где угодно в приложении
 * (hooks/useQualityNotifications), здесь — весь список: непрочитанные сверху. Щелчок отмечает
 * уведомление прочитанным и открывает запись, о которой оно.
 */
import { type FC, useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { translate } from "src/i18";
import { useAppContext } from "src/app/context";
import { Button } from "src/components/Button";
import Notice, { type NoticeItem } from "src/components/Notice";
import { usePaneToolbar } from "src/hooks/usePaneToolbar";
import { QUALITY_ME_KEY } from "src/hooks/useQualityMe";
import { routeError } from "src/services/errors/route";
import { restorePane } from "src/app/paneRestore";
import { getByEndpoint } from "src/registry/modelRegistry";
import { openFormByEndpoint } from "src/registry/formRegistry";
import { getFormatDate } from "src/utils/datetime";
import { fetchNotifications, markNotificationsRead, type UserNotification } from "src/services/quality/api";
import { notificationTarget, sortNotifications, unreadCount } from "./notifications";
import main from "src/styles/main.module.scss";
import styles from "./QualityNotifications.module.scss";

const COMPONENT = "QualityNotificationsList";
/** Ключ — под `["quality", "notifications"]`: его перечитывает хук уведомлений приложения. */
const listKey = (onlyUnread: boolean) => ["quality", "notifications", "list", onlyUnread] as const;

export const QualityNotificationsList: FC<{ uniqId?: string }> = ({ uniqId }) => {
	const queryClient = useQueryClient();
	const { addPane } = useAppContext().windows;
	const [onlyUnread, setOnlyUnread] = useState(false);
	const [busy, setBusy] = useState(false);
	const [notices, setNotices] = useState<NoticeItem[]>([]);

	const q = useQuery({
		queryKey: listKey(onlyUnread),
		queryFn: () => fetchNotifications({ unread: onlyUnread, limit: 200 }),
		staleTime: 15_000,
	});
	const items = useMemo(() => sortNotifications(q.data?.items), [q.data]);
	const unread = q.data?.unreadCount ?? unreadCount(items);

	const refresh = useCallback(async () => {
		await queryClient.invalidateQueries({ queryKey: ["quality", "notifications"] });
		void queryClient.invalidateQueries({ queryKey: QUALITY_ME_KEY });
	}, [queryClient]);

	const markRead = useCallback(async (body: { uuids?: string[]; all?: boolean }) => {
		try {
			await markNotificationsRead(body);
			await refresh();
		} catch (e) {
			setNotices(routeError(e, { source: translate(COMPONENT), fallback: translate("qualityNotificationsReadFailed") }));
		}
	}, [refresh]);

	const open = useCallback((n: UserNotification) => {
		setNotices([]);
		if (!n.readAt) void markRead({ uuids: [n.uuid] });
		const target = notificationTarget(n);
		if (target?.kind === "form") {
			// Раздел, которого в реестре нет, не открыть: уведомление всё равно прочитано.
			if (getByEndpoint(target.endpoint)) void openFormByEndpoint(target.endpoint, target.uuid, addPane);
		} else if (target?.kind === "view") {
			void restorePane({ uniqId: "", label: translate(target.name), restore: { kind: "view", name: target.name } }, addPane);
		}
	}, [markRead, addPane]);

	const readAll = useCallback(async () => {
		setBusy(true);
		setNotices([]);
		await markRead({ all: true });
		setBusy(false);
	}, [markRead]);

	const toolbar = usePaneToolbar(uniqId, (
		<>
			<Button onClick={() => void readAll()} disabled={busy || !unread}>
				{translate("markAllRead")}{unread ? ` (${unread})` : ""}
			</Button>
			<Button active={onlyUnread} onClick={() => setOnlyUnread((v) => !v)}>{translate("qualityNotificationsOnlyUnread")}</Button>
			<Button onClick={() => void q.refetch()} disabled={q.isFetching}>{translate("refresh")}</Button>
		</>
	));

	return (
		<>
			{toolbar}
			<div className={main.PaneFill}>
				{q.isLoading ? (
					<div className={main.CenteredPlaceholder}>{translate("loading")}</div>
				) : !items.length ? (
					<div className={main.CenteredPlaceholder}>
						{translate(onlyUnread ? "qualityNotificationsNoUnread" : "qualityNotificationsEmpty")}
					</div>
				) : (
					<ul className={styles.List}>
						{items.map((n) => {
							const target = notificationTarget(n);
							return (
								<li key={n.uuid}>
									<button type="button" className={[styles.Item, !n.readAt && styles.Unread].filter(Boolean).join(" ")}
										onClick={() => open(n)}
										title={target ? translate("qualityNotificationsOpenHint") : translate("markRead")}>
										<span className={styles.Dot} aria-hidden />
										<span className={styles.Main}>
											{!n.readAt && <span className={styles.VisuallyHidden}>{translate("qualityNotificationsUnread")}: </span>}
											<span className={styles.Title}>{n.title}</span>
											{n.body && <span className={styles.Text}>{n.body}</span>}
										</span>
										<span className={styles.Time}>{getFormatDate(n.createdAt)}</span>
									</button>
								</li>
							);
						})}
					</ul>
				)}
			</div>
			<Notice items={notices} />
		</>
	);
};
QualityNotificationsList.displayName = COMPONENT;

export default QualityNotificationsList;
