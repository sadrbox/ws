/**
 * Состояние агентов — ОДИН запрос на всю панель и ОДИН опрос на всё приложение.
 *
 * Состояние агента меняется без нашего участия: службу на сервере 1С останавливают,
 * перезапускают, обновляют. Пока панель спрашивала о нём только при открытии вкладки,
 * остановленный агент оставался «на связи» до перезагрузки страницы: человек жал команду
 * и ждал ответа от того, кого уже нет. Раз в 15 секунд — достаточно, чтобы заметить, и
 * дёшево: ответ идёт из базы сервиса, кластер он не трогает.
 *
 * ОПРОС — В МОДУЛЕ, А НЕ У НАБЛЮДАТЕЛЯ (О4 аудита 26.09). `useAgents` зовут два десятка мест, и у
 * `refetchInterval` react-query свой таймер на каждого наблюдателя: панели и карточки, открытые в
 * разное время, давали по запросу `/onec/agents` каждый — у администратора с десятком панелей
 * ~40 в минуту вместо 4. Теперь наблюдатель только отмечается, пока его панель на экране, а один
 * таймер модуля перечитывает общий ключ. Нет ни одного наблюдателя на экране (все панели 1С скрыты,
 * вкладка браузера свёрнута) — опроса нет; вернулись — устаревшие данные перечитываются сразу.
 *
 * Модуль без компонентов: хук живёт отдельно от shared.tsx (Fast Refresh).
 */
import { useEffect } from "react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { fetchAgents } from "src/services/onec/api";
import { usePaneOnScreen } from "src/hooks/usePaneActive";

export const AGENTS_KEY = ["onec", "agents"] as const;
export const AGENTS_POLL_MS = 15_000;

/** Наблюдатели на экране → их клиент запросов (в приложении он один; в тестах у каждого свой). */
const watchers = new Map<symbol, QueryClient>();
let timer: ReturnType<typeof setInterval> | null = null;

const refetchAgents = (qc: QueryClient) =>
	// Идущий запрос не отменяем — дожидаемся его: два одинаковых подряд незачем.
	qc.refetchQueries({ queryKey: AGENTS_KEY, type: "active" }, { cancelRefetch: false });

function tick(): void {
	for (const qc of new Set(watchers.values())) void refetchAgents(qc);
}

function syncTimer(): void {
	if (watchers.size && timer === null) timer = setInterval(tick, AGENTS_POLL_MS);
	else if (!watchers.size && timer !== null) {
		clearInterval(timer);
		timer = null;
	}
}

/** Сколько наблюдателей сейчас на экране — для тестов. */
export const agentsWatchersOnScreen = (): number => watchers.size;

export function useAgents() {
	const qc = useQueryClient();
	const onScreen = usePaneOnScreen();

	useEffect(() => {
		if (!onScreen) return;
		const id = Symbol("agents");
		watchers.set(id, qc);
		// Вернулись к панели после паузы: то, что старше интервала, перечитываем сразу, а не через 15 с.
		const st = qc.getQueryState(AGENTS_KEY);
		if (st?.dataUpdatedAt && Date.now() - st.dataUpdatedAt > AGENTS_POLL_MS) void refetchAgents(qc);
		syncTimer();
		return () => {
			watchers.delete(id);
			syncTimer();
		};
	}, [onScreen, qc]);

	return useQuery({
		queryKey: AGENTS_KEY,
		queryFn: fetchAgents,
		// Не ноль: иначе каждое монтирование любого из двух десятков мест — ещё один запрос.
		staleTime: 10_000,
		// Для «Прогресса» это опрос по расписанию, а не ожидание человека (TechMessages/fetchLabels).
		meta: { poll: true },
	});
}
