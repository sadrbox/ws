// ─────────────────────────────────────────────────────────────────────────────
// Панель «Коммуникации» (E14/W2, ТЗ §8) — единое окно переписки:
//   • вкладка «Внутренний чат» — существующий ChatList (без изменений);
//   • вкладка «WhatsApp» — список диалогов + окно чата + сводка по собеседнику.
//
// Отправка наружу пока не подключена (WhatsApp API не настроен): исходящие
// сохраняются со статусом «в очереди» и уйдут при подключении провайдера.
// ─────────────────────────────────────────────────────────────────────────────
import { FC, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChatList } from "src/models/Chat";
import { Button } from "src/components/Button";
import { Field } from "src/components/Field";
import { onLiveEvent } from "src/services/liveEvents";
import { getFormatDate, getFormatDateOnly } from "src/utils/datetime";
import { translate } from "src/i18";
import styles from "./Communications.module.scss";
import {
  fetchConversations, fetchMessages, sendMessage, markRead, fetchSummary,
  type WaConversation, type WaMessage,
} from "src/services/wa/api";

type Tab = "internal" | "wa";

/** Подпись диалога: имя контактного лица → контрагент → номер. */
const convTitle = (c: WaConversation) =>
  c.contactPersonName || c.displayName || c.counterpartyName || `+${c.phone}`;

const STATUS_LABEL: Record<WaMessage["status"], string> = {
  received: "", queued: "в очереди", sent: "отправлено",
  delivered: "доставлено", read: "прочитано", failed: "ошибка",
};

