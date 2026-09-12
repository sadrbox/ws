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
import { buildUserUpdate } from "src/models/OneCAdmin/userUpdate";

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
