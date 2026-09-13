/**
 * Разделение прав панели 1С (F5): что доступно просмотру, а что только полному доступу.
 *
 * Проверяется именно политика, а не роутер: ошибка в этом списке не видна на глаз — она
 * либо запирает чтение (панель перестаёт работать у тех, кому дали «просмотр»), либо
 * пропускает разрушающее (удаление регистрации базы правом на просмотр).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isDestructive } from "../src/onec/access.ts";

describe("права панели 1С", () => {
	it("просмотр состояния доступен без полного доступа", () => {
		for (const p of ["/bases", "/sessions", "/connections", "/locks", "/processes", "/licenses",
			"/agents", "/servers", "/queue-stats", "/batches", "/bases/akacapital/info",
			"/bases/akacapital/users/cached", "/bases/akacapital/credentials"]) {
			assert.equal(isDestructive("GET", p), false, p);
		}
	});

	it("чтение 1С остаётся чтением, даже когда идёт POST'ом", () => {
		// Срез кластера, публикации и проверка базы в 1С ничего не меняют: это вопрос,
		// а не изменение, — и «просмотр» обязан его задавать.
		for (const p of ["/bases/refresh", "/publications/refresh", "/bases/akacapital/check"]) {
			assert.equal(isDestructive("POST", p), false, p);
		}
	});

	it("изменения 1С требуют полного доступа", () => {
		const cases: [string, string][] = [
			["POST", "/batch"],
			["POST", "/batches/9f1/retry"],
			["POST", "/batches/9f1/cancel"],
			["POST", "/commands/cancel"],
			["POST", "/commands/7c1/abort"],
			["POST", "/sessions/77/terminate"],
			["POST", "/connections/12/disconnect"],
			["PATCH", "/servers/srv-1"],
			["POST", "/agents"],
			["PATCH", "/agents/a1"],
			["DELETE", "/agents/a1"],
			["POST", "/agents/a1/rotate-token"],
			["POST", "/agents/a1/release-instance"],
			["POST", "/agents/a1/owner"],
			["POST", "/agent-processes/4120/kill"],
			["PUT", "/bases/akacapital/credentials"],
			["DELETE", "/bases/akacapital/credentials"],
			["POST", "/bases/akacapital/hidden"],
			["POST", "/bases/akacapital/lock"],
			["POST", "/bases/akacapital/restore"],
			["POST", "/bases/akacapital/apply-update"],
			["POST", "/bases/akacapital/drop-registration"],
		];
		for (const [m, p] of cases) assert.equal(isDestructive(m, p), true, `${m} ${p}`);
	});

	it("расписание обслуживания: смотреть можно, менять и запускать — нет", () => {
		// Ночная выгрузка занимает сервер часами: заводить её вправе не всякий, кому
		// открыта панель, а посмотреть, что назначено, — всякий.
		assert.equal(isDestructive("GET", "/schedules"), false);
		assert.equal(isDestructive("POST", "/schedules"), true);
		assert.equal(isDestructive("PATCH", "/schedules/7c1"), true);
		assert.equal(isDestructive("DELETE", "/schedules/7c1"), true);
		assert.equal(isDestructive("POST", "/schedules/7c1/run"), true);
	});

	it("выгрузка базы идёт заданием и попадает под полный доступ", () => {
		// IB_BACKUP ставится только через /batch — отдельного маршрута у него нет.
		assert.equal(isDestructive("POST", "/batch"), true);
	});
});
