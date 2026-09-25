/**
 * useQualityNotifications — уведомления E17 (SLA, эскалации, кандидаты в нарушения) на уровне
 * приложения: тост о новом уведомлении, где бы пользователь ни был.
 *
 * ДВА КАНАЛА, И ОБА НУЖНЫ. SSE-событие `notify` приходит мгновенно (между воркерами кластера шина
 * ходит через Postgres LISTEN/NOTIFY), но событие, случившееся, пока SSE переподключался или у шины
 * рвалось соединение, теряется. Поэтому раз в минуту — опрос непрочитанных «с момента последней
 * проверки»; уже показанное не повторяется (множество показанных uuid).
 *
 * ОТМЕТКА ПРИХОДА ПРИ ВХОДЕ (СК6.2). Раз в день после входа панель просит сервер отметить начало
 * дня с источником `login`; сервер сам решает, включено ли это настройкой (attendance.source),
 * и не сдвигает уже поставленную отметку. По умолчанию (решено 25.09) — «кнопка или вход»: забытая
 * кнопка не делает работающего человека прогульщиком.
 */
import { useEffect, useRef } from "react";
import { onLiveEvent } from "src/services/liveEvents";
import { showToast } from "src/components/UIToast";
import { getCurrentUser } from "src/services/auth";
import { queryClient } from "src/app/queryClient";
import { fetchNotifications, markWorkDay, type UserNotification } from "src/services/quality/api";
import { QUALITY_ME_KEY } from "src/hooks/useQualityMe";

const POLL_MS = 60_000;
const LOGIN_MARK_KEY = "quality_login_mark_day";

function todayKey(): string {
	const d = new Date();
	return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function markOnLoginOncePerDay() {
	try {
		const me = getCurrentUser();
		const key = `${LOGIN_MARK_KEY}:${me?.uuid ?? ""}`;
		if (localStorage.getItem(key) === todayKey()) return;
		localStorage.setItem(key, todayKey());
	} catch {
		// localStorage недоступен (приватный режим) — просто отмечаем, сервер не сдвинет отметку
	}
	markWorkDay("login").catch(() => {
		// фирма не назначена или отметка при входе выключена — это не ошибка для пользователя
	});
}

export function useQualityNotifications(isLoggedIn: boolean) {
	const shown = useRef(new Set<string>());
	const since = useRef<string>(new Date().toISOString());

	useEffect(() => {
		if (!isLoggedIn) return;
		const toast = (n: Pick<UserNotification, "uuid" | "title" | "body">) => {
			if (shown.current.has(n.uuid)) return;
			shown.current.add(n.uuid);
			showToast(n.body ? `${n.title}\n${n.body}` : n.title, "info");
			void queryClient.invalidateQueries({ queryKey: QUALITY_ME_KEY });
			void queryClient.invalidateQueries({ queryKey: ["quality", "notifications"] });
		};

		const off = onLiveEvent("notify", (ev) => {
			const e = ev as { userUuid?: string; notification?: UserNotification };
			const me = getCurrentUser();
			if (!e.notification || !me || e.userUuid !== me.uuid) return;
			toast(e.notification);
		});

		const poll = () => {
			const from = since.current;
			since.current = new Date().toISOString();
			fetchNotifications({ unread: true, since: from, limit: 20 })
				.then((r) => {
					// Старые — первыми, чтобы тосты шли в порядке событий.
					for (const n of [...(r.items || [])].reverse()) toast(n);
				})
				.catch(() => {
					// сервер недоступен или раздел не настроен — повторим на следующем круге
					since.current = from;
				});
		};
		const timer = window.setInterval(poll, POLL_MS);
		markOnLoginOncePerDay();

		return () => {
			off();
			window.clearInterval(timer);
		};
	}, [isLoggedIn]);
}
