// Клиент гос-документов РК: ЭАВР (из Реализации) и СНТ (из Реализации/Перемещения).
// См. backend/api/router/govdocs.js. Поток: build-xml → подпись NCALayer → upload.
import { api } from "src/services/api/client";

const cfg = { timeout: 60_000 };

export type SntSource = "sales" | "inventory-transfers";

export interface AwpResult { success: boolean; awpStatus?: string | null; awpId?: string | null; awpRegistrationNumber?: string | null; }
export interface SntResult { success: boolean; sntStatus?: string | null; sntId?: string | null; sntRegistrationNumber?: string | null; }

// ── ЭАВР ────────────────────────────────────────────────────────────────────
export const buildAwpXml = (saleUuid: string, performedDate?: string) =>
	api.post<{ success: boolean; xml: string }>(`/awp/sales/${saleUuid}/build-xml`, { performedDate }, cfg);

export const uploadAwp = (saleUuid: string, sessionId: string, signedXml: string, x509Certificate?: string) =>
	api.post<AwpResult>(`/awp/sales/${saleUuid}/upload`, { sessionId, signedXml, x509Certificate }, cfg);

export const refreshAwpStatus = (saleUuid: string, sessionId: string) =>
	api.post<AwpResult>(`/awp/sales/${saleUuid}/status`, { sessionId }, cfg);

// ── СНТ ─────────────────────────────────────────────────────────────────────
export const buildSntXml = (source: SntSource, uuid: string, sntType?: string) =>
	api.post<{ success: boolean; xml: string }>(`/snt/${source}/${uuid}/build-xml`, { sntType }, cfg);

export const uploadSnt = (source: SntSource, uuid: string, sessionId: string, signedXml: string, x509Certificate?: string) =>
	api.post<SntResult>(`/snt/${source}/${uuid}/upload`, { sessionId, signedXml, x509Certificate }, cfg);

export const refreshSntStatus = (source: SntSource, uuid: string, sessionId: string) =>
	api.post<SntResult>(`/snt/${source}/${uuid}/status`, { sessionId }, cfg);

// ── Исходящие (списки выписанных) ─────────────────────────────────────────────
export interface AwpOutboxRow { uuid: string; number: string | null; date: string; awpStatus: string | null; awpRegistrationNumber: string | null; counterpartyName?: string; }
export interface SntOutboxRow { uuid: string; number: string | null; date: string; sntStatus: string | null; sntRegistrationNumber: string | null; source: SntSource; contragent?: string; }

export const fetchAwpOutbox = () => api.get<{ success: boolean; items: AwpOutboxRow[] }>("/awp/outbox");
export const fetchSntOutbox = () => api.get<{ success: boolean; items: SntOutboxRow[] }>("/snt/outbox");

// ── Входящие (опрос ИС ЭСФ, нужна сессия) ─────────────────────────────────────
export interface GovIncomingRow { registrationNumber: string | null; status: string | null; date: string | null; awpId?: string | null; sntId?: string | null; }

export const fetchAwpIncoming = (sessionId: string, lastEventDate?: string) =>
	api.post<{ success: boolean; items: GovIncomingRow[] }>("/awp/incoming", { sessionId, lastEventDate }, cfg);
export const fetchSntIncoming = (sessionId: string, lastEventDate?: string) =>
	api.post<{ success: boolean; items: GovIncomingRow[] }>("/snt/incoming", { sessionId, lastEventDate }, cfg);

// ── Приём входящих (changeStatus — подписанное действие CONFIRM/DECLINE) ───────
export type GovAction = "CONFIRM" | "DECLINE";

export const buildAwpAction = (awpId: string, actionType: GovAction, cause?: string) =>
	api.post<{ success: boolean; xml: string }>("/awp/incoming/build-action", { awpId, actionType, cause }, cfg);
export const changeAwpIncoming = (sessionId: string, awpId: string, signedActionBody: string, x509Certificate?: string) =>
	api.post<{ success: boolean; status?: string }>("/awp/incoming/change-status", { sessionId, awpId, signedActionBody, x509Certificate }, cfg);

export const buildSntAction = (sntId: string, actionType: GovAction, cause?: string) =>
	api.post<{ success: boolean; xml: string }>("/snt/incoming/build-action", { sntId, actionType, cause }, cfg);
export const changeSntIncoming = (sessionId: string, sntId: string, signedActionBody: string, x509Certificate?: string) =>
	api.post<{ success: boolean; status?: string }>("/snt/incoming/change-status", { sessionId, sntId, signedActionBody, x509Certificate }, cfg);
