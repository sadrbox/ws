/**
 * ЭХО СОСТОЯНИЯ: изменяющая команда приносит новое содержимое базы своим же ответом.
 *
 * ЗАЧЕМ. Изменение выполняется в открытом COM-соединении, и прочитать в нём список сразу
 * после записи стоит миллисекунды. Прежде за каждым изменением сервис ставил ВТОРУЮ команду
 * (`REFRESH_AFTER`) — это новый вход в базу: коннектор, аутентификация, сеанс и лицензия 1С,
 * от секунды до трёх до начала полезной работы, плюс ожидание в очереди. На групповой
 * операции по ста десяти базам таких входов набиралось сто десять лишних.
 *
 * ЧТО ЗДЕСЬ. Разбор поля `state` из ответа агента и правило, по которому его можно принять.
 * Правило одно и жёсткое: `complete: true` — обещание, что список ПОЛНЫЙ, потому что реестр
 * замещается им целиком. Частичный список молча «потеряет» пользователей, которых в нём не
 * было, и сводка «в каких базах есть Иванов» начнёт врать.
 *
 * Спецификация: docs/TASK_FRESH_STATE_AFTER_COMMAND.md, способность агента — `ib.echo`.
 */
import type { IbExtension, IbUser } from "./registry.ts";
import { listItems } from "./listShape.ts";

/** Списки, которые можно применить к реестру прямо сейчас. */
export type EchoState = {
	users?: IbUser[];
	extensions?: IbExtension[];
};

export type Echo = {
	state: EchoState;
	/**
	 * Ответ БЕЗ применённых списков — он и ложится в командную запись.
	 *
	 * Применённое в журнале не хранится: задание на сто баз положило бы в БД сто списков
	 * пользователей, которые никто никогда не прочитает, — а в реестре они уже есть.
	 * Остальное из `state` (сеансы, соединения) остаётся: реестра для него нет, и панель
	 * читает его из результата команды.
	 */
	result: unknown;
};

const isObject = (v: unknown): v is Record<string, unknown> =>
	typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Один список из `state`. Возвращает `null`, если принимать его нельзя, — и тогда сервис
 * ведёт себя как раньше: ставит читающую команду.
 *
 * Строгость намеренная. Ошибка здесь не видна ни агенту, ни человеку: реестр просто
 * разойдётся с базой, и узнают об этом через неделю по «пользователь пропал из сводки».
 */
function takeList<T>(raw: unknown, pick: (item: Record<string, unknown>) => T | null): T[] | null {
	if (!isObject(raw)) return null;
	// Обещание полноты — единственный способ отличить «вот весь список» от «вот что
	// успелось». Без него не применяем ничего.
	if (raw.complete !== true) return null;
	// Форму списка разбираем тем же кодом, что и обычные `IB_LIST_*`: сборка агента умеет
	// заворачивать список в лишний массив (см. onec/listShape.ts), и эхо от этого страдает
	// так же — с той разницей, что здесь неразобранная форма просто не применяется.
	const shape = listItems(raw);
	if (!shape) return null;

	const out: T[] = [];
	for (const item of shape.items) {
		if (!isObject(item)) return null;
		const one = pick(item);
		// Строка без имени — признак сломанного чтения, а не пустого места. Применять
		// список целиком нельзя: в реестре останутся только те, кого удалось разобрать,
		// а остальных сервис сочтёт удалёнными из базы.
		if (one === null) return null;
		out.push(one);
	}
	// Пустой список законен: у базы может не быть ни одного расширения, и после удаления
	// последнего именно это и приходит.
	return out;
}

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const bool = (v: unknown): boolean | undefined => (typeof v === "boolean" ? v : undefined);

function pickUser(o: Record<string, unknown>): IbUser | null {
	const name = typeof o.name === "string" ? o.name.trim() : "";
	if (!name) return null;
	return {
		name,
		fullName: str(o.fullName),
		disabled: bool(o.disabled),
		roles: Array.isArray(o.roles) ? o.roles.filter((r): r is string => typeof r === "string") : undefined,
		// Трёхзначно, как и в списке пользователей: отсутствие поля — «агент не сообщил».
		showInList: o.showInList === null ? null : bool(o.showInList),
	};
}

function pickExtension(o: Record<string, unknown>): IbExtension | null {
	const name = typeof o.name === "string" ? o.name.trim() : "";
	if (!name) return null;
	return {
		name,
		synonym: str(o.synonym) ?? null,
		version: str(o.version) ?? null,
		purpose: str(o.purpose) ?? null,
		safeMode: bool(o.safeMode) ?? null,
	};
}

