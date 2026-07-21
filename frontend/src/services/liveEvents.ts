/**
 * liveEvents — единый SSE-канал сессии (E4/E9, collaboration).
 *
 * ОДНО EventSource-соединение на всё приложение, а не по одному на каждую панель.
 * Компоненты подписываются на события по типу ("chat" | "task" | …); чат и
 * уведомления о задачах делят один поток и одну реконнект-логику (EventSource
 * реконнектится сам; интервал задаёт сервер через `retry:`).
 *
 * Соединение открывается лениво при первой подписке и закрывается, когда
 * подписчиков не осталось. Смена токена (пере-логин) требует reset().
 */
import { API_BASE_URL } from "src/services/api/client";
import { getToken } from "src/services/auth";

export interface LiveEvent {
  type: string;
  [key: string]: unknown;
}

type Handler = (event: LiveEvent) => void;

const handlers = new Map<string, Set<Handler>>();
let source: EventSource | null = null;
let currentToken: string | null = null;

function open(): void {
  const token = getToken();
  if (!token) return;
  // Токен сменился (пере-логин) — пересоздаём соединение.
  if (source && currentToken !== token) close();
  if (source) return;

  currentToken = token;
  source = new EventSource(`${API_BASE_URL}/chat/stream?token=${encodeURIComponent(token)}`);
  source.onmessage = (e) => {
    let ev: LiveEvent;
    try {
      ev = JSON.parse(e.data) as LiveEvent;
    } catch {
      return; // некорректный кадр — игнорируем
    }
    const set = handlers.get(ev.type);
    if (set) for (const h of set) h(ev);
  };
  // onerror не рвём — EventSource реконнектится сам.
}

function close(): void {
  source?.close();
  source = null;
  currentToken = null;
}

/**
 * Подписаться на события заданного типа. Возвращает функцию отписки.
 * Первая подписка открывает соединение, последняя отписка — закрывает.
 */
export function onLiveEvent(type: string, handler: Handler): () => void {
  let set = handlers.get(type);
  if (!set) {
    set = new Set();
    handlers.set(type, set);
  }
  set.add(handler);
  open();

  return () => {
    set?.delete(handler);
    // Не осталось ни одного подписчика вообще — закрываем соединение.
    const anyLeft = [...handlers.values()].some((s) => s.size > 0);
    if (!anyLeft) close();
  };
}

/** Принудительно пересоздать соединение (напр. после смены токена). */
export function resetLiveEvents(): void {
  close();
  const anyLeft = [...handlers.values()].some((s) => s.size > 0);
  if (anyLeft) open();
}

export default { onLiveEvent, resetLiveEvents };
