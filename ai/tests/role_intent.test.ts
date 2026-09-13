/**
 * Сделал ли агент то, что ему сказали: проверка ролей по его же эху.
 *
 * ЖИВОЙ СЛУЧАЙ (12.09, вечер). Правка ролей в карточке пользователя базы «не сохранялась».
 * В журнале команд: `IB_UPDATE_USER` с `addRoles: ["АдминистраторСистемы",
 * "Администрирование"]` → `{"ok": true}`, а в приложенном к той же команде списке
 * пользователей роли прежние. Роли в этой базе существуют (они выданы другому её
 * пользователю) — сборка агента просто не применяет `addRoles`/`removeRoles`.
 *
 * Правило, которое держит тест: команда, доложившая об успехе и ничего не сделавшая, —
 * это ОТКАЗ. Молчаливый отказ в доступе дороже любого другого: панель показывает
 * «Выполнено», человек уходит, а права остались прежними.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { checkRoleIntent, roleVerdictMessage } from "../src/onec/echo.ts";
import type { IbUser } from "../src/onec/registry.ts";

const user = (roles: string[], name = "Оператор бухгалтер"): IbUser => ({ name, roles });

describe("проверка намерения по ролям", () => {
	it("живой случай: роли просили выдать, в эхе их нет — отказ", () => {
		const v = checkRoleIntent(
			{ name: "Оператор бухгалтер", addRoles: ["АдминистраторСистемы", "Администрирование"] },
			[user(["ПолучениеОбновленийВнешнихКомпонент", "БазовыеПраваЗарплатаИКадры"])],
		);
		assert.equal(v.ok, false);
		if (v.ok) return;
		assert.deepEqual(v.notAdded, ["АдминистраторСистемы", "Администрирование"]);
		assert.deepEqual(v.notRemoved, []);
		// Текст называет, что не сошлось, — числом и именами, как их отдаёт 1С.
		const text = roleVerdictMessage(v);
		assert.match(text, /роли в базе не изменились/);
		assert.match(text, /не выданы 2: АдминистраторСистемы, Администрирование/);
	});

	it("роли выданы — успех", () => {
		const v = checkRoleIntent(
			{ name: "Оператор бухгалтер", addRoles: ["ПолныеПрава"] },
			[user(["ПолныеПрава", "БазовыеПрава"])],
		);
		assert.equal(v.ok, true);
	});

	it("снятая роль осталась — отказ", () => {
		const v = checkRoleIntent(
			{ name: "Оператор бухгалтер", removeRoles: ["ПолныеПрава"] },
			[user(["ПолныеПрава"])],
		);
		assert.equal(v.ok, false);
		if (!v.ok) assert.deepEqual(v.notRemoved, ["ПолныеПрава"]);
	});

	it("регистр и пробелы в имени роли не считаются расхождением", () => {
		const v = checkRoleIntent(
			{ name: "Оператор бухгалтер", addRoles: [" полныеправа "] },
			[user(["ПолныеПрава"])],
		);
		assert.equal(v.ok, true);
	});

	it("переименование: пользователя ищем по НОВОМУ имени", () => {
		// Под прежним именем его в базе уже нет, и «не нашли» означало бы ложный отказ.
		const v = checkRoleIntent(
			{ name: "Оператор", newName: "Оператор2", addRoles: ["ПолныеПрава"] },
			[user(["ПолныеПрава"], "Оператор2")],
		);
		assert.equal(v.ok, true);
	});

	it("ролей в команде не было — судить не о чем", () => {
		const v = checkRoleIntent({ name: "Оператор бухгалтер", disabled: true }, [user([])]);
		assert.equal(v.ok, true);
	});

	it("пользователя в эхе нет — молчим, а не объявляем отказ по догадке", () => {
		// Список может быть не о том: чужая база, пересозданный пользователь.
		const v = checkRoleIntent(
			{ name: "Оператор бухгалтер", addRoles: ["ПолныеПрава"] },
			[user(["ПолныеПрава"], "совсем другой")],
		);
		assert.equal(v.ok, true);
	});

	it("полный набор `roles`: лишняя роль — тоже отказ", () => {
		// «Привести к эталону» не должно оставлять роль, которую велено было снять.
		const v = checkRoleIntent(
			{ name: "Оператор бухгалтер", roles: ["ПолныеПрава"] },
			[user(["ПолныеПрава", "Кассир"])],
		);
		assert.equal(v.ok, false);
		// Имя — как его отдала 1С, а не нормализованное: человек ищет его в конфигураторе.
		if (!v.ok) assert.deepEqual(v.notRemoved, ["Кассир"]);
	});

	// ── Живой случай 13.09: «снять все роли» не применилось ─────────────────
	//
	// Сборка агента 23:48 приняла `roles: []`, ответила SUCCESS и оставила пользователю все
	// 331 роль. Сверка это поймала — но отказ перечислял все 331 имя строчными буквами одной
	// строкой. Прочитать такое нельзя; нужное в нём — что именно не легло и сколько.

	it("пустой полный набор не применился — отказ говорит это прямо", () => {
		const have = Array.from({ length: 331 }, (_, i) => `Роль${i + 1}`);
		const v = checkRoleIntent({ name: "Оператор бухгалтер", roles: [] }, [user(have)]);
		assert.equal(v.ok, false);
		if (v.ok) return;
		assert.equal(v.emptySet, true);
		assert.equal(v.notRemoved.length, 331);

		const text = roleVerdictMessage(v);
		assert.match(text, /снять все роли/);
		assert.match(text, /осталось 331/);
		// Показываем десяток имён для примера, остальное — числом.
		assert.match(text, /Роль1, Роль2/);
		assert.match(text, /и ещё 321/);
		assert.ok(!text.includes("Роль331"), "полный список в текст не попадает");
	});

	it("длинный список расхождений укорачивается и в обычном отказе", () => {
		const want = Array.from({ length: 25 }, (_, i) => `Новая${i + 1}`);
		const v = checkRoleIntent({ name: "Оператор бухгалтер", addRoles: want }, [user([])]);
		assert.equal(v.ok, false);
		if (v.ok) return;
		const text = roleVerdictMessage(v);
		assert.match(text, /не выданы 25/);
		assert.match(text, /и ещё 15/);
	});
});