/**
 * Разобрать ответ команды: что из него применимо к реестру и что останется в записи.
 *
 * `null` — эха нет (старый агент, неудавшееся перечитывание, чужая форма ответа). Тогда всё
 * работает как прежде: сервис ставит читающую команду, панель обновляется с задержкой.
 */
export function parseEcho(result: unknown): Echo | null {
	if (!isObject(result) || !isObject(result.state)) return null;
	const raw = result.state;

	const users = "users" in raw ? takeList(raw.users, pickUser) : null;
	const extensions = "extensions" in raw ? takeList(raw.extensions, pickExtension) : null;
	if (!users && !extensions) return null;

	// Из ответа вырезаем ТОЛЬКО применённое; остальное (сеансы, соединения, заметки агента)
	// остаётся на месте — его негде взять, кроме как из результата команды.
	const rest: Record<string, unknown> = { ...raw };
	if (users) delete rest.users;
	if (extensions) delete rest.extensions;

	const trimmed: Record<string, unknown> = { ...result };
	if (Object.keys(rest).length) trimmed.state = rest;
	else delete trimmed.state;

	return {
		state: { ...(users ? { users } : {}), ...(extensions ? { extensions } : {}) },
		result: trimmed,
	};
}

/**
 * СДЕЛАЛ ЛИ АГЕНТ ТО, ЧТО ЕМУ СКАЗАЛИ — по его же эху.
 *
 * ЖИВОЙ СЛУЧАЙ (12.09, вечер). Правка ролей в карточке пользователя базы «не сохранялась».
 * Журнал команд показал, почему: `IB_UPDATE_USER` с `addRoles: ["АдминистраторСистемы",
 * "Администрирование"]` завершалась `{"ok": true}`, а в приложенном к ней же списке
 * пользователей роли оставались прежними. Роли существуют в этой базе (они выданы другому
 * её пользователю), имя пользователя верное — агент просто не применил поля `addRoles` и
 * `removeRoles`, хотя контракт их описывает (`ONEC_AGENT_CLUSTER_CONTRACT.md` §5).
 *
 * ПОЧЕМУ ПРОВЕРЯЕТ СЕРВИС. Команда, доложившая об успехе и ничего не сделавшая, — худший
 * вид отказа: панель показывает «Выполнено», человек уходит, а права остались прежними;
 * узнают об этом от того, кому они были нужны. Эхо даёт возможность сличить намерение с
 * результатом в тот же миг — и сказать правду, не дожидаясь жалобы.
 *
 * ПРОВЕРЯЕМ ТОЛЬКО РОЛИ. Полное имя и признак отключения эхо тоже приносит, но их читает
 * `IB_LIST_USERS`, и расхождение видно в самой таблице. Роли же — это доступ, и молчаливый
 * отказ в нём дороже всего.
 */
export type RoleVerdict =
	| { ok: true }
	/** Что не сошлось: роли, которые просили выдать, но их нет, и снятые, но оставшиеся. */
	| {
		ok: false; notAdded: string[]; notRemoved: string[];
		/**
		 * Просили ПУСТОЙ полный набор — «снять все роли». Отдельный признак, потому что и
		 * отказ здесь отдельный: не «часть ролей не легла», а «команда снятия всех прав
		 * целиком не применилась» (живой случай 13.09, сборка агента 23:48).
		 */
		emptySet?: boolean;
	};

/** Сравнение имён ролей — как их присылает 1С: без учёта регистра и краевых пробелов. */
const norm = (s: string) => s.trim().toLowerCase();

export function checkRoleIntent(
	payload: Record<string, unknown>, users: IbUser[],
): RoleVerdict {
	const add = Array.isArray(payload.addRoles) ? payload.addRoles.filter((r): r is string => typeof r === "string") : [];
	const remove = Array.isArray(payload.removeRoles) ? payload.removeRoles.filter((r): r is string => typeof r === "string") : [];
	const whole = Array.isArray(payload.roles) ? payload.roles.filter((r): r is string => typeof r === "string") : null;
	if (!add.length && !remove.length && !whole) return { ok: true };

	// Пользователя ищем по НОВОМУ имени, если команда его переименовывала: под прежним
	// его в базе уже нет, и «не нашли» означало бы ложный отказ.
	const wanted = typeof payload.newName === "string" && payload.newName.trim()
		? payload.newName.trim()
		: typeof payload.name === "string" ? payload.name : "";
	const found = users.find((u) => norm(u.name) === norm(wanted));
	// Пользователя в эхе нет вовсе — судить не о чем: список может быть не о том (чужая
	// база, пересозданный пользователь). Молчим, а не объявляем отказ по догадке.
	if (!found || !Array.isArray(found.roles)) return { ok: true };

	const have = new Set(found.roles.map(norm));
	const notAdded = add.filter((r) => !have.has(norm(r)));
	const notRemoved = remove.filter((r) => have.has(norm(r)));
	// Полный набор: его проверяем как «ровно то, что просили» — лишнее тоже отказ, иначе
	// «привести к эталону» могло бы оставить роль, которую велено было снять.
	if (whole) {
		const want = new Set(whole.map(norm));
		// Лишние роли называем ТАК, КАК ИХ ОТДАЛА 1С («ПолныеПрава»), а не нормализованными
		// («полныеправа»): сравнение без регистра — внутренняя кухня, а человеку нужно имя,
		// которое он найдёт в конфигураторе.
		const extra = found.roles.filter((r) => !want.has(norm(r)));
		const lost = whole.filter((r) => !have.has(norm(r)));
		if (extra.length || lost.length) {
			return { ok: false, notAdded: lost, notRemoved: extra, emptySet: whole.length === 0 };
		}
	}
	if (notAdded.length || notRemoved.length) return { ok: false, notAdded, notRemoved };
	return { ok: true };
}

