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
	applyRoleChanges, buildSavePlan, buildUserUpdate, roleCatalog,
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
describe("роли: полный набор против поправок", () => {
	const changes = (add: string[], remove: string[] = []) => {
		const m = new Map<string, { add: string[]; remove: string[] }>();
		m.set("_transition", { add, remove });
		return m;
	};

	it("свежие роли известны — уходит полный набор, без поправок", () => {
		const { plan } = buildSavePlan({
			baseKey: "_transition", userName: "Оператор", profileUpdate: null,
			rolesByBase: changes(["ПолныеПрава"], ["Кассир"]),
			knownBases: [], ownCurrentRoles: ["Кассир", "БазовыеПрава"],
		});
		expect(plan.get("_transition")).toEqual({
			name: "Оператор", roles: ["БазовыеПрава", "ПолныеПрава"],
		});
	});

	it("свежих ролей нет — поправки, как прежде: чужую роль снимать нельзя", () => {
		const { plan } = buildSavePlan({
			baseKey: "_transition", userName: "Оператор", profileUpdate: null,
			rolesByBase: changes(["ПолныеПрава"], ["Кассир"]),
			knownBases: [], ownCurrentRoles: null,
		});
		expect(plan.get("_transition")).toEqual({
			name: "Оператор", addRoles: ["ПолныеПрава"], removeRoles: ["Кассир"],
		});
	});

	it("чужие базы остаются на поправках: их списки карточка не читает", () => {
		const m = new Map<string, { add: string[]; remove: string[] }>();
		m.set("_transition", { add: ["ПолныеПрава"], remove: [] });
		m.set("almaz67", { add: ["Кассир"], remove: [] });
		const { plan } = buildSavePlan({
			baseKey: "_transition", userName: "Оператор", profileUpdate: null,
			rolesByBase: m, knownBases: ["_transition", "almaz67"],
			ownCurrentRoles: ["БазовыеПрава"],
		});
		expect(plan.get("_transition")).toEqual({ name: "Оператор", roles: ["БазовыеПрава", "ПолныеПрава"] });
		expect(plan.get("almaz67")).toEqual({ name: "Оператор", addRoles: ["Кассир"] });
	});

	it("реквизиты и роли одной базы — по-прежнему ОДНА команда", () => {
		const { plan } = buildSavePlan({
			baseKey: "_transition", userName: "Оператор",
			profileUpdate: { name: "Оператор", disabled: true },
			rolesByBase: changes(["ПолныеПрава"]),
			knownBases: [], ownCurrentRoles: ["БазовыеПрава"],
		});
		expect(plan.get("_transition")).toEqual({
			name: "Оператор", disabled: true, roles: ["БазовыеПрава", "ПолныеПрава"],
		});
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
