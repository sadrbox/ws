// Интеграция с Открытыми данными eGov (data.egov.kz) — регистрационные данные
// юридических лиц РК по БИН. Набор и ключ задаются в .env (EGOV_*): у наборов
// data.egov.kz доступ по apiKey + идентификатор набора (dataset) + версия.
// Возвращает нормализованные поля: БИН, наименование, дата регистрации,
// юр.адрес, ОКЭД, ФИО руководителя, статус. Названия полей у наборов разнятся —
// нормализуем по нескольким кандидатам.
import axios from "axios";
import "dotenv/config";
import { getSettings } from "../appSettings.js";

export class EgovError extends Error {
	constructor(message, { status } = {}) {
		super(message);
		this.name = "EgovError";
		this.httpStatus = status || 502;
	}
}

/** Ключи настроек eGov в AppSetting. */
export const EGOV_KEYS = ["egov.baseUrl", "egov.apiKey", "egov.dataset", "egov.version", "egov.timeoutMs"];

/**
 * Актуальный конфиг eGov: БД (AppSetting) с фолбэком на env. apiKey — секрет
 * (наружу не отдаём — см. роутер, там маскируется).
 */
export async function getEgovConfig() {
	const s = await getSettings(EGOV_KEYS);
	return {
		baseUrl: (s["egov.baseUrl"] || process.env.EGOV_BASE_URL || "https://data.egov.kz/api/v4").replace(/\/+$/, ""),
		apiKey: s["egov.apiKey"] || process.env.EGOV_API_KEY || "",
		dataset: s["egov.dataset"] || process.env.EGOV_DATASET || "",
		version: s["egov.version"] || process.env.EGOV_DATASET_VERSION || "v1",
		timeoutMs: Number(s["egov.timeoutMs"] || process.env.EGOV_TIMEOUT_MS || 15000),
	};
}

/** Настроена ли интеграция (есть набор+ключ). */
export async function egovConfigured() {
	const c = await getEgovConfig();
	return Boolean(c.dataset && c.apiKey);
}

/** Берёт первое непустое значение по списку кандидатов-ключей. */
function pick(obj, keys) {
	for (const k of keys) {
		const v = obj?.[k];
		if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
	}
	return null;
}

/** Нормализует запись набора eGov в единый вид. */
export function normalizeLegalEntity(rec) {
	if (!rec) return null;
	return {
		bin: pick(rec, ["bin", "biin", "xin", "BIN"]),
		name: pick(rec, ["name_ru", "nameRu", "name", "full_name", "fullName", "org_name", "name_kz"]),
		registrationDate: pick(rec, ["registration_date", "date_reg", "regdate", "reg_date", "registrationDate"]),
		address: pick(rec, ["legal_address", "address", "addr", "jur_address", "fact_address", "legalAddress"]),
		oked: pick(rec, ["oked", "oked_code", "main_oked", "okedCode", "oked_1"]),
		okedName: pick(rec, ["oked_name", "okedName", "oked_name_ru"]),
		director: pick(rec, ["director", "ceo", "head", "fio_head", "director_fio", "leader", "fio", "rukovoditel"]),
		status: pick(rec, ["status", "state", "activity_status", "statusName", "status_ru"]),
		raw: rec,
	};
}

/**
 * Запрашивает регистрационные данные ЮЛ по БИН из Открытых данных eGov.
 * @param {string} bin — 12 цифр.
 * @returns {Promise<object|null>} нормализованные данные или null (не найдено).
 */
export async function fetchLegalEntity(bin) {
	const b = (bin || "").trim();
	if (!/^\d{12}$/.test(b)) throw new EgovError("Некорректный БИН (12 цифр)", { status: 400 });
	const cfg = await getEgovConfig();
	if (!cfg.dataset || !cfg.apiKey) {
		throw new EgovError("Интеграция eGov не настроена (набор данных / apiKey)", { status: 503 });
	}
	// Формат data.egov.kz v4: source — ES-подобный запрос по набору.
	const source = JSON.stringify({ size: 1, query: { match: { bin: b } } });
	const url = `${cfg.baseUrl}/${cfg.dataset}/${cfg.version}`;
	let resp;
	try {
		resp = await axios.get(url, {
			params: { apiKey: cfg.apiKey, source },
			timeout: cfg.timeoutMs,
			validateStatus: () => true,
		});
	} catch (err) {
		throw new EgovError(`Ошибка обращения к eGov: ${err.message}`);
	}
	if (resp.status < 200 || resp.status >= 300) {
		throw new EgovError(`eGov вернул HTTP ${resp.status}`, { status: 502 });
	}
	// Ответ может быть { totalCount, items:[...] } или массивом.
	const data = resp.data;
	const items = Array.isArray(data) ? data : (data?.items || data?.hits || data?.data || []);
	const rec = items[0] || null;
	return rec ? normalizeLegalEntity(rec) : null;
}

export default { fetchLegalEntity, normalizeLegalEntity, egovConfigured, getEgovConfig, EgovError };