/** Отказ словами — он уходит в панель как ошибка команды. */
/**
 * «ПОКАЗЫВАТЬ В СПИСКЕ ВЫБОРА» — СВЕРКА ЗАПИСАННОГО С ПРОЧИТАННЫМ (S1, TASK_SERVICE_SHOW_IN_LIST.md).
 *
 * Агент до 12:46 писал признак молча: платформа не приняла — команда всё равно «Выполнено», а
 * эхо приносило прежнее значение, и тумблер в панели возвращался назад без объяснений. Как и у
 * ролей: признак в эхе есть и не равен записанному — это отказ, а не успех. Поля в эхе нет
 * (сборка его не читает) или пользователя в эхе нет — судить не о чем, молчим.
 */
export type ShowInListVerdict = { ok: true } | { ok: false; name: string; wanted: boolean; actual: boolean };

export function checkShowInListIntent(payload: Record<string, unknown>, users: IbUser[]): ShowInListVerdict {
	if (typeof payload.showInList !== "boolean") return { ok: true };
	const wantedName = typeof payload.newName === "string" && payload.newName.trim()
		? payload.newName.trim()
		: typeof payload.name === "string" ? payload.name : "";
	const found = users.find((u) => norm(u.name) === norm(wantedName));
	if (!found || typeof found.showInList !== "boolean") return { ok: true };
	return found.showInList === payload.showInList
		? { ok: true }
		: { ok: false, name: found.name, wanted: payload.showInList, actual: found.showInList };
}

export function showInListVerdictMessage(v: Extract<ShowInListVerdict, { ok: false }>): string {
	const yn = (b: boolean) => (b ? "да" : "нет");
	return `Признак «Показывать в списке выбора» не сохранился: записано «${yn(v.wanted)}», в базе «${yn(v.actual)}».`
		+ " Остальные реквизиты команды могли примениться. Если повторная запись не помогает — значение"
		+ " не сохраняет сама база: проверьте флажок в Конфигураторе (Администрирование → Пользователи).";
}

export function roleVerdictMessage(v: Extract<RoleVerdict, { ok: false }>): string {
	/*
	 * СПИСОК РОЛЕЙ — С ПРЕДЕЛОМ. Живой случай 13.09: отказ перечислял все 331 роль
	 * пользователя строчными буквами, одной строкой на экран. Прочитать такое нельзя, а
	 * нужное в нём — число и несколько имён для примера. Полный список остаётся в `details`
	 * отказа и в журнале сервиса.
	 */
	const SHOW = 10;
	const list = (names: string[]) => names.length > SHOW
		? `${names.slice(0, SHOW).join(", ")} и ещё ${names.length - SHOW}`
		: names.join(", ");

	if (v.emptySet) {
		return `Агент сообщил об успехе, но роли не сняты: у пользователя осталось ${v.notRemoved.length}`
			+ ` (${list(v.notRemoved)}). Команду «снять все роли» (пустой набор) эта сборка агента`
			+ " не применяет — права остались прежними. Остальные реквизиты команды могли примениться.";
	}
	const parts: string[] = [];
	if (v.notAdded.length) parts.push(`не выданы ${v.notAdded.length}: ${list(v.notAdded)}`);
	if (v.notRemoved.length) parts.push(`не сняты ${v.notRemoved.length}: ${list(v.notRemoved)}`);
	return `Агент сообщил об успехе, но роли в базе не изменились (${parts.join("; ")}).`
		+ " Команда выполнена лишь частично: остальные реквизиты могли примениться.";
}
