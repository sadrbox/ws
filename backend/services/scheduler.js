// ─────────────────────────────────────────────────────────────────────────────
// Единый планировщик фоновых задач (Z5). Заменяет разрозненные setInterval по
// сервисам (бэкап, чистка аудита и т.п.) одним реестром с общими гарантиями:
//   • задача не пересекается сама с собой (флаг running — длинный бэкап не
//     наложится на следующий тик);
//   • не запускается чаще своего интервала (lastRun), даже если тикер частит;
//   • ошибка одной задачи логируется и НЕ роняет остальные;
//   • первый прогон — с задержкой после старта (не бьём по БД на буте);
//   • все таймеры .unref() — не держат процесс при выходе.
//
// Каждая задача opt-in по env (intervalMs<=0 → не регистрируется). Масштаб — 1
// инстанс (pm2 fork); для нескольких процессов задачу выносить в отдельный воркер
// или на Postgres advisory-lock, чтобы не дублировать.
// ─────────────────────────────────────────────────────────────────────────────

const tasks = [];

/**
 * Зарегистрировать периодическую задачу. intervalMs<=0 → задача выключена (не добавляется).
 * @param {object} t
 * @param {string} t.name
 * @param {number} t.intervalMs
 * @param {() => (Promise<string|void>|string|void)} t.run  вернёт строку — попадёт в лог
 * @param {number} [t.initialDelayMs=60000]
 */
export function registerTask({ name, intervalMs, run, initialDelayMs = 60_000 }) {
	if (!name || typeof run !== "function") throw new Error("scheduler: task требует name и run");
	if (!(intervalMs > 0)) return false; // выключена
	tasks.push({ name, intervalMs, run, initialDelayMs, running: false, lastRun: 0 });
	return true;
}

/** Список зарегистрированных задач (интроспекция/тесты). */
export function listTasks() {
	return tasks.map((t) => ({ name: t.name, intervalMs: t.intervalMs }));
}

/** Сбросить реестр (для тестов). */
export function _reset() {
	tasks.length = 0;
}

/**
 * Запустить все зарегистрированные задачи на таймерах.
 * @param {{ log?: { info?: Function, warn?: Function, error?: Function } }} [opts]
 * @returns {string[]} имена запущенных задач
 */
export function startScheduler({ log = console } = {}) {
	const info = (m) => (log.info ? log.info(m) : console.log(m));
	const error = (m, e) => (log.error ? log.error(m, e) : console.error(m, e));
	for (const t of tasks) {
		const tick = async () => {
			if (t.running) return; // предыдущий прогон ещё идёт
			if (t.lastRun && Date.now() - t.lastRun < t.intervalMs - 1000) return; // не чаще интервала
			t.running = true;
			try {
				const r = await t.run();
				if (r) info(`[scheduler] ${t.name}: ${r}`);
			} catch (e) {
				error(`[scheduler] ${t.name} error:`, e?.message || e);
			} finally {
				t.running = false;
				t.lastRun = Date.now();
			}
		};
		// Проверяем не реже раза в час; первый прогон — через initialDelayMs.
		setTimeout(tick, t.initialDelayMs).unref?.();
		setInterval(tick, Math.min(t.intervalMs, 3_600_000)).unref?.();
	}
	if (tasks.length) info(`[scheduler] запущено задач: ${tasks.map((t) => t.name).join(", ")}`);
	return tasks.map((t) => t.name);
}

export default { registerTask, listTasks, startScheduler, _reset };
