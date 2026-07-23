/**
 * useChatUnread — счётчик непрочитанных сообщений чата (E4.1).
 *
 * Непрочитанное считает сервер: число ЧУЖИХ сообщений позже отметки прочтения
 * (`/chat/unread`). Обновляется двумя путями:
 *   • по событию SSE-шины — новое сообщение приходит мгновенно, без опроса;
 *   • периодически (мягкий фолбэк, если поток был оборван).
 *
 * Отметку прочтения ставит сам чат при открытии (`markChatRead`).
 */
import { useCallback, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "src/services/api/client";
import { onLiveEvent } from "src/services/liveEvents";

const QUERY_KEY = ["chat-unread"];

interface UnreadResponse {
	total?: number;
	byOrg?: Record<string, number>;
}

/** Отметить канал организации прочитанным. */
export async function markChatRead(organizationUuid: string): Promise<void> {
	if (!organizationUuid) return;
	try {
		await apiClient.post("chat/read", { organizationUuid });
	} catch {
		// Непрочитанное — вспомогательный индикатор: сбой отметки не должен
		// ломать работу с чатом.
	}
}

export function useChatUnread() {
	const queryClient = useQueryClient();

	const { data } = useQuery({
		queryKey: QUERY_KEY,
		queryFn: async (): Promise<UnreadResponse> => {
			const r = await apiClient.get<UnreadResponse>("chat/unread");
			return r.data ?? {};
		},
		// Мягкий фолбэк на случай оборванного SSE; основной путь — invalidate по событию.
		refetchInterval: 60_000,
		staleTime: 15_000,
	});

	/** Пересчитать (после прихода сообщения или отметки прочтения). */
	const refresh = useCallback(() => {
		void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
	}, [queryClient]);

	// Живое обновление: новое сообщение по SSE — сразу пересчитываем счётчик,
	// иначе бейдж ждал бы периодического опроса (до минуты).
	useEffect(() => onLiveEvent("chat", () => refresh()), [refresh]);

	return { total: data?.total ?? 0, byOrg: data?.byOrg ?? {}, refresh };
}
