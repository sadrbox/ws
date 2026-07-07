// Клиент интеграции с Открытыми данными eGov (рег. данные ЮЛ по БИН).
import { api } from "src/services/api/client";

export interface EgovLegalEntity {
	bin: string | null;
	name: string | null;
	registrationDate: string | null;
	address: string | null;
	oked: string | null;
	okedName: string | null;
	director: string | null;
	status: string | null;
}

const cfg = { timeout: 20_000 };

export const fetchEgovLegalEntity = (bin: string) =>
	api.get<{ success: boolean; data: EgovLegalEntity }>(`/egov/legal-entity/${bin}`, cfg);

/** Записать данные eGov в сущность (name/legalName + юр.адрес + руководитель). */
export const applyEgov = (ownerType: "organization" | "counterparty", uuid: string, bin: string) =>
	api.post<{ success: boolean; data: EgovLegalEntity; applied: { name: boolean; address: boolean; director: boolean } }>(
		"/egov/apply", { ownerType, uuid, bin }, cfg);

export interface EgovConfig { baseUrl: string; dataset: string; version: string; hasApiKey: boolean; }

/** Текущие настройки eGov (apiKey маскируется), суперадмин. */
export const getEgovConfig = () => api.get<{ success: boolean; config: EgovConfig }>("/egov/config");

/** Сохранить настройки eGov (apiKey — только если непустой). */
export const saveEgovConfig = (patch: { baseUrl?: string; dataset?: string; version?: string; apiKey?: string }) =>
	api.put<{ success: boolean }>("/egov/config", patch);
