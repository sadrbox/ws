// E15: расшифровка ошибок 1С/COM в отчёте задания.
//
// Смысл проверок: подсказка не должна ни подменять исходный текст (он — единственное
// доказательство), ни накапливаться при повторном чтении списка задания.

import { test } from "node:test";
import assert from "node:assert/strict";
import { humanizeAgentError, parseLockedBy } from "../src/onec/errorHints.ts";
import { ibFailureReason } from "../src/bases/service.ts";
import { RETRY_LATER_CODES, isBusyFailure } from "../src/commands/queue.ts";

const COM_MEMBER_NOT_FOUND = {
	code: "IB_ERROR",
	message: 'Exception calling "InvokeMember" with "5" argument(s): "Member not found. '
		+ '(Exception from HRESULT: 0x80020003 (DISP_E_MEMBERNOTFOUND))"',
};

test("HRESULT 0x80020003 получает диагноз, исходный текст сохраняется", () => {
	const out = humanizeAgentError(COM_MEMBER_NOT_FOUND)!;
	assert.ok(out.message.startsWith(COM_MEMBER_NOT_FOUND.message));
	assert.match(out.message, /РасширенияКонфигурации/);
	assert.equal(out.code, "IB_ERROR");
});

test("повторная расшифровка не наращивает текст", () => {
	const once = humanizeAgentError(COM_MEMBER_NOT_FOUND)!;
	const twice = humanizeAgentError(once)!;
	assert.equal(twice.message, once.message);
});

test("массив .NET вместо коллекции 1С: подсказан менеджер НайтиПоИмени", () => {
	const out = humanizeAgentError({
		code: "IB_ERROR",
		message: 'платформа не знает метод Найти / Find: Exception calling "InvokeMember" with "5" '
			+ 'argument(s): "Method \'System.Object[].Find\' not found."',
	})!;
	assert.match(out.message, /НайтиПоИмени/);
	// Про роли сказано там же: следующий шаг после поиска пользователя — именно они.
	assert.match(out.message, /Метаданные\.Роли\.Найти/);
});

test("незнакомая ошибка и пустое значение проходят как есть", () => {
	const other = { code: "IB_ERROR", message: "Что-то своё" };
	assert.equal(humanizeAgentError(other), other);
	assert.equal(humanizeAgentError(null), null);
});

test("неаутентифицированный администратор кластера ведёт к настройкам агента, не базы", () => {
	const out = humanizeAgentError({
		code: "RAC_ERROR",
		message: "rac завершился с ошибкой: Ошибка операции администрирования "
			+ "Администратор кластера не аутентифицирован",
	})!;
	assert.match(out.message, /--cluster-user/);
	// Отказ одинаков для неверного пароля и неизвестного имени — подсказка обязана
	// сказать это прямо, иначе имя проверять не станут.
	assert.match(out.message, /НЕ различает неверный пароль и неизвестное имя/);
	// Администратора центрального сервера не путаем с администратором кластера.
	const agentAdmin = humanizeAgentError({
		code: "RAC_ERROR", message: "Администратор центрального сервера не аутентифицирован",
	})!;
	assert.match(agentAdmin.message, /--agent-user/);
});

test("незарегистрированный COMConnector отличается от отсутствующего члена", () => {
	const out = humanizeAgentError({ code: "IB_ERROR", message: "Class not registered (0x80040154)" })!;
	assert.match(out.message, /COMConnector/);
});

// С34: расширение собрано под другую версию конфигурации — повтор бессмыслен, база исправна.
test("IB_EXTENSION_NOT_APPLICABLE: совет пересобрать; ни повтора в задании, ни отметки «в базу не войти»", () => {
	const e = {
		code: "IB_EXTENSION_NOT_APPLICABLE",
		message: "Контролируемое свойство «Тип» реквизита Справочник.Номенклатура.Артикул не совпадает с конфигурацией",
	};
	const out = humanizeAgentError(e)!;
	assert.ok(out.message.startsWith(e.message));
	// Совет «пересоберите расширение» даёт сам агент — подсказка его не повторяет (проверка 16.09).
	assert.doesNotMatch(out.message.slice(e.message.length), /конфигуратор|заимствованн/i);
	assert.match(out.message, /не повторяет/);
	assert.equal(ibFailureReason(e), null);
	assert.equal(RETRY_LATER_CODES.has(e.code), false);
});

