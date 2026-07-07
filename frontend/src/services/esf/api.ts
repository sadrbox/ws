// Клиент HTTP-API интеграции с ИС ЭСФ (см. backend/api/router/esf.js).
// Тонкие обёртки над apiClient. SOAP-операции ЭСФ медленнее обычных запросов —
// задаём увеличенный таймаут.
import { api } from "src/services/api/client";

// ЭСФ ходит в внешний SOAP-сервис КГД — даём запас по времени.
const ESF_TIMEOUT = 60_000;
const cfg = { timeout: ESF_TIMEOUT };

export interface EsfSyncResult {
	success: boolean;
	message?: string;
	esfStatus?: string | null;
	esfInvoiceId?: string | null;
	esfNum?: string | null;
	esfRegistrationNumber?: string | null;
	esfErrorText?: string | null;
}

export interface EsfStatusResult {
	success: boolean;
	esfStatus?: string | null;
	esfRegistrationNumber?: string | null;
}

export interface EsfError {
	errorCode: string | null;
	text: string | null;
	property: string | null;
	/** Категория ошибки (session/certificate/signature/validation/business…). */
	kind?: string;
}

/** Версия/доступность контура ИС ЭСФ. */
export const getEsfVersion = () =>
	api.get<{ success: boolean; env: string; baseUrl: string; version: string }>("/esf/version", cfg);

/** Запросить XML-тикет аутентификации (для подписи на клиенте). */
export const requestAuthTicket = (iin: string, ttlInMinutes?: number) =>
	api.post<{ success: boolean; authTicketXml: string }>("/esf/auth-ticket", { iin, ttlInMinutes }, cfg);

/** Создать сессию по подписанному тикету. */
export const createSession = (signedAuthTicket: string, tin?: string) =>
	api.post<{ success: boolean; sessionId: string }>("/esf/session", { signedAuthTicket, tin }, cfg);

/** Построить InvoiceV2 XML счёта-фактуры (для подписи на клиенте). */
export const buildInvoiceXml = (uuid: string) =>
	api.post<{ success: boolean; xml: string }>(`/esf/invoices/${uuid}/build-xml`, {}, cfg);

/** Загрузить подписанный XML в ИС ЭСФ. */
export const syncInvoice = (uuid: string, sessionId: string, signedXml: string, x509Certificate?: string) =>
	api.post<EsfSyncResult>(`/esf/invoices/${uuid}/sync`, { sessionId, signedXml, x509Certificate }, cfg);

/** Обновить статус ЭСФ из ИС ЭСФ. */
export const refreshStatus = (uuid: string, sessionId: string) =>
	api.post<EsfStatusResult>(`/esf/invoices/${uuid}/refresh-status`, { sessionId }, cfg);

/** Получить ошибки ИС ЭСФ по счёту-фактуре. */
export const getInvoiceErrors = (uuid: string, sessionId: string) =>
	api.post<{ success: boolean; errors: EsfError[] }>(`/esf/invoices/${uuid}/errors`, { sessionId }, cfg);
