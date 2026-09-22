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

// С43: дубль элемента справочника «Пользователи» — агент отказывает ДО записи (сборка 2026-09-17 19:16).
test("IB_USER_DUPLICATE: чем лечить, что ничего не записано и ссылки на элементы", () => {
	const e = {
		code: "IB_USER_DUPLICATE",
		message: "У пользователя ИБ «new2» элементов справочника: 2. Вход в программу невозможен, команда остановлена до записи",
		details: {
			duplicates: [
				{ ref: "aa11-f89", catalog: "Пользователи", deleted: false },
				{ ref: "aa11-f8a", catalog: "Пользователи", deleted: true },
			],
		},
	};
	const out = humanizeAgentError(e)!;
	assert.ok(out.message.startsWith(e.message));
	// Чем лечить — обработкой БСП, а не правкой учётной записи.
	assert.match(out.message, /Поиск и удаление дублей/);
	assert.match(out.message, /ничего не изменено/);
	// Ссылки — списком, помеченный на удаление назван отдельно.
	assert.match(out.message, /aa11-f89/);
	assert.match(out.message, /aa11-f8a \(помечен на удаление\)/);
	// Повторять нечего: это состояние базы, а не занятость.
	assert.equal(isBusyFailure(e.code, e.message), false);
	// Вход в базу состоялся — отметку «в базу не войти» не ставим.
	assert.equal(ibFailureReason(e), null);
});

// С43: подсказка приписывается один раз — список задания читают многократно.
test("IB_USER_DUPLICATE: повторная расшифровка не наращивает текст", () => {
	const e = { code: "IB_USER_DUPLICATE", message: "У пользователя ИБ «new2» элементов справочника: 2", details: { duplicates: [{ ref: "f89", catalog: "Пользователи" }] } };
	const once = humanizeAgentError(e)!;
	const twice = humanizeAgentError(once)!;
	assert.equal(twice.message, once.message);
});

// С46: собеседника называет агент — подсказка не навязывает «рабочий процесс» и знает про оба журнала.
test("IB_CONNECTION_LOST: без «рабочего процесса» в утверждении, оба журнала Windows", () => {
	const e = {
		code: "IB_CONNECTION_LOST",
		message: "Связь оборвалась: собеседник SERVER:1541 — менеджер кластера (rmngr)",
	};
	const out = humanizeAgentError(e)!;
	assert.match(out.message, /ragent|rmngr|RAS/);
	assert.match(out.message, /«Система»/);
	assert.match(out.message, /«Приложение»/);
	// Прежнее утверждение «оборвалась связь с рабочим процессом» ушло: собеседника называет агент.
	assert.ok(!/оборвалась связь с рабочим процессом/.test(out.message));
	assert.equal(ibFailureReason(e), null);
});

// ── Коды расширения buhprof_api 1.3.0 (СВ0) ──────────────────────────────

test("REQUEST_IN_PROGRESS: подсказка «уже выполняется», сервис команду не пересоздаёт", () => {
	const out = humanizeAgentError({ code: "REQUEST_IN_PROGRESS", message: "Операция с этим requestId уже выполняется" })!;
	assert.match(out.message, /не создавайте/);
	// Повторяет агент, а не сервис: новый requestId сделал бы из повтора вторую операцию.
	assert.equal(RETRY_LATER_CODES.has("REQUEST_IN_PROGRESS"), false);
	assert.equal(ibFailureReason({ code: "REQUEST_IN_PROGRESS", message: "" }), null);
});

test("SETUP_DISABLED: стендовая операция выключена, база исправна", () => {
	const out = humanizeAgentError({ code: "SETUP_DISABLED", message: "Операция выключена" })!;
	assert.match(out.message, /Стендовая операция выключена/);
	assert.equal(ibFailureReason({ code: "SETUP_DISABLED", message: "Операция выключена" }), null);
});

test("INTERNAL_ERROR с errorId: код для поиска в журнале 1С, один раз", () => {
	const e = { code: "INTERNAL_ERROR", message: "Внутренняя ошибка", details: { errorId: "a1b2c3" } };
	const once = humanizeAgentError(e)!;
	assert.match(once.message, /Код для поиска в журнале 1С: a1b2c3/);
	assert.equal(humanizeAgentError(once)!.message, once.message);
	assert.equal(humanizeAgentError({ code: "INTERNAL_ERROR", message: "Внутренняя ошибка" })!.message, "Внутренняя ошибка");
});

test("многобазовый агент: подсказки для BASE_REQUIRED, BASE_NOT_FOUND, LICENSE_LIMIT, EXTENSION_MISSING", () => {
	for (const code of ["BASE_REQUIRED", "BASE_NOT_FOUND", "LICENSE_LIMIT", "EXTENSION_MISSING"]) {
		const out = humanizeAgentError({ code, message: "отказ агента" });
		assert.ok(out && out.message.startsWith("отказ агента") && out.message.length > "отказ агента".length, code);
	}
	// Отказ сервиса по лимиту уже называет выход — совет не дублируется.
	const own = { code: "LICENSE_LIMIT", message: "База «Б3» сверх лимита (тариф: 2 базы, подключено 3). Увеличьте тариф или уберите лишнее из настроек агента." };
	assert.equal(humanizeAgentError(own)?.message, own.message);
});

test("СП6: отказ по недоверенному узлу обновления объясняется как настройка агента", () => {
	const byCode = humanizeAgentError({ code: "UPDATE_HOST_NOT_ALLOWED", message: "хост не разрешён" });
	assert.match(byCode!.message, /agent\.toml/);
	// Тот же смысл под другим кодом узнаётся по тексту.
	const byText = humanizeAgentError({ code: "COMMAND_FAILED", message: "адрес не в списке доверенных узлов" });
	assert.match(byText!.message, /update_hosts/);
});
