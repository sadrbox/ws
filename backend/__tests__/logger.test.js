/**
 * Логгер бэкенда: уровень действительно приглушает, формат один.
 *
 * Смысл проверки — в том, ради чего логгер и появился (Q4): сообщение с уровнем ниже порога
 * НЕ печатается (иначе поток событий 1С снова не отключить без правки кода), ошибки уходят в
 * stderr отдельно от обычных строк, а префикс подсистемы стоит в каждой строке — по нему их
 * и отбирают в общем потоке pm2.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { logger } from "../services/logger.js";

/** Перехват вывода: возвращает напечатанное и возвращает консоль как было. */
function capture(fn) {
	const out = [];
	const err = [];
	const origLog = console.log;
	const origErr = console.error;
	console.log = (...a) => out.push(a.join(" "));
	console.error = (...a) => err.push(a.join(" "));
	try { fn(); } finally { console.log = origLog; console.error = origErr; }
	return { out, err };
}

test("уровень ниже порога не печатается", () => {
	const prev = process.env.LOG_LEVEL;
	process.env.LOG_LEVEL = "info";
	try {
		const { out } = capture(() => logger("pipe").debug("событие 1С"));
		assert.deepEqual(out, []);
	} finally { process.env.LOG_LEVEL = prev; }
});

test("LOG_LEVEL=debug включает отладочные строки без правки кода", () => {
	const prev = process.env.LOG_LEVEL;
	process.env.LOG_LEVEL = "debug";
	try {
		const { out } = capture(() => logger("pipe").debug("создание Sale"));
		assert.equal(out.length, 1);
		assert.match(out[0], /DEBUG \[pipe\] создание Sale$/);
	} finally { process.env.LOG_LEVEL = prev; }
});

test("ошибки идут в stderr, обычные сообщения — в stdout", () => {
	const { out, err } = capture(() => {
		const log = logger("scheduler");
		log.info("запущено задач: backup");
		log.error("backup: ошибка", "нет pg_dump");
	});
	assert.equal(out.length, 1);
	assert.equal(err.length, 1);
	assert.match(out[0], /INFO {2}\[scheduler\] запущено задач: backup$/);
	assert.match(err[0], /ERROR \[scheduler\] backup: ошибка нет pg_dump$/);
});

test("в строке есть время — по логам восстанавливают ход событий", () => {
	const { out } = capture(() => logger().info("старт"));
	assert.match(out[0], /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} INFO {2}старт$/);
});
