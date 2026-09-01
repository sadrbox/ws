// API панели «Коммуникации» (E14). Типы соответствуют backend/api/router/wa.js.
import { api } from "src/services/api/client";

export interface WaConversation {
  uuid: string;
  phone: string;
  displayName?: string | null;
  contactPersonUuid?: string | null;
  counterpartyUuid?: string | null;
  contactPersonName?: string | null;
  counterpartyName?: string | null;
  lastMessageAt?: string | null;
  lastIncomingAt?: string | null;
  unreadCount: number;
}

export interface WaMessage {
  uuid: string;
  conversationUuid: string;
  direction: "in" | "out";
  body?: string | null;
  mediaFileUuid?: string | null;
  mediaType?: string | null;
  authorUuid?: string | null;
  status: "received" | "queued" | "sent" | "delivered" | "read" | "failed";
  errorText?: string | null;
  createdAt: string;
}

export interface WaSummary {
  conversation: WaConversation;
  contactPerson?: { uuid: string; fullName?: string | null; firstName?: string | null; lastName?: string | null; comment?: string | null } | null;
  counterparty?: { uuid: string; name?: string | null; bin?: string | null } | null;
  contacts: { value: string; contactType: string; isPrimary: boolean }[];
  sales: { uuid: string; number?: string | null; date?: string | null; amount?: number | string | null; posted?: boolean }[];
}

export const fetchConversations = (search?: string) =>
  api.get<{ items: WaConversation[] }>("wa/conversations", { params: search ? { search } : undefined })
    .then((r) => r.items ?? []);

export const fetchMessages = (uuid: string) =>
  api.get<{ items: WaMessage[] }>(`wa/conversations/${uuid}/messages`).then((r) => r.items ?? []);

export const sendMessage = (uuid: string, body: string) =>
  api.post<{ item: WaMessage }>(`wa/conversations/${uuid}/messages`, { body }).then((r) => r.item);

export const markRead = (uuid: string) => api.post(`wa/conversations/${uuid}/read`, {});

export const linkContact = (uuid: string, contactPersonUuid: string | null) =>
  api.post(`wa/conversations/${uuid}/link`, { contactPersonUuid });

export const fetchSummary = (uuid: string) =>
  api.get<WaSummary>(`wa/contact-summary/${uuid}`);

/** Имитация входящего — пока WhatsApp API не подключён (суперадмин). */
export const simulateIncoming = (phone: string, body: string) =>
  api.post<{ conversationUuid: string }>("wa/simulate-incoming", { phone, body });
