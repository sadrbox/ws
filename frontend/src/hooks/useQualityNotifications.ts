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
 *
 * ВКЛАДКА, ОТКРЫТАЯ С ВЕЧЕРА (И24 аудита 26.09). Отметка ставилась только при монтировании приложения,
 * а JWT живёт сутки: утром отметки не было — кандидат по пп. 32/33. Теперь «сегодня» пересчитывается при
 * возврате во вкладку и на каждом круге опроса, а день считается ЗАПОМНЕННЫМ только после ответа сервера:
 * упавший запрос (перезапуск сервера) раньше оставлял человека без отметки на весь день.
 *
 * Скрытая вкладка браузера опрос не гоняет (О4): вернулись — сразу проверка с момента прошлой.
 */
import { useEffect, useRef } from "react";
import { onLiveEvent } from "src/services/liveEvents";
import { showToast } from "src/components/UIToast";
import { getCurrentUser } from "src/services/auth";
import { queryClient } from "src/app/queryClient";
import { fetchNotifications, markWorkDay, type UserNotification } from "src/services/quality/api";
import { QUALITY_ME_KEY } from "src/hooks/useQualityMe";
import { getAppUtcOffset } from "src/utils/datetime";
import { localYmd } from "src/models/_quality/month";

const POLL_MS = 60_000;
const LOGIN_MARK_KEY = "quality_login_mark_day";
/** Сбой сети или сервера — повтор не чаще, чем раз в столько: без очереди запросов при лежащем сервере. */
const MARK_RETRY_MS = 5 * 60_000;

/** Сегодня — местная дата приложения (как её считает сервер в своём поясе). */
const todayKey = (now: number): string => localYmd(getAppUtcOffset() * 60, now);

let markInFlight = false;
let markFailedAt = 0;
/**
 * День отметки — ещё и в памяти (КР-22 аудита 27.09): в приватном режиме и при запрете хранилища
 * localStorage недоступен, и отметка уходила на сервер на каждом круге опроса (раз в минуту) весь день.
 */
const markedDays = new Map<string, string>();

/** Сбросить состояние отметки — при смене пользователя и в тестах. */
export function resetLoginMarkState(): void {
	markInFlight = false;
	markFailedAt = 0;
	markedDays.clear();
}

function remember(key: string, day: string): void {
	markedDays.set(key, day);
	try {
		localStorage.setItem(key, day);
	} catch {
		// localStorage недоступен (приватный режим) — день запомнен в памяти вкладки
	}
}

/** Отметить приход, если за сегодняшний день отметки из этой вкладки ещё не было. */
export function markOnLoginOncePerDay(now: number = Date.now()): void {
	const me = getCurrentUser();
	if (!me?.uuid) return;
	const key = `${LOGIN_MARK_KEY}:${me.uuid}`;
	const day = todayKey(now);
	if (markedDays.get(key) === day) return;
	try {
		if (localStorage.getItem(key) === day) return;
	} catch {
		// нет хранилища — день помнит markedDays
	}
	if (markInFlight || now - markFailedAt < MARK_RETRY_MS) return;
	markInFlight = true;
	markWorkDay("login")
		.then(() => remember(key, day))
		.catch((e: unknown) => {
			const status = (e as { response?: { status?: number } } | null)?.response?.status ?? 0;
			// Фирма не назначена, нет прав — отказ по существу: сегодня не повторяем. Сеть и 5xx — повторим позже.
			if (status >= 400 && status < 500) remember(key, day);
			else markFailedAt = Date.now();
		})
		.finally(() => { markInFlight = false; });
}

const pageHidden = (): boolean => typeof document !== "undefined" && document.visibilityState === "hidden";

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

		let lastPollAt = 0;
		const poll = () => {
			// Скрытая вкладка не опрашивает: вернёмся — проверим «с момента прошлой» разом (О4).
			if (pageHidden()) return;
			lastPollAt = Date.now();
			// Сменился день, пока вкладка открыта, — отметка прихода за новый день.
			markOnLoginOncePerDay();
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
		// Вернулись во вкладку (утром, после сна компьютера) — сразу и отметка, и непрочитанное.
		// focus и visibilitychange приходят парой, а Alt-Tab — часто: не чаще раза в 15 с.
		const onVisible = () => { if (!pageHidden() && Date.now() - lastPollAt >= 15_000) poll(); };
		document.addEventListener("visibilitychange", onVisible);
		window.addEventListener("focus", onVisible);

		return () => {
			off();
			window.clearInterval(timer);
			document.removeEventListener("visibilitychange", onVisible);
			window.removeEventListener("focus", onVisible);
		};
	}, [isLoggedIn]);
}
