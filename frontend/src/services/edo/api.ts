// Клиент HTTP-API ЭДО (документооборот с контрагентами). См. backend/api/router/edo.js.
import { api } from "src/services/api/client";

const EDO_TIMEOUT = 60_000; // подпись/обмен могут быть дольше обычного
const cfg = { timeout: EDO_TIMEOUT };

export interface EdoSignature {
	uuid: string;
	orgUuid: string;
	userUuid: string | null;
	role: "sender" | "receiver";
	certificate: string | null;
	signedAt: string;
}
export interface EdoAttachment {
	uuid: string;
	fileName: string;
	mimeType: string | null;
	fileSize: number | null;
}
export interface EdoDocument {
	uuid: string;
	senderOrgUuid: string;
	senderBin: string;
	receiverBin: string;
	receiverOrgUuid: string | null;
	kind: string;
	title: string | null;
	number: string | null;
	date: string;
	comment: string | null;
	sourceDocType: string | null;
	sourceDocUuid: string | null;
	status: string;
	rejectionReason: string | null;
	sentAt: string | null;
	deliveredAt: string | null;
	respondedAt: string | null;
	signatures?: EdoSignature[];
	attachments?: EdoAttachment[];
}

export interface CreateEdoPayload {
	receiverBin: string;
	kind: string;
	title?: string;
	number?: string;
	date?: string;
	comment?: string;
	sourceDocType?: string;
	sourceDocUuid?: string;
}

export const createEdoDocument = (payload: CreateEdoPayload) =>
	api.post<{ success: boolean; item: EdoDocument }>("/edo/documents", payload, cfg);

export const fetchOutbox = () =>
	api.get<{ success: boolean; items: EdoDocument[] }>("/edo/documents/outbox", cfg);

export const fetchInbox = () =>
	api.get<{ success: boolean; items: EdoDocument[] }>("/edo/documents/inbox", cfg);

export const fetchInboxNewCount = () =>
	api.get<{ success: boolean; count: number }>("/edo/documents/inbox/new-count", cfg);

export const fetchEdoDocument = (uuid: string) =>
	api.get<{ success: boolean; item: EdoDocument }>(`/edo/documents/${uuid}`, cfg);

export const buildSendXml = (uuid: string) =>
	api.post<{ success: boolean; xml: string }>(`/edo/documents/${uuid}/build-xml`, {}, cfg);

export const sendEdoDocument = (uuid: string, signedXml: string, certificate?: string) =>
	api.post<{ success: boolean; status: string; delivered: boolean; message: string }>(`/edo/documents/${uuid}/send`, { signedXml, certificate }, cfg);

export const buildAcceptXml = (uuid: string) =>
	api.post<{ success: boolean; xml: string }>(`/edo/documents/${uuid}/accept-xml`, {}, cfg);

export const acceptEdoDocument = (uuid: string, signedXml?: string, certificate?: string) =>
	api.post<{ success: boolean; status: string; message: string }>(`/edo/documents/${uuid}/accept`, { signedXml, certificate }, cfg);

export const rejectEdoDocument = (uuid: string, reason: string) =>
	api.post<{ success: boolean; status: string; message: string }>(`/edo/documents/${uuid}/reject`, { reason }, cfg);

export const revokeEdoDocument = (uuid: string, reason?: string) =>
	api.post<{ success: boolean; status: string; message: string }>(`/edo/documents/${uuid}/revoke`, { reason }, cfg);

export const annulEdoDocument = (uuid: string, reason: string) =>
	api.post<{ success: boolean; status: string; message: string }>(`/edo/documents/${uuid}/annul`, { reason }, cfg);