// ── Сводка по собеседнику (правая панель, ТЗ §8.3) ──────────────────────────
const ContactSummary: FC<{ conversationUuid: string }> = ({ conversationUuid }) => {
  const { data, isLoading } = useQuery({
    queryKey: ["wa-summary", conversationUuid],
    queryFn: () => fetchSummary(conversationUuid),
    staleTime: 30_000,
  });
  if (isLoading) return <div className={styles.SummaryEmpty}>{translate("loading")}…</div>;
  if (!data) return null;
  const person = data.contactPerson;
  const personName = person?.fullName || [person?.lastName, person?.firstName].filter(Boolean).join(" ");
  return (
    <div className={styles.Summary}>
      <div className={styles.SummarySection}>
        <div className={styles.SummaryLabel}>{translate("waContactPerson")}</div>
        {person
          ? <div className={styles.SummaryValue}>{personName || "—"}</div>
          : <div className={styles.SummaryHint}>{translate("waNotLinked")}</div>}
      </div>

      {data.counterparty && (
        <div className={styles.SummarySection}>
          <div className={styles.SummaryLabel}>{translate("counterparty")}</div>
          <div className={styles.SummaryValue}>{data.counterparty.name}</div>
          {data.counterparty.bin && <div className={styles.SummaryMuted}>БИН {data.counterparty.bin}</div>}
        </div>
      )}

      {data.contacts.length > 0 && (
        <div className={styles.SummarySection}>
          <div className={styles.SummaryLabel}>{translate("contacts")}</div>
          {data.contacts.map((c, i) => (
            <div key={i} className={styles.SummaryMuted}>{c.contactType}: {c.value}</div>
          ))}
        </div>
      )}

      {data.sales.length > 0 && (
        <div className={styles.SummarySection}>
          <div className={styles.SummaryLabel}>{translate("waRecentDocs")}</div>
          {data.sales.map((s) => (
            <div key={s.uuid} className={styles.SummaryRow}>
              <span>{s.number ? `№ ${s.number}` : translate("docNoNumber")}</span>
              <span className={styles.SummaryMuted}>{getFormatDateOnly(s.date ?? "")}</span>
              <span className={styles.SummaryAmount}>{Number(s.amount ?? 0).toLocaleString("ru-RU")}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ── Окно диалога ────────────────────────────────────────────────────────────
const WaChatWindow: FC<{ conversation: WaConversation }> = ({ conversation }) => {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const feedRef = useRef<HTMLDivElement>(null);
  const key = useMemo(() => ["wa-messages", conversation.uuid], [conversation.uuid]);

  const { data: messages = [] } = useQuery({ queryKey: key, queryFn: () => fetchMessages(conversation.uuid) });

  useEffect(() => {
    const el = feedRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  // Прочитано + сброс бейджа при открытии/новых сообщениях.
  useEffect(() => {
    void markRead(conversation.uuid).then(() => qc.invalidateQueries({ queryKey: ["wa-conversations"] }));
  }, [conversation.uuid, messages.length, qc]);

  const send = useCallback(async () => {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    try {
      await sendMessage(conversation.uuid, body);
      setText("");
      await qc.invalidateQueries({ queryKey: key });
      await qc.invalidateQueries({ queryKey: ["wa-conversations"] });
    } finally { setBusy(false); }
  }, [text, busy, conversation.uuid, qc, key]);

  return (
    <div className={styles.ChatWindow}>
      <div className={styles.ChatHeader}>
        <div className={styles.ChatTitle}>{convTitle(conversation)}</div>
        <div className={styles.ChatSubtitle}>+{conversation.phone}</div>
      </div>

      <div className={styles.Feed} ref={feedRef}>
        {messages.length === 0 && <div className={styles.SummaryEmpty}>{translate("waNoMessages")}</div>}
        {messages.map((m) => (
          <div key={m.uuid} className={m.direction === "in" ? styles.BubbleIn : styles.BubbleOut}>
            <div className={styles.BubbleBody}>{m.body}</div>
            <div className={styles.BubbleMeta}>
              {getFormatDate(m.createdAt)}
              {m.direction === "out" && STATUS_LABEL[m.status] && <> · {STATUS_LABEL[m.status]}</>}
              {m.errorText && <span className={styles.BubbleError}> · {m.errorText}</span>}
            </div>
          </div>
        ))}
      </div>

      <div className={styles.Composer}>
        <Field
          name="wa_input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={translate("waTypeMessage")}
          disabled={busy}
        />
        <Button onClick={() => void send()} disabled={busy || !text.trim()} variant="primary">
          {translate("waSend")}
        </Button>
      </div>
      <div className={styles.ComposerHint}>{translate("waQueuedHint")}</div>
    </div>
  );
};

// ── Панель целиком ──────────────────────────────────────────────────────────
export const CommunicationsPanel: FC = () => {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("internal");
  const [activeUuid, setActiveUuid] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const { data: conversations = [] } = useQuery({
    queryKey: ["wa-conversations", search],
    queryFn: () => fetchConversations(search || undefined),
    enabled: tab === "wa",
    staleTime: 10_000,
  });

  // Живое обновление списка и открытого диалога.
  useEffect(() => onLiveEvent("wa", () => {
    void qc.invalidateQueries({ queryKey: ["wa-conversations"] });
    if (activeUuid) void qc.invalidateQueries({ queryKey: ["wa-messages", activeUuid] });
  }), [qc, activeUuid]);

  const active = conversations.find((c) => c.uuid === activeUuid) ?? null;

  return (
    <div className={styles.Root}>
      <div className={styles.Sidebar}>
        <div className={styles.Tabs}>
          <button type="button" className={tab === "internal" ? styles.TabActive : styles.Tab} onClick={() => setTab("internal")}>
            {translate("waInternalChat")}
          </button>
          <button type="button" className={tab === "wa" ? styles.TabActive : styles.Tab} onClick={() => setTab("wa")}>
            WhatsApp
          </button>
        </div>

        {tab === "wa" && (
          <>
            <div className={styles.SearchBox}>
              <Field name="wa_search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={translate("search")} />
            </div>
            <div className={styles.ConvList}>
              {conversations.length === 0 && <div className={styles.SummaryEmpty}>{translate("waNoConversations")}</div>}
              {conversations.map((c) => (
                <button
                  key={c.uuid}
                  type="button"
                  className={c.uuid === activeUuid ? styles.ConvItemActive : styles.ConvItem}
                  onClick={() => setActiveUuid(c.uuid)}
                >
                  <div className={styles.ConvTitle}>
                    {convTitle(c)}
                    {c.unreadCount > 0 && <span className={styles.Badge}>{c.unreadCount}</span>}
                  </div>
                  <div className={styles.ConvMeta}>
                    {c.counterpartyName ?? `+${c.phone}`}
                    {c.lastMessageAt && <> · {getFormatDateOnly(c.lastMessageAt)}</>}
                  </div>
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <div className={styles.Main}>
        {tab === "internal" && <ChatList />}
        {tab === "wa" && (active
          ? <WaChatWindow conversation={active} />
          : <div className={styles.SummaryEmpty}>{translate("waPickConversation")}</div>)}
      </div>

      {tab === "wa" && active && (
        <div className={styles.Aside}>
          <ContactSummary conversationUuid={active.uuid} />
        </div>
      )}
    </div>
  );
};

CommunicationsPanel.displayName = "CommunicationsPanel";
export default CommunicationsPanel;
