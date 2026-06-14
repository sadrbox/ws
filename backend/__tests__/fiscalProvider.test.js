// Юнит-тесты фискальной подсистемы (stub-провайдер + выбор провайдера + QR).
// Без БД и без сети: stub детерминирован; kaspi без токена делегирует в stub.
import { test } from "node:test";
import assert from "node:assert/strict";
import { getFiscalProvider, qrToDataUrl } from "../services/fiscal/index.js";
import { stubProvider } from "../services/fiscal/stubProvider.js";

test("getFiscalProvider по умолчанию → stub", () => {
	const p = getFiscalProvider();
	assert.equal(p.name, "stub");
	assert.equal(getFiscalProvider("unknown").name, "stub");
});

test("stub.createPayment → paymentId + qrPayload + payment_pending", async () => {
	const r = await stubProvider.createPayment({ amount: 5000, orderId: "order-1" });
	assert.ok(r.paymentId.startsWith("STUB-"));
	assert.match(r.qrPayload, /kaspi\.kz/);
	assert.equal(r.status, "payment_pending");
});

test("stub.getPaymentStatus → paid (сквозной happy-path)", async () => {
	assert.equal(await stubProvider.getPaymentStatus("STUB-x"), "paid");
});

test("stub.fiscalize детерминирован по (documentUuid, amount)", async () => {
	const a = await stubProvider.fiscalize({ documentUuid: "doc-1", amount: 1000 });
	const b = await stubProvider.fiscalize({ documentUuid: "doc-1", amount: 1000 });
	assert.equal(a.fiscalSign, b.fiscalSign);
	assert.equal(a.fiscalNumber, b.fiscalNumber);
	assert.ok(a.fiscalSign && a.fiscalNumber && a.qrPayload);
	// Иные входные данные → иной фискальный признак.
	const c = await stubProvider.fiscalize({ documentUuid: "doc-2", amount: 1000 });
	assert.notEqual(a.fiscalSign, c.fiscalSign);
});

test("kaspi без токена прозрачно делегирует в stub", async () => {
	const kaspi = getFiscalProvider("kaspi");
	assert.equal(kaspi.name, "kaspi");
	const pay = await kaspi.createPayment({ amount: 100, orderId: "o" }); // нет KASPI_API_TOKEN → stub
	assert.equal(pay.status, "payment_pending");
	assert.ok(pay.paymentId);
	const fz = await kaspi.fiscalize({ documentUuid: "d", amount: 100 });
	assert.ok(fz.fiscalSign && fz.fiscalNumber);
});

test("qrToDataUrl → data-URL или null (graceful fallback)", async () => {
	const url = await qrToDataUrl("https://example.kz/?i=1");
	assert.ok(url === null || url.startsWith("data:image/"));
	assert.equal(await qrToDataUrl(""), null);
});
