// Telegram-бот уведомлений (E17 СК0.4).
//
// Зачем: SLA и эскалация бессмысленны, если о них узнаёт только тот, кто сидит в ERP. Бот
// шлёт личные уведомления тем, кто привязал Telegram: пользователь открывает ссылку
// t.me/<бот>?start=<код>, бот получает /start <код> и запоминает chat_id.
//
// Приём сообщений — опросом getUpdates из планировщика (не вебхуком): вебхук требует
// публичного адреса и сертификата, а опрос работает из-за туннеля как есть.
//
// ПРОВЕРИТЬ ПОТОМ: токен бота (TELEGRAM_BOT_TOKEN) и его имя (TELEGRAM_BOT_NAME) не заданы —
// без них всё здесь молча выключено; нужен исходящий доступ сервера к api.telegram.org.
import crypto from "node:crypto";
import { prisma } from "../../prisma/prisma-client.js";
import { getSetting, setSetting } from "../appSettings.js";

const API = "https://api.telegram.org";
const OFFSET_KEY = "telegram.updatesOffset";
const TIMEOUT_MS = 10_000;

const token = () => String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
export const botName = () => String(process.env.TELEGRAM_BOT_NAME || "").trim().replace(/^@/, "");
export const telegramEnabled = () => !!token();

async function call(method, body) {
	const ctl = new AbortController();
	const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
	try {
		const res = await fetch(`${API}/bot${token()}/${method}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body || {}),
			signal: ctl.signal,
		});
		const data = await res.json().catch(() => ({}));
		if (!res.ok || data.ok === false) throw new Error(`Telegram ${method}: ${data.description || res.status}`);
		return data.result;
	} finally {
		clearTimeout(t);
	}
}

/** Отправить текст в чат. Ошибки не бросает: уведомление не должно ронять правило. */
export async function sendTelegram(chatId, text) {
	if (!telegramEnabled() || !chatId) return false;
	try {
		await call("sendMessage", { chat_id: chatId, text: String(text).slice(0, 4000), disable_web_page_preview: true });
		return true;
	} catch (e) {
		console.warn("[telegram] sendMessage:", e.message);
		return false;
	}
}

export async function sendTelegramToUser(userUuid, text) {
	if (!telegramEnabled() || !userUuid) return false;
	const link = await prisma.userTelegramLink.findUnique({ where: { userUuid }, select: { chatId: true } });
	return link?.chatId ? sendTelegram(link.chatId, text) : false;
}

/** Состояние привязки для экрана пользователя. */
export async function telegramStatus(userUuid) {
	const link = await prisma.userTelegramLink.findUnique({ where: { userUuid } });
	return { enabled: telegramEnabled(), botName: botName() || null, linked: !!link?.chatId, linkedAt: link?.linkedAt ?? null };
}

/** Одноразовый код привязки и ссылка на бота. */
export async function createLinkCode(userUuid) {
	const code = crypto.randomBytes(12).toString("hex");
	await prisma.userTelegramLink.upsert({
		where: { userUuid },
		create: { userUuid, linkCode: code },
		update: { linkCode: code },
	});
	const name = botName();
	return { code, url: name ? `https://t.me/${name}?start=${code}` : null, botName: name || null, enabled: telegramEnabled() };
}

export async function unlinkTelegram(userUuid) {
	await prisma.userTelegramLink.deleteMany({ where: { userUuid } });
}

/**
 * Разобрать входящие сообщения: /start <код> привязывает чат к пользователю.
 * Вызывается планировщиком раз в 30 с (под кластерной блокировкой — один процесс за раз).
 */
export async function pollTelegramUpdates() {
	if (!telegramEnabled()) return "telegram: выключен";
	const offset = Number(await getSetting(OFFSET_KEY)) || 0;
	const updates = await call("getUpdates", { offset, timeout: 0, allowed_updates: ["message"] });
	let linked = 0;
	let last = offset;
	for (const u of updates || []) {
		last = Math.max(last, Number(u.update_id) + 1);
		const text = String(u.message?.text || "").trim();
		const chatId = u.message?.chat?.id;
		const m = /^\/start\s+([a-f0-9]{24})$/i.exec(text);
		if (!m || !chatId) continue;
		const link = await prisma.userTelegramLink.findUnique({ where: { linkCode: m[1] } });
		if (!link) {
			await sendTelegram(chatId, "Код привязки не найден или устарел. Получите новую ссылку в ERP: «Качество → Мои уведомления».");
			continue;
		}
		await prisma.userTelegramLink.update({ where: { uuid: link.uuid }, data: { chatId: String(chatId), linkCode: null, linkedAt: new Date() } });
		await sendTelegram(chatId, "Готово: уведомления ERP о задачах и сроках будут приходить сюда.");
		linked++;
	}
	if (last !== offset) await setSetting(OFFSET_KEY, String(last));
	return linked ? `telegram: привязано ${linked}` : undefined;
}

export default { telegramEnabled, botName, sendTelegram, sendTelegramToUser, telegramStatus, createLinkCode, unlinkTelegram, pollTelegramUpdates };
