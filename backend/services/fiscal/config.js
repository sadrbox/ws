// Конфигурация фискальной интеграции (из окружения). Секреты — только в .env
// (gitignored). Провайдер по умолчанию — "stub" (детерминированные фейковые
// фискальные данные, НЕ юридически значимые). Для боевого Kaspi нужны
// KASPI_API_TOKEN/KASPI_TRADE_POINT_ID + согласование форматов по docs Kaspi.
import "dotenv/config";

export const fiscalConfig = {
	// "stub" | "kaspi"
	provider: (process.env.FISCAL_PROVIDER || "stub").toLowerCase(),
	kaspi: {
		apiUrl: process.env.KASPI_API_URL || "",
		apiToken: process.env.KASPI_API_TOKEN || "",
		tradePointId: process.env.KASPI_TRADE_POINT_ID || "",
	},
};

/** Боевой режим Kaspi возможен только при заданных URL+токене. */
export function kaspiConfigured() {
	return Boolean(fiscalConfig.kaspi.apiUrl && fiscalConfig.kaspi.apiToken);
}

export default fiscalConfig;
