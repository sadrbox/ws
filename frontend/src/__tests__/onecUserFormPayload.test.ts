/**
 * Карточка пользователя базы: что уходит в команду, а что нет.
 *
 * ЖИВОЙ СЛУЧАЙ (12.09). «Показывать в списке выбора» не сохранялось: переключение не
 * считалось изменением, и «Применить» не делало ничего. Хуже другое — при любой ДРУГОЙ
 * правке это поле уходило в 1С со значением «включено», которое форма выдумала: прочитать
 * текущее неоткуда (в ответе IB_LIST_USERS этого признака нет). То есть правка полного
 * имени молча включала показ в списке тому, у кого он был выключен.
 *
 * Правило, которое держит тест: В КОМАНДУ УХОДИТ ТОЛЬКО ИЗМЕНЁННОЕ, а поле, значения
 * которого мы не знаем, стоит в положении «не менять» и не уходит вовсе.
 */
import { describe, it, expect } from "vitest";
import {
	MASS_ROLES, applyRoleChanges, buildGroupUserUpdate, buildSavePlan, buildUserUpdate, diffRoles, massRoleChange, rebaseForm, roleCatalog,
} from "src/models/OneCAdmin/userUpdate";

const current = { fullName: "Оператор бухгалтер", disabled: false, showInList: null as boolean | null };
const draft = (over: Partial<Parameters<typeof buildUserUpdate>[2]> = {}) => ({
	name: "Оператор", fullName: "Оператор бухгалтер", password: "", disabled: false,
	showInList: null as boolean | null, ...over,
});

describe("правка пользователя базы: только изменённое", () => {
	it("ничего не трогали — команды нет вовсе", () => {
		expect(buildUserUpdate("Оператор", current, draft())).toBeNull();
	});

	it("«показывать в списке» уходит, когда его выбрали", () => {
		expect(buildUserUpdate("Оператор", current, draft({ showInList: false })))
			.toEqual({ name: "Оператор", showInList: false });
	});

	it("«не менять» не уходит НИКОГДА — даже вместе с другой правкой", () => {
		// Главная защита: выдуманное значение не должно попасть в 1С заодно с настоящим.
		const cmd = buildUserUpdate("Оператор", current, draft({ fullName: "Оператор-кассир" }));
		expect(cmd).toEqual({ name: "Оператор", fullName: "Оператор-кассир" });
		expect(cmd && "showInList" in cmd).toBe(false);
	});

	it("прежнее полное имя обратно не отправляется", () => {
		// Поле теперь показывает то, что есть в базе: без сравнения с исходным оно уходило
		// бы в команду при каждом сохранении.
		expect(buildUserUpdate("Оператор", current, draft({ disabled: true })))
			.toEqual({ name: "Оператор", disabled: true });
	});

	it("переименование идёт отдельным полем, а имя остаётся адресом", () => {
		expect(buildUserUpdate("Оператор", current, draft({ name: "Кассир" })))
			.toEqual({ name: "Оператор", newName: "Кассир" });
	});

	it("пароль уходит только введённый — прочитать его неоткуда", () => {
		expect(buildUserUpdate("Оператор", current, draft({ password: "s3cret" })))
			.toEqual({ name: "Оператор", password: "s3cret" });
	});

	it("когда значение известно, повтор того же выбора изменением не считается", () => {
		// Сервис уже умеет хранить признак (миграция 019); как только агент начнёт его
		// отдавать, форма покажет его как факт — и не будет слать «то же самое».
		const known = { ...current, showInList: true };
		expect(buildUserUpdate("Оператор", known, draft({ showInList: true }))).toBeNull();
		expect(buildUserUpdate("Оператор", known, draft({ showInList: false })))
			.toEqual({ name: "Оператор", showInList: false });
	});
});

