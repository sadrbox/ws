// ─────────────────────────────────────────────────────────────────────────────
// Кто прислал событие 1С: организация и пользователь — как ССЫЛКИ на объекты системы.
//
// Раньше событие хранило только ИМЕНА («Наша организация», «support»). Строка — не
// ссылка: по ней нельзя открыть карточку, нельзя связать события с организацией, и
// при переименовании связь теряется. Теперь по данным события находим реальные
// объекты, а если их нет — создаём.
//
// Организация ищется по БИН: имя может писаться как угодно, БИН — нет. Без БИН
// организацию НЕ создаём: она обязана его иметь (по нему определяется адресат
// событий), а выдумывать его нельзя.
//
// Пользователь ищется по имени (1С другого идентификатора не шлёт). Создаётся с
// password = null — войти под таким аккаунтом через форму нельзя, он существует
// только чтобы у события был автор.
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "../prisma/prisma-client.js";

const clean = (v) => {
	const s = typeof v === "string" ? v.trim() : "";
	return s === "" ? null : s;
};

/** БИН 1С может прислать с пробелами/дефисами — приводим к 12 цифрам. */
const normalizeBin = (v) => {
	const digits = String(v ?? "").replace(/\D/g, "");
	return /^\d{12}$/.test(digits) ? digits : null;
};

/**
 * Организация-отправитель: найти по БИН, при отсутствии — создать.
 * @returns {Promise<{uuid: string, created: boolean}|null>} null — БИН не пришёл.
 */
export async function resolveOrganization(body) {
	const bin = normalizeBin(body?.organization?.bin);
	if (!bin) return null; // без БИН организацию не создаём — он обязателен

	const existing = await prisma.organization.findUnique({ where: { bin }, select: { uuid: true } });
	if (existing) return { uuid: existing.uuid, created: false };

	const name = clean(body?.organization?.shortName) ?? `Организация ${bin}`;
	const created = await prisma.organization.create({
		data: { bin, name, externalSource: "1C", externalId: bin },
		select: { uuid: true },
	});
	return { uuid: created.uuid, created: true };
}

/**
 * Пользователь-автор события: найти по имени, при отсутствии — создать.
 * @returns {Promise<{uuid: string, created: boolean}|null>} null — имя не пришло.
 */
export async function resolveUser(body) {
	const username = clean(body?.user?.userName) ?? clean(body?.user?.name);
	if (!username) return null;

	const existing = await prisma.user.findFirst({ where: { username }, select: { uuid: true } });
	if (existing) return { uuid: existing.uuid, created: false };

	// password = null → под этим аккаунтом нельзя войти: он лишь «автор» событий 1С.
	const created = await prisma.user.create({
		data: { username, password: null },
		select: { uuid: true },
	});
	return { uuid: created.uuid, created: true };
}

/** Обе ссылки разом. Сбой резолва НЕ должен ронять приём события — отсюда catch. */
export async function resolveActors(body) {
	const [org, user] = await Promise.all([
		resolveOrganization(body).catch(() => null),
		resolveUser(body).catch(() => null),
	]);
	return { organizationUuid: org?.uuid ?? null, userUuid: user?.uuid ?? null };
}

export default { resolveOrganization, resolveUser, resolveActors };
