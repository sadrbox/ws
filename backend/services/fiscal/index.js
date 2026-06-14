// Точка входа фискальной подсистемы: выбор провайдера, генерация QR, ошибки.
import { fiscalConfig } from "./config.js";
import { stubProvider } from "./stubProvider.js";
import { kaspiProvider } from "./kaspiProvider.js";

const PROVIDERS = { stub: stubProvider, kaspi: kaspiProvider };

/** Провайдер по имени или по конфигу (FISCAL_PROVIDER). Неизвестный → stub. */
export function getFiscalProvider(name) {
	const key = String(name || fiscalConfig.provider || "stub").toLowerCase();
	return PROVIDERS[key] ?? stubProvider;
}

/**
 * QR-payload → PNG data-URL (для печати/показа чека). Best-effort: если пакет
 * `qrcode` недоступен — возвращает null (фронт покажет payload текстом/ссылкой).
 */
export async function qrToDataUrl(payload) {
	if (!payload) return null;
	try {
		const qrcode = (await import("qrcode")).default;
		return await qrcode.toDataURL(String(payload), { margin: 1, width: 240 });
	} catch {
		return null;
	}
}

export class FiscalError extends Error {
	constructor(message) {
		super(message);
		this.name = "FiscalError";
	}
}

/** FiscalError → HTTP 502 (ошибка внешнего фискального оператора). */
export function respondFiscalError(err, res) {
	if (err instanceof FiscalError) {
		res.status(502).json({ success: false, message: err.message });
		return true;
	}
	return false;
}

export { fiscalConfig };
export default { getFiscalProvider, qrToDataUrl, FiscalError, respondFiscalError, fiscalConfig };