/**
 * Куда уходит правка — и куда не уходит.
 *
 * ЖИВОЙ СЛУЧАЙ (12.09, вечер). Переключение «Отключен» или «Показывать в списке выбора» в
 * карточке пользователя базы отвечало двумя сообщениями подряд: «Пропущены базы, где этого
 * пользователя нет: _transition» и «Задание поставлено: 0». То есть правка не применялась
 * вовсе — отсев чужих баз съедал СОБСТВЕННУЮ базу карточки, потому что сводка реестра «в
 * каких базах есть этот человек» ещё не знала о нём (у только что созданного пользователя
 * она пуста).
 */
describe("план записи: база карточки не отсеивается", () => {
	const roles = () => new Map<string, { add: string[]; remove: string[] }>();

	it("сводка реестра пуста — правка всё равно уходит в базу карточки", () => {
		const { plan, skipped } = buildSavePlan({
			baseKey: "_transition", userName: "Оператор",
			profileUpdate: { name: "Оператор", disabled: true },
			rolesByBase: roles(), knownBases: [],
		});
		expect(skipped).toEqual([]);
		expect([...plan.keys()]).toEqual(["_transition"]);
		expect(plan.get("_transition")).toEqual({ name: "Оператор", disabled: true });
	});

	it("чужая база, где человека нет, по-прежнему отсеивается", () => {
		const r = roles();
		r.set("almaz67", { add: ["Бухгалтер"], remove: [] });
		const { plan, skipped } = buildSavePlan({
			baseKey: "_transition", userName: "Оператор",
			profileUpdate: { name: "Оператор", showInList: false },
			rolesByBase: r, knownBases: ["_transition"],
		});
		expect(skipped).toEqual(["almaz67"]);
		expect([...plan.keys()]).toEqual(["_transition"]);
	});

	it("чужая база, где человек есть, получает свою команду", () => {
		const r = roles();
		r.set("almaz67", { add: ["Бухгалтер"], remove: ["Кассир"] });
		const { plan, skipped } = buildSavePlan({
			baseKey: "_transition", userName: "Оператор",
			profileUpdate: null, rolesByBase: r, knownBases: ["_transition", "AlmaZ67"],
		});
		expect(skipped).toEqual([]);
		expect(plan.get("almaz67")).toEqual({ name: "Оператор", addRoles: ["Бухгалтер"], removeRoles: ["Кассир"] });
	});

	it("роли и реквизиты одной базы — ОДНА команда, и база названа как в карточке", () => {
		// Черновик ролей хранит ключ базы в нижнем регистре, а команда адресует базу так,
		// как она названа: иначе агент искал бы «akacapital» вместо «AkaCapital».
		const r = roles();
		r.set("akacapital", { add: ["Бухгалтер"], remove: [] });
		const { plan } = buildSavePlan({
			baseKey: "AkaCapital", userName: "Оператор",
			profileUpdate: { name: "Оператор", disabled: true },
			rolesByBase: r, knownBases: [],
		});
		expect([...plan.keys()]).toEqual(["AkaCapital"]);
		expect(plan.get("AkaCapital")).toEqual({ name: "Оператор", disabled: true, addRoles: ["Бухгалтер"] });
	});

	it("менять нечего — плана нет, и «поставлено: 0» показывать незачем", () => {
		const { plan, skipped } = buildSavePlan({
			baseKey: "_transition", userName: "Оператор",
			profileUpdate: null, rolesByBase: roles(), knownBases: ["_transition"],
		});
		expect(plan.size).toBe(0);
		expect(skipped).toEqual([]);
	});
});

/**
 * Роли своей базы уходят ПОЛНЫМ НАБОРОМ, когда его есть от чего считать.
 *
 * ПОЧЕМУ ТАК. Сборка агента не применяет поправки `addRoles`/`removeRoles`: отвечает успехом
 * и не меняет ничего (поймано 12.09 по эху команды). Полный набор `roles` — второй способ
 * того же контракта. Но считать его по кэшу нельзя: роль, выданную в конфигураторе после
 * последнего чтения, «эталон» снял бы молча, — поэтому набор строится по СВЕЖЕМУ чтению
 * базы, а без него правка остаётся поправками.
 */
