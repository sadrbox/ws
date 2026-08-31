// P0 «Коммуникации» — верификация вебхука WhatsApp Cloud API. HEADLESS (чистые функции).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { checkVerifyRequest, checkSignature, extractEvents } from "../services/wa/webhookVerify.js";

const TOKEN = "secret-token";

test("checkVerifyRequest: валидная подписка → challenge", () => {
	const q = { "hub.mode": "subscribe", "hub.verify_token": TOKEN, "hub.challenge": "12345" };
	assert.equal(checkVerifyRequest(q, TOKEN), "12345");
});

test("checkVerifyRequest: неверный токен/mode/пустой конфиг → null", () => {
	assert.equal(checkVerifyRequest({ "hub.mode": "subscribe", "hub.verify_token": "wrong", "hub.challenge": "1" }, TOKEN), null);
	assert.equal(checkVerifyRequest({ "hub.mode": "unsubscribe", "hub.verify_token": TOKEN, "hub.challenge": "1" }, TOKEN), null);
	assert.equal(checkVerifyRequest({ "hub.mode": "subscribe", "hub.verify_token": "", "hub.challenge": "1" }, ""), null, "пустой настроенный токен → отказ");
	assert.equal(checkVerifyRequest({ "hub.mode": "subscribe", "hub.verify_token": TOKEN }, TOKEN), null, "нет challenge → отказ");
});

test("checkSignature: корректная HMAC-подпись принимается, битая — нет", () => {
	const secret = "app-secret";
	const raw = Buffer.from(JSON.stringify({ hello: "world" }));
	const good = "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
	assert.equal(checkSignature(raw, good, secret), true);
	assert.equal(checkSignature(raw, good.replace(/.$/, "0"), secret), false);
	assert.equal(checkSignature(raw, undefined, secret), false);
	assert.equal(checkSignature(raw, "md5=abc", secret), false);
});

test("checkSignature: пустой секрет → проверка выключена (этап настройки)", () => {
	assert.equal(checkSignature(Buffer.from("x"), undefined, ""), true);
});

test("extractEvents: сообщения и статусы из entry.changes; чужой object → пусто", () => {
	const body = {
		object: "whatsapp_business_account",
		entry: [{
			changes: [{
				value: {
					metadata: { phone_number_id: "111" },
					messages: [{ id: "wamid.A", from: "77021234567", type: "text", text: { body: "привет" } }],
				},
			}, {
				value: { metadata: { phone_number_id: "111" }, statuses: [{ id: "wamid.B", status: "delivered" }] },
			}],
		}],
	};
	const ev = extractEvents(body);
	assert.equal(ev.length, 2);
	assert.equal(ev[0].phoneNumberId, "111");
	assert.equal(ev[0].messages[0].id, "wamid.A");
	assert.equal(ev[1].statuses[0].status, "delivered");
	assert.deepEqual(extractEvents({ object: "page", entry: [] }), []);
	assert.deepEqual(extractEvents(null), []);
});
