/**
 * Chat — чат между пользователями в пределах организации (E4, collaboration).
 *
 * Транспорт: получение — SSE (EventSource на /chat/stream, авторизация query-
 * токеном, т.к. EventSource не шлёт заголовки), отправка — POST /chat/messages.
 * Realtime-доставка через шину организации; при обрыве EventSource сам
 * реконнектится (retry задаёт сервер).
 *
 * Мультитенант: список организаций — доступные пользователю (из auth). Сообщения
 * канала видит только тот, у кого есть доступ к организации (проверяет бэкенд).
 */
import { FC, useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient, API_BASE_URL } from "src/services/api/client";
import { getToken, getCurrentUser } from "src/services/auth";
import { useAppContext } from "src/app/context";
import { translate } from "src/i18";
import { getFormatDate } from "src/utils/datetime";
import styles from "./Chat.module.scss";

interface ChatMessage {
  uuid: string;
  organizationUuid: string;
  authorUuid: string;
  authorName: string;
  body: string;
  createdAt: string;
}

const timeOf = (iso: string): string => {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${getFormatDate(iso) ?? ""} ${hh}:${mm}`;
};

export const ChatList: FC = () => {
  const me = getCurrentUser();
  const { auth } = useAppContext();
  const queryClient = useQueryClient();

  // Доступные пользователю организации (для выбора канала).
  const orgs = useMemo(() => {
    const list = (auth.user?.accessRights ?? [])
      .map((a) => ({ uuid: a.organizationUuid, name: a.organization?.name ?? a.organizationUuid }))
      .filter((o) => o.uuid);
    // Уникальные по uuid.
    const seen = new Set<string>();
    return list.filter((o) => (seen.has(o.uuid) ? false : (seen.add(o.uuid), true)));
  }, [auth.user]);

  const [orgUuid, setOrgUuid] = useState<string>(() => auth.user?.organizationUuid || orgs[0]?.uuid || "");
  const [text, setText] = useState("");
  const [connected, setConnected] = useState(false);
  const feedRef = useRef<HTMLDivElement>(null);

  const queryKey = ["chat", orgUuid];

  const { data, isLoading, isError } = useQuery({
    queryKey,
    queryFn: async () => {
      const r = await apiClient.get<{ items?: ChatMessage[] }>("chat/messages", { params: { organizationUuid: orgUuid } });
      return r.data?.items ?? [];
    },
    enabled: !!orgUuid,
    staleTime: 10_000,
  });

  // Прокрутка к последнему сообщению при обновлении ленты.
  const messages = data ?? [];
  useEffect(() => {
    const el = feedRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  // ── SSE-подписка ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!orgUuid) return;
    const token = getToken();
    if (!token) return;
    const es = new EventSource(`${API_BASE_URL}/chat/stream?token=${encodeURIComponent(token)}`);

    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false); // EventSource реконнектится сам
    es.onmessage = (e) => {
      try {
        const ev = JSON.parse(e.data) as { type: string; message?: ChatMessage };
        if (ev.type === "chat" && ev.message && ev.message.organizationUuid === orgUuid) {
          const msg = ev.message;
          queryClient.setQueryData<ChatMessage[]>(queryKey, (old) => {
            const list = old ?? [];
            if (list.some((m) => m.uuid === msg.uuid)) return list; // дедуп (своё эхо)
            return [...list, msg];
          });
        }
      } catch { /* игнорируем некорректный кадр */ }
    };

    return () => es.close();
    // queryKey стабилен при том же orgUuid; пересоздаём подписку при смене канала.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgUuid]);

  const send = useCallback(async () => {
    const body = text.trim();
    if (!body || !orgUuid) return;
    setText("");
    try {
      await apiClient.post("chat/messages", { organizationUuid: orgUuid, body });
      // Сообщение прилетит по SSE и добавится в ленту (с дедупом).
    } catch {
      setText(body); // вернуть текст, чтобы не потерять при ошибке
    }
  }, [text, orgUuid]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter — отправить, Shift+Enter — перенос строки.
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  return (
    <div className={styles.Wrap}>
      <div className={styles.Header}>
        <select className={styles.OrgSelect} value={orgUuid} onChange={(e) => setOrgUuid(e.target.value)}>
          {orgs.length === 0 && <option value="">{translate("chatNoOrg")}</option>}
          {orgs.map((o) => <option key={o.uuid} value={o.uuid}>{o.name}</option>)}
        </select>
        <span className={styles.Conn}>
          <span className={`${styles.Dot} ${connected ? styles.online : styles.offline}`} />
          {connected ? translate("chatOnline") : translate("chatOffline")}
        </span>
      </div>

      <div className={styles.Feed} ref={feedRef}>
        {isLoading ? (
          <div className={styles.Status}>{translate("chatConnecting")}</div>
        ) : isError ? (
          <div className={styles.Status}>{translate("chatError")}</div>
        ) : messages.length === 0 ? (
          <div className={styles.Empty}>{translate("chatEmpty")}</div>
        ) : (
          messages.map((m) => (
            <div key={m.uuid} className={`${styles.Msg}${m.authorUuid === me?.uuid ? ` ${styles.mine}` : ""}`}>
              <div className={styles.MsgHead}>
                <span className={styles.Author}>{m.authorName}</span>
                <span className={styles.Time}>{timeOf(m.createdAt)}</span>
              </div>
              <div className={styles.Body}>{m.body}</div>
            </div>
          ))
        )}
      </div>

      <div className={styles.InputBar}>
        <textarea
          className={styles.Input}
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={translate("chatPlaceholder")}
          disabled={!orgUuid}
        />
        <button className={styles.SendBtn} onClick={() => void send()} disabled={!text.trim() || !orgUuid}>
          {translate("chatSend")}
        </button>
      </div>
    </div>
  );
};

const Chat = ChatList;
export default Chat;