describe("роли уходят поправками", () => {
	/*
	 * Агент `ib.roles` применяет addRoles/removeRoles сам (docs/TASK_PANEL_ROLES_WITHOUT_PREREAD.md).
	 * Полный набор `roles` панель больше не шлёт: его пришлось бы считать по чтению перед
	 * записью — лишний вход в базу и гонка с конфигуратором.
	 */
	const changes = (add: string[], remove: string[] = []) => {
		const m = new Map<string, { add: string[]; remove: string[] }>();
		m.set("_transition", { add, remove });
		return m;
	};

	it("своя база — поправки, без полного набора", () => {
		const { plan } = buildSavePlan({
			baseKey: "_transition", userName: "Оператор", profileUpdate: null,
			rolesByBase: changes(["ПолныеПрава"], ["Кассир"]), knownBases: [],
		});
		expect(plan.get("_transition")).toEqual({
			name: "Оператор", addRoles: ["ПолныеПрава"], removeRoles: ["Кассир"],
		});
	});

	it("«снять все» — поправками по видимым ролям, а не пустым набором", () => {
		// `roles: []` снял бы и роль, выданную в конфигураторе после последнего чтения.
		const { plan } = buildSavePlan({
			baseKey: "_transition", userName: "Оператор", profileUpdate: null,
			rolesByBase: changes([], ["Кассир", "БазовыеПрава"]), knownBases: [],
		});
		expect(plan.get("_transition")).toEqual({ name: "Оператор", removeRoles: ["Кассир", "БазовыеПрава"] });
	});

	it("чужие базы — тоже поправки", () => {
		const m = new Map<string, { add: string[]; remove: string[] }>();
		m.set("_transition", { add: ["ПолныеПрава"], remove: [] });
		m.set("almaz67", { add: ["Кассир"], remove: [] });
		const { plan } = buildSavePlan({
			baseKey: "_transition", userName: "Оператор", profileUpdate: null,
			rolesByBase: m, knownBases: ["_transition", "almaz67"],
		});
		expect(plan.get("_transition")).toEqual({ name: "Оператор", addRoles: ["ПолныеПрава"] });
		expect(plan.get("almaz67")).toEqual({ name: "Оператор", addRoles: ["Кассир"] });
	});

	it("реквизиты и роли одной базы — по-прежнему ОДНА команда", () => {
		const { plan } = buildSavePlan({
			baseKey: "_transition", userName: "Оператор",
			profileUpdate: { name: "Оператор", disabled: true },
			rolesByBase: changes(["ПолныеПрава"]), knownBases: [],
		});
		expect(plan.get("_transition")).toEqual({ name: "Оператор", disabled: true, addRoles: ["ПолныеПрава"] });
	});

	it("набор: прежние роли минус снятые плюс выданные, без повторов и с учётом регистра", () => {
		expect(applyRoleChanges(["Кассир", "БазовыеПрава"], { add: ["ПолныеПрава"], remove: ["кассир"] }))
			.toEqual(["БазовыеПрава", "ПолныеПрава"]);
		// Уже выданную роль не дублируем: набор уходит в 1С как есть.
		expect(applyRoleChanges(["ПолныеПрава"], { add: ["полныеправа"], remove: [] }))
			.toEqual(["ПолныеПрава"]);
		// Снять всё — законный набор: пустой массив значит «ролей нет».
		expect(applyRoleChanges(["ПолныеПрава"], { add: [], remove: ["ПолныеПрава"] })).toEqual([]);
	});
});

/**
 * Какие роли карточка вправе предлагать.
 *
 * ЖИВОЙ СЛУЧАЙ (12.09, 23:43): предлагала роли из общего справочника по всем базам, и запись
 * ролей отвергнута агентом целиком — «в базе „_transition“ нет ролей: …». Набор ролей задаёт
 * конфигурация базы, а команда уходит в одну базу.
 */
