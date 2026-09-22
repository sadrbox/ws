// ─────────────────────────────────────────────────────────────────────────────
// Кто и по какой организации пишет из 1С в служебном канале /bpai.
//
// Правило то же, что у событий 1С (services/pipeActor.js): организация ищется по
// БИН, пользователь — по имени, а чего нет — создаётся. Задача, поставленная из
// чата 1С, обязана иметь НАСТОЯЩЕГО автора: в панели её открывают, назначают,
// спрашивают «кто просил». Служебный аккаунт на всех превратил бы историю в
// «сделал робот».
//
// Пользователь создаётся с password = null — войти под ним через форму нельзя.
// Организация без БИН не создаётся: БИН — то, по чему организация 1С узнаётся в
// ERP, и выдумывать его нельзя.
// ─────────────────────────────────────────────────────────────────────────────
import { resolveOrganization, resolveUser } from "./pipeActor.js";

/** Ошибка входных данных канала: маршрут превращает её в 400/404 с этим текстом. */
export class ActorError extends Error {
	constructor(status, message) {
		super(message);
		this.status = status;
	}
}

/**
 * Организация ERP по БИН из запроса 1С.
 *
 * @param {string} bin БИН организации, выбранной в форме чата.
 * @returns {Promise<string>} uuid организации ERP.
 */
export async function organizationByBin(bin) {
	const org = await resolveOrganization({ organization: { bin, shortName: null } });
	if (!org) throw new ActorError(400, "Не указан БИН организации или он некорректен");
	return org.uuid;
}

/**
 * Автор записи — пользователь 1С. Имя приходит из сеанса 1С (полное имя или имя
 * пользователя ИБ): другого опознавательного признака 1С не шлёт, и оно же
 * показывается в панели.
 *
 * @param {{name?: string}|undefined} user
 * @returns {Promise<{uuid: string, name: string}>}
 */
export async function authorFrom(user) {
	const name = typeof user?.name === "string" ? user.name.trim() : "";
	if (!name) throw new ActorError(400, "Не указан пользователь 1С");
	const found = await resolveUser({ user: { name } });
	if (!found) throw new ActorError(400, "Не указан пользователь 1С");
	return { uuid: found.uuid, name };
}

/** Организация и автор разом — их называет каждый запрос канала. */
export async function resolveContext(body) {
	const organizationUuid = await organizationByBin(body?.bin);
	const author = await authorFrom(body?.user);
	return { organizationUuid, author };
}

export default { organizationByBin, authorFrom, resolveContext, ActorError };
