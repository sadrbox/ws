// Kaspi-провайдер (оплата по QR + фискализация).
//
// ВАЖНО: реальный API Kaspi проприетарный (по договору мерчанта). Точные
// эндпоинты, имена полей запроса/ответа и схема подписи ДОЛЖНЫ быть сверены с
// официальной документацией Kaspi — ниже это помечено `TODO(kaspi-docs)`. Пока
// не задан KASPI_API_TOKEN/URL — провайдер прозрачно делегирует в stub, чтобы
// поток работал в разработке. Подключение боевого режима = заполнить .env +
// уточнить тела запросов/парсинг ответов по docs (не выдумывать поля как истинные).
import { fiscalConfig, kaspiConfigured } from "./config.js";
import { stubProvider } from "./stubProvider.js";

const { kaspi } = fiscalConfig;

let warned = false;
function stubFallback(method, args) {
	if (!warned) {
		console.warn("[fiscal] Kaspi не сконфигурирован (нет KASPI_API_URL/KASPI_API_TOKEN) — stub-режим.");
		warned = true;
	}
	return stubProvider[method](args);
}

// Базовый HTTP-вызов к Kaspi (структура; конкретику — по docs Kaspi).
async function kaspiFetch(path, body) {
	const res = await fetch(`${kaspi.apiUrl}${path}`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			// TODO(kaspi-docs): схема авторизации (Bearer/Api-Key/подпись) — по docs.
			Authorization: `Bearer ${kaspi.apiToken}`,
		},
		body: JSON.stringify(body),
	});
	if (!res.ok) {
		const text = await res.text().catch(() => "");
		throw new Error(`Kaspi API ${res.status}: ${text || res.statusText}`);
	}
	return res.json();
}

export const kaspiProvider = {
	name: "kaspi",

	async createPayment(args) {
		if (!kaspiConfigured()) return stubFallback("createPayment", args);
		// TODO(kaspi-docs): реальный эндпоинт создания QR-платежа и поля ответа.
		const data = await kaspiFetch("/payments", {
			TradePointId: kaspi.tradePointId,
			Amount: Number(args.amount) || 0,
			OrderId: args.orderId,
		});
		return {
			paymentId: data.paymentId ?? data.id ?? "",
			qrPayload: data.qrCodeUrl ?? data.qr ?? "",
			status: "payment_pending",
		};
	},

	async getPaymentStatus(paymentId) {
		if (!kaspiConfigured()) return stubFallback("getPaymentStatus", paymentId);
		// TODO(kaspi-docs): эндпоинт статуса и маппинг значений → paid|payment_pending|failed.
		const data = await kaspiFetch(`/payments/${encodeURIComponent(paymentId)}/status`, {});
		const s = String(data.status ?? "").toLowerCase();
		if (s.includes("paid") || s.includes("success")) return "paid";
		if (s.includes("fail") || s.includes("cancel")) return "failed";
		return "payment_pending";
	},

	async fiscalize(args) {
		if (!kaspiConfigured()) return stubFallback("fiscalize", args);
		// TODO(kaspi-docs): эндпоинт фискализации, состав чека (позиции/НДС), поля ответа
		// (фискальный признак, номер, QR проверки) — сверить с docs Kaspi/ОФД.
		const data = await kaspiFetch("/fiscal/receipts", {
			TradePointId: kaspi.tradePointId,
			Amount: Number(args.amount) || 0,
			PaymentType: args.paymentMethod,
			Items: (args.items ?? []).map((it) => ({
				Name: it.name,
				Quantity: Number(it.quantity) || 0,
				Price: Number(it.price) || 0,
			})),
		});
		return {
			fiscalSign: data.fiscalSign ?? data.fp ?? "",
			fiscalNumber: data.fiscalNumber ?? data.number ?? "",
			qrPayload: data.qrCodeUrl ?? data.qr ?? "",
			fiscalDate: data.date ? new Date(data.date) : new Date(),
			raw: data,
		};
	},

	async refund(args) {
		if (!kaspiConfigured()) return stubFallback("refund", args);
		// TODO(kaspi-docs): эндпоинт возврата/сторно чека.
		const data = await kaspiFetch("/fiscal/refunds", {
			TradePointId: kaspi.tradePointId,
			PaymentId: args.paymentId,
			Amount: Number(args.amount) || 0,
		});
		return { status: "refunded", raw: data };
	},
};

export default kaspiProvider;