describe("справочник ролей карточки", () => {
	it("роли чужих баз не предлагаются", () => {
		const catalog = roleCatalog(["ПолныеПрава", "Кассир"], []);
		expect(catalog).toEqual(["Кассир", "ПолныеПрава"]);
		expect(catalog).not.toContain("ДобавлениеИзменениеКорректировкаПоступления");
	});

	it("выданная роль есть в списке даже если справочник о ней не знает", () => {
		// Без строки её нельзя ни увидеть, ни снять — выглядела бы отсутствующей.
		expect(roleCatalog(["Кассир"], ["РедкаяРоль"])).toEqual(["Кассир", "РедкаяРоль"]);
	});

	it("повторы (в том числе по регистру) и пустые имена отбрасываются", () => {
		// «Кассир» и «кассир» — одна роль: 1С регистр в именах не различает, а две отметки
		// предлагали бы снять одну и оставить другую. Написание — от выданного в базе.
		expect(roleCatalog(["Кассир", "Кассир", " "], ["кассир", "Бухгалтер"]))
			.toEqual(["Бухгалтер", "кассир"]);
	});
});

/**
 * Массовая правка ролей просит подтверждения.
 *
 * ЖИВОЙ СЛУЧАЙ (12–13.09): одной записью пользователю выдали все 331 роль конфигурации, а
 * утром одной записью попытались снять все. Оба действия — один щелчок по заголовку таблицы,
 * и оба меняют права человека целиком.
 */
describe("массовая правка ролей", () => {
	const roles = (n: number, prefix = "Роль") => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);

	it("снять ВСЕ роли — подтверждение, даже если ролей было немного", () => {
		const v = massRoleChange(["Кассир", "БазовыеПрава"], { add: [], remove: ["Кассир", "БазовыеПрава"] });
		expect(v).toEqual({ kind: "removeAll", privileged: [], added: 0, removed: 2, before: 2, after: 0 });
	});

	it("выдать все 331 роль разом — подтверждение", () => {
		const v = massRoleChange(roles(102), { add: roles(331), remove: [] });
		expect(v?.kind).toBe("many");
		expect(v?.added).toBe(229);
		expect(v?.after).toBe(331);
	});

	it("мелкая правка проходит без вопросов", () => {
		// Окно на каждое нажатие приучило бы нажимать «Да» не читая.
		expect(massRoleChange(roles(10), { add: ["Кассир"], remove: ["Роль1"] })).toBeNull();
	});

	it("граница — ровно MASS_ROLES изменений ещё без подтверждения", () => {
		expect(massRoleChange([], { add: roles(MASS_ROLES), remove: [] })).toBeNull();
		expect(massRoleChange([], { add: roles(MASS_ROLES + 1), remove: [] })?.kind).toBe("many");
	});

	it("пользователь без ролей — «снять все» не бывает: снимать нечего", () => {
		expect(massRoleChange([], { add: [], remove: [] })).toBeNull();
	});
});

describe("административные роли в подтверждении", () => {
	it("одна административная роль — подтверждение и её имя", () => {
		const v = massRoleChange(["Кассир"], { add: ["ПолныеПрава"], remove: [] });
		expect(v?.kind).toBe("privileged");
		expect(v?.privileged).toEqual(["ПолныеПрава"]);
	});

	it("регистр не спасает от подтверждения", () => {
		expect(massRoleChange([], { add: ["администраторсистемы"], remove: [] })?.privileged)
			.toEqual(["администраторсистемы"]);
	});

	it("роль уже выдана — не новость, подтверждать нечего", () => {
		expect(massRoleChange(["ПолныеПрава"], { add: ["ПолныеПрава", "Кассир"], remove: [] })).toBeNull();
	});

	it("массовая выдача называет административные роли среди прочих", () => {
		// Живой случай 13.09 00:10: «добавить 229», и среди них ПолныеПрава.
		const many = Array.from({ length: 30 }, (_, i) => `Роль${i}`);
		const v = massRoleChange([], { add: [...many, "ПолныеПрава", "ЗапускТолстогоКлиента"], remove: [] });
		expect(v?.kind).toBe("many");
		expect(v?.privileged).toEqual(["ПолныеПрава", "ЗапускТолстогоКлиента"]);
	});

	it("снятие административной роли подтверждения не требует", () => {
		expect(massRoleChange(["ПолныеПрава", "Кассир"], { add: [], remove: ["ПолныеПрава"] })).toBeNull();
	});
});

