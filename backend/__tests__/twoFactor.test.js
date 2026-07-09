// Юнит-тесты TOTP (RFC 6238) — генерация/проверка кода на встроенном crypto.
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import { generateSecret, verifyTotp, otpauthUrl, currentToken } from "../services/twoFactor.js";

// Эталонный вектор RFC 6238 (SHA1): секрет ASCII "12345678901234567890".
// В base32 это "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ". При T=59 (counter=1) TOTP-8 = 94287082,
// 6-значный код = 287082. Проверяем через verifyTotp с подменённым временем.
const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

test("RFC 6238: код для counter=1 (T=59) = 287082", () => {
	const realNow = Date.now;
	Date.now = () => 59_000; // T=59 сек → counter=1
	try {
		assert.equal(currentToken(RFC_SECRET), "287082");
		assert.ok(verifyTotp(RFC_SECRET, "287082", 0));
	} finally {
		Date.now = realNow;
	}
});

test("generateSecret → verifyTotp round-trip текущим кодом", () => {
	const secret = generateSecret();
	assert.match(secret, /^[A-Z2-7]+$/);
	assert.ok(verifyTotp(secret, currentToken(secret)));
});

test("неверный/пустой код отклоняется", () => {
	const secret = generateSecret();
	assert.equal(verifyTotp(secret, "000000") && currentToken(secret) !== "000000" ? "maybe" : "ok", "ok");
	assert.equal(verifyTotp(secret, ""), false);
	assert.equal(verifyTotp(secret, "12345"), false); // не 6 цифр
	assert.equal(verifyTotp("", "123456"), false);
});

test("window: код предыдущего шага принимается при window=1", () => {
	const secret = generateSecret();
	assert.ok(verifyTotp(secret, currentToken(secret, -1), 1));
	// но не при window=0
	const realNow = Date.now;
	const prev = currentToken(secret, -1);
	const cur = currentToken(secret, 0);
	if (prev !== cur) assert.equal(verifyTotp(secret, prev, 0), false);
	Date.now = realNow;
});

test("otpauthUrl содержит секрет, issuer, digits/period", () => {
	const url = otpauthUrl("ABC234", "ivanov", "ERP KZ");
	assert.match(url, /^otpauth:\/\/totp\//);
	assert.match(url, /secret=ABC234/);
	assert.match(url, /issuer=ERP\+KZ/);
	assert.match(url, /digits=6/);
	assert.match(url, /period=30/);
	void crypto; // используется в реализации
});
