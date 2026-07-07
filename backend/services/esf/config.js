// Конфигурация интеграции с ИС ЭСФ РК (электронные счета-фактуры).
// Секреты/БИН — только в .env (gitignored). По умолчанию — ТЕСТОВЫЙ контур
// (test3.esf.kgd.gov.kz:8443), боевой (esf.gov.kz:8443) включается явно через
// ESF_ENV=prod. ВАЖНО: не отлаживать на прод-контуре (реальные данные КГД).
import "dotenv/config";

// Базовые URL контуров ИС ЭСФ. Путь SOAP-сервисов — {base}/ws/api1/{Service}.
const BASES = {
	// Реальный тестовый стенд КГД (достижим, тест-сертификаты TestPass123).
	test3: "https://test3.esf.kgd.gov.kz:8443/esf-web",
	// Боевой контур — только для продакшена.
	prod: "https://esf.gov.kz:8443/esf-web",
};

const env = (process.env.ESF_ENV || "test3").toLowerCase();
// ESF_BASE_URL позволяет переопределить контур целиком (напр. локальный сервер).
const baseUrl = (process.env.ESF_BASE_URL || BASES[env] || BASES.test3).replace(/\/+$/, "");

export const esfConfig = {
	env,
	baseUrl,
	// Корень SOAP-сервисов API v1.
	apiRoot: `${baseUrl}/ws/api1`,
	// БИН предприятия (tin) — обязателен для создания сессии.
	tin: process.env.ESF_TIN || "",
	// Код проекта (необязателен; выдаётся при интеграции, иначе пусто).
	projectCode: process.env.ESF_PROJECT_CODE || "",
	// Таймаут SOAP-запроса, мс.
	timeoutMs: Number(process.env.ESF_TIMEOUT_MS || 30000),
	// Боевой ли контур (для страховочных проверок в вызывающем коде).
	isProd: env === "prod" || baseUrl.includes("esf.gov.kz:8443"),
};

/** URL конкретного SOAP-сервиса ИС ЭСФ, напр. serviceUrl("SessionService"). */
export function serviceUrl(service) {
	return `${esfConfig.apiRoot}/${service}`;
}

export default esfConfig;