/**
 * Обновление данных базы не затирает изменённое в форме.
 *
 * Живой случай 14.09: переключённое «Показывать в списке выбора» пропадало до «Записать» —
 * форма сбрасывалась к данным базы при каждом перечитывании списка пользователей.
 */
describe("данные базы обновились, пока форму правят", () => {
	const base = { name: "Оператор", fullName: "Оператор бухгалтер", password: "", disabled: false, showInList: true };

	it("изменённое человеком остаётся", () => {
		const form = { ...base, showInList: false };
		// Перечитали список — значения в базе прежние, но объект новый.
		expect(rebaseForm(base, { ...base }, form).showInList).toBe(false);
	});

	it("нетронутое берёт новое значение из базы", () => {
		const form = { ...base, showInList: false };
		const next = { ...base, fullName: "Бухгалтер (новое имя)" };
		expect(rebaseForm(base, next, form)).toEqual({ ...form, fullName: "Бухгалтер (новое имя)" });
	});

	it("изменение дошло до базы — форма и база совпадают, правка исчезает сама", () => {
		const form = { ...base, showInList: false };
		const next = { ...base, showInList: false };
		const merged = rebaseForm(base, next, form);
		expect(buildUserUpdate("Оператор", { fullName: next.fullName, disabled: next.disabled, showInList: next.showInList }, merged)).toBeNull();
	});

	it("введённый пароль не теряется при перечитывании", () => {
		expect(rebaseForm(base, { ...base }, { ...base, password: "секрет" }).password).toBe("секрет");
	});
});

/**
 * Групповая правка пользователя по многим базам — только изменённое (П1, аудит 14.09).
 *
 * Общая форма отправляла во все отмеченные базы `disabled` всегда и `roles` целиком — набором из
 * одной базы: правка полного имени перезаписывала права и доступ везде.
 */
describe("групповая правка пользователя: только изменённое", () => {
	const original = { fullName: "Оператор бухгалтер", disabled: false, roles: ["Кассир", "БазовыеПрава"] };
	const draft = (over: Partial<Parameters<typeof buildGroupUserUpdate>[2]> = {}) => ({
		name: "Оператор", fullName: "Оператор бухгалтер", password: "", disabled: false, roles: ["Кассир", "БазовыеПрава"], ...over,
	});

	it("изменили только полное имя — ни ролей, ни «Отключён» в команде", () => {
		expect(buildGroupUserUpdate("Оператор", original, draft({ fullName: "Бухгалтер" })))
			.toEqual({ name: "Оператор", fullName: "Бухгалтер" });
	});

	it("роли — поправками относительно показанного набора", () => {
		expect(buildGroupUserUpdate("Оператор", original, draft({ roles: ["кассир", "ПолныеПрава"] })))
			.toEqual({ name: "Оператор", addRoles: ["ПолныеПрава"], removeRoles: ["БазовыеПрава"] });
	});

	it("«Отключён» — только если переключили", () => {
		expect(buildGroupUserUpdate("Оператор", original, draft({ disabled: true }))).toEqual({ name: "Оператор", disabled: true });
	});

	it("ничего не изменилось — команды нет", () => {
		expect(buildGroupUserUpdate("Оператор", original, draft())).toBeNull();
		// Пустое полное имя — «не трогать», а не «очистить».
		expect(buildGroupUserUpdate("Оператор", original, draft({ fullName: "" }))).toBeNull();
	});

	it("П19: пустое полное имя не уходит и из карточки — очистить имя нельзя", () => {
		expect(buildUserUpdate("Оператор", { fullName: "Оператор бухгалтер", disabled: false, showInList: null },
			{ name: "Оператор", fullName: "  ", password: "", disabled: false, showInList: null })).toBeNull();
	});

	it("разница ролей без учёта регистра", () => {
		expect(diffRoles(["Кассир"], ["кассир"])).toEqual({ add: [], remove: [] });
	});
});

