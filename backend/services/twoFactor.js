// Двухфакторная аутентификация TOTP (RFC 6238) на встроенном crypto — без внешних
// зависимостей. Совместимо с Google Authenticator / Aqua / любым TOTP-приложением.
import crypto from "crypto";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const STEP = 30; // период, сек
const DIGITS = 6;

/** Случайный секрет в base32 (по умолчанию 20 байт = 160 бит). */
export function generateSecret(bytes = 20) {
	const buf = crypto.randomBytes(bytes);
	let bits = "";
	for (const b of buf) bits += b.toString(2).padStart(8, "0");
	let out = "";
	for (let i = 0; i + 5 <= bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5), 2)];
	return out;
}

/** Декод base32 → Buffer. */
function base32Decode(secret) {
	const clean = String(secret).toUpperCase().replace(/[^A-Z2-7]/g, "");
	let bits = "";
	for (const c of clean) bits += B32.indexOf(c).toString(2).padStart(5, "0");
	const bytes = [];
	for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
	return Buffer.from(bytes);
}

/** HOTP(secret, counter) → 6-значный код. */
function hotp(secret, counter) {
	const key = base32Decode(secret);
	const msg = Buffer.alloc(8);
	msg.writeBigUInt64BE(BigInt(counter));
	const hmac = crypto.createHmac("sha1", key).update(msg).digest();
	const offset = hmac[hmac.length - 1] & 0xf;
	const bin =
		((hmac[offset] & 0x7f) << 24) |
		((hmac[offset + 1] & 0xff) << 16) |
		((hmac[offset + 2] & 0xff) << 8) |
		(hmac[offset + 3] & 0xff);
	return String(bin % 10 ** DIGITS).padStart(DIGITS, "0");
}

/**
 * Проверка TOTP-кода. window — допуск в шагах (±window) для рассинхрона часов.
 * @returns {boolean}
 */
export function verifyTotp(secret, token, window = 1) {
	if (!secret || !token) return false;
	const clean = String(token).replace(/\D/g, "");
	if (clean.length !== DIGITS) return false;
	const t = Math.floor(Date.now() / 1000 / STEP);
	for (let w = -window; w <= window; w++) {
		if (hotp(secret, t + w) === clean) return true;
	}
	return false;
}

/** otpauth:// URI для QR/ручного ввода в приложении-аутентификаторе. */
export function otpauthUrl(secret, account, issuer = "ERP KZ") {
	const label = encodeURIComponent(`${issuer}:${account || "user"}`);
	const params = new URLSearchParams({ secret, issuer, algorithm: "SHA1", digits: String(DIGITS), period: String(STEP) });
	return `otpauth://totp/${label}?${params.toString()}`;
}

/** Тестовый хелпер: текущий код для секрета (для e2e/отладки, НЕ для прод-логики). */
export function currentToken(secret, offset = 0) {
	return hotp(secret, Math.floor(Date.now() / 1000 / STEP) + offset);
}

export default { generateSecret, verifyTotp, otpauthUrl, currentToken };