// С37/С38: базу держит чужой сеанс — текст платформы приходит и с общим кодом (16.09, `_transition`).
test("«разделённый доступ»: подсказка про сеанс, повтор в задании, база исправна", () => {
	const e = {
		code: "IB_ERROR",
		message: "Ошибка разделенного доступа к базе данных База данных заблокирована: компьютер: SERVER, "
			+ "сеанс: 2, начат: 16.09.2026 в 9:54:27, приложение: Фоновое задание",
	};
	const out = humanizeAgentError(e)!;
	assert.ok(out.message.startsWith(e.message));
	assert.match(out.message, /Фоновое задание|снимите сеанс/i);
	// Повторяем как «база занята», хотя код общий: база освободится сама.
	assert.equal(isBusyFailure(e.code, e.message), true);
	// И не помечаем базу недоступной: вход тут ни при чём.
	assert.equal(ibFailureReason(e), null);
	// Прежнее правило по кодам не изменилось.
	assert.equal(isBusyFailure("IB_BUSY", ""), true);
	assert.equal(isBusyFailure("IB_ERROR", "иная ошибка"), false);
	assert.equal(RETRY_LATER_CODES.has("IB_BUSY"), true);
});

// 17.09: изменение пользователя не дождалось управляемой блокировки — код общий, минутой позже правка прошла.
test("конфликт блокировок: подсказка, повтор в задании, база исправна", () => {
	const e = {
		code: "IB_ERROR",
		message: "Конфликт блокировок при выполнении транзакции: Превышено максимальное время ожидания "
			+ "предоставления блокировки. Время по этапам: вход в базу 7 с; до отказа 20 с",
	};
	const out = humanizeAgentError(e)!;
	assert.ok(out.message.startsWith(e.message));
	assert.match(out.message, /Ничего не записано/);
	// Повторяем: транзакция откатилась, данные освободятся сами.
	assert.equal(isBusyFailure(e.code, e.message), true);
	// Вход в базу состоялся — отметку «в базу не войти» не ставим.
	assert.equal(ibFailureReason(e), null);
	// Англоязычная платформа и взаимоблокировка — тот же класс отказа.
	assert.equal(isBusyFailure("IB_ERROR", "Lock conflict while executing the transaction: lock request timeout"), true);
	assert.equal(isBusyFailure("IB_ERROR", "Конфликт блокировок при выполнении транзакции: Обнаружена взаимоблокировка"), true);
	// Слово «блокировка» само по себе — не повод повторять: «установлена блокировка входа» не пройдёт от повтора.
	assert.equal(isBusyFailure("IB_ERROR", "Установлена блокировка начала сеансов"), false);
});

// П25: кто держит базу — полями, а не абзацем.
test("parseLockedBy: компьютер, сеанс, начало и приложение из текста платформы", () => {
	const held = parseLockedBy("Ошибка разделенного доступа к базе данных База данных заблокирована: компьютер: SERVER, "
		+ "сеанс: 2, начат: 16.09.2026 в 9:54:27, приложение: Фоновое задание");
	assert.deepEqual(held, {
		computer: "SERVER", sessionId: "2", startedAt: "16.09.2026 в 9:54:27", appId: "Фоновое задание",
	});
	// Иной отказ разбирать нечего — панель покажет текст как есть.
	assert.equal(parseLockedBy("Соединение с информационной базой не установлено"), null);
	assert.equal(parseLockedBy(null), null);
});
