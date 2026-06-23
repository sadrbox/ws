// Лёгкий логгер: в dev пишет как обычно, в продакшен-сборке (import.meta.env.DEV
// = false) методы log/info/debug — no-op, чтобы не засорять консоль и не светить
// внутреннюю механику (синхронизация, SW, кэш). warn/error остаются всегда —
// это реальные проблемы, их видно и в проде.
const dev = import.meta.env.DEV;
const noop = (): void => {};

export const logger = {
	log: dev ? console.log.bind(console) : noop,
	info: dev ? console.info.bind(console) : noop,
	debug: dev ? console.debug.bind(console) : noop,
	warn: console.warn.bind(console),
	error: console.error.bind(console),
};
