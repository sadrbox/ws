// Админ-доступ к лицензиям ЭСФ по БИН. Только суперадмин (гейт на бэке).
// См. backend/api/router/esfLicense.js (adminRouter).
import { api } from "src/services/api/client";

export interface EsfLicense {
	bin: string;
	active: boolean;
	expiresAt: string | null;
	note: string | null;
	lastRequestAt: string | null;
	requestCount: number;
	lastRequestInstallId: string | null;
	lastHeartbeatAt: string | null;
	lastHeartbeatInstallId: string | null;
	createdAt: string;
	updatedAt: string;
}

/** active: undefined — все, "true"/"false" — фильтр. */
export const fetchEsfLicenses = (params: { active?: string; search?: string; limit?: number; offset?: number } = {}) =>
	api.get<{ success: boolean; items: EsfLicense[]; total: number }>("/esf-licenses", { params });

export const patchEsfLicense = (bin: string, patch: { active?: boolean; expiresAt?: string | null; note?: string | null }) =>
	api.patch<{ success: boolean; item: EsfLicense }>(`/esf-licenses/${encodeURIComponent(bin)}`, patch);

export const createEsfLicense = (data: { bin: string; note?: string | null; active?: boolean; expiresAt?: string | null }) =>
	api.post<{ success: boolean; item: EsfLicense }>("/esf-licenses", data);

export const deleteEsfLicense = (bin: string) =>
	api.delete<{ success: boolean }>(`/esf-licenses/${encodeURIComponent(bin)}`);
