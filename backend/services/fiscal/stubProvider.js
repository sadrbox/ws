// Stub-провайдер фискализации/оплаты: детерминированные ФЕЙКОВЫЕ данные для
// сквозного тестирования потока без реального оператора. НЕ юридически значимо.
// Интерфейс провайдера (все методы async):
//   createPayment({ amount, orderId, organizationUuid }) → { paymentId, qrPayload, status }
//   getPaymentStatus(paymentId) → "paid" | "payment_pending" | "failed"
//   fiscalize({ documentType, documentUuid, amount, items, organizationUuid, paymentMethod })
//       → { fiscalSign, fiscalNumber, qrPayload, fiscalDate, raw }
//   refund({ paymentId, amount }) → { status, raw }
import crypto from "node:crypto";

const digits = (input, len) => {
	const h = crypto.createHash("sha256").update(String(input)).digest("hex");
	// Превращаем hex в десятичную строку фиксированной длины (стабильно по input).
	let n = BigInt("0x" + h.slice(0, 16));
	const mod = 10n ** BigInt(len);
	return (n % mod).toString().padStart(len, "0");
};

export const stubProvider = {
	name: "stub",

	async createPayment({ amount, orderId }) {
		const paymentId = `STUB-${digits(orderId, 12)}`;
		// Имитация платёжной ссылки Kaspi QR.
		const qrPayload = `https://pay.kaspi.kz/pay/${paymentId}?amount=${Number(amount) || 0}`;
		return { paymentId, qrPayload, status: "payment_pending" };
	},

	// Stub считает любой платёж оплаченным (сквозной happy-path).
	async getPaymentStatus(_paymentId) {
		return "paid";
	},

	async fiscalize({ documentUuid, amount }) {
		const fiscalNumber = digits(documentUuid, 10);
		const fiscalSign = digits(`${documentUuid}:${amount}`, 16); // имитация ФП
		// Имитация QR проверки чека (формат «потребительского» QR КГД РК).
		const qrPayload = `https://consumer.oofd.kz/consumer?i=${fiscalNumber}&f=${fiscalSign}&s=${Number(amount) || 0}`;
		return {
			fiscalSign,
			fiscalNumber,
			qrPayload,
			fiscalDate: new Date(),
			raw: { provider: "stub", note: "Фейковый фискальный чек (тест)" },
		};
	},

	async refund({ paymentId, amount }) {
		return { status: "refunded", raw: { provider: "stub", paymentId, amount } };
	},
};

export default stubProvider;
