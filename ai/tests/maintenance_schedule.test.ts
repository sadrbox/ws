/**
 * Расписание обслуживания (F2): когда пора запускать, а когда нет.
 *
 * Проверяется ровно то, что нельзя увидеть глазами и что стоит дорого при ошибке: окно не
 * проспано после перезапуска сервиса, но и не запущено дважды — выгрузка сотни баз занимает
 * часы и держит сеансы с лицензиями 1С.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isDue } from "../src/onec/schedules.ts";
import { isBatchError, startBatch } from "../src/onec/batchRunner.ts";

/** Момент местного времени — расписание живёт в зоне сервиса, а не в UTC. */
const at = (iso: string) => new Date(iso);

const base = { enabled: true, atTime: "02:00", weekdays: [] as number[], lastRunAt: null as string | null };

describe("пора ли запускать обслуживание", () => {
	it("время наступило — пора", () => {
		assert.equal(isDue(base, at("2026-09-14T02:00:00")), true);
	});

	it("до окна — не пора", () => {
		assert.equal(isDue(base, at("2026-09-14T01:59:00")), false);
	});

	it("выключенное расписание не запускается никогда", () => {
		assert.equal(isDue({ ...base, enabled: false }, at("2026-09-14T02:00:00")), false);
	});

	it("тик через 20 минут после окна ещё запускает — сервис могли перезапустить", () => {
		// Без допуска расписание молча пропустило бы сутки: тик приходит не в ноль секунд.
		assert.equal(isDue(base, at("2026-09-14T02:20:00")), true);
	});

	it("через два часа окно закрыто: ночную выгрузку не начинают утром", () => {
		assert.equal(isDue(base, at("2026-09-14T04:00:00")), false);
	});

	it("уже запускалось сегодня — второй раз в то же окно не идёт", () => {
		const s = { ...base, lastRunAt: "2026-09-14T02:01:00" };
		assert.equal(isDue(s, at("2026-09-14T02:10:00")), false);
	});

	it("запускалось вчера — сегодня снова пора", () => {
		const s = { ...base, lastRunAt: "2026-09-13T02:01:00" };
		assert.equal(isDue(s, at("2026-09-14T02:05:00")), true);
	});

	it("дни недели: в свой день пора, в чужой — нет", () => {
		// 14.09.2026 — понедельник (getDay() === 1), 15.09 — вторник.
		const monday = { ...base, weekdays: [1] };
		assert.equal(isDue(monday, at("2026-09-14T02:00:00")), true);
		assert.equal(isDue(monday, at("2026-09-15T02:00:00")), false);
	});

	it("пустой список дней означает «каждый день»", () => {
		for (const day of ["2026-09-14", "2026-09-15", "2026-09-19", "2026-09-20"]) {
			assert.equal(isDue(base, at(`${day}T02:00:00`)), true, day);
		}
	});

	it("окно за полночь не переносится на прошлый день", () => {
		// 23:50 при расписании на 00:10 — это ещё не «пора»: следующее окно наступит
		// после полуночи, и тик заметит его тогда же.
		const s = { ...base, atTime: "00:10" };
		assert.equal(isDue(s, at("2026-09-14T23:50:00")), false);
		assert.equal(isDue(s, at("2026-09-15T00:10:00")), true);
	});
});

/**
 * СЕРВЕР РАСПИСАНИЯ (C10, 20.09). Имя базы уникально только в пределах сервера: ночной прогон должен идти на
 * сервер расписания, а расписание без сервера при одноимённых базах — пропускать их с причиной, а не гадать.
 */
describe("расписание при нескольких серверах 1С", () => {
	const deps = (asked: { serverId?: string | null }[]) => ({
		agents: {
			pickAdminAgent: async (_key: string, opts: { serverId?: string | null } = {}) => {
				asked.push({ serverId: opts.serverId ?? null });
				return { id: "adm", organizationUuid: "org", role: "admin", disabled: false, online: true, serverId: opts.serverId ?? "srv-1", capabilities: ["cluster.admin", "ib.admin"], version: "2026-09-19" };
			},
		},
		queue: { enqueue: async () => ({ id: "cmd_1" }) },
		batches: { create: async () => "batch-1", attach: async () => {}, noteSkipped: async () => {} },
		bases: {
			findByKeyGlobal: async (key: string) => ({ key, disabled: false, clusterStatus: "ONLINE", status: "ONLINE" }),
			serversWithKey: async () => [{ id: "srv-1", name: "SRV-A", organizationUuid: "org" }, { id: "srv-2", name: "SRV-B", organizationUuid: "org" }],
		},
	});

	it("сервер расписания уходит в выбор агента", async () => {
		const asked: { serverId?: string | null }[] = [];
		const r = await startBatch(deps(asked) as never, {
			type: "IB_BACKUP", baseKeys: ["Бух"], payload: { dir: "D:\\\\dump" },
			organizationUuid: "org", userUuid: null, serverId: "srv-2",
		});
		assert.equal(isBatchError(r), false);
		assert.deepEqual(asked, [{ serverId: "srv-2" }]);
	});

	it("без сервера одноимённая база на двух серверах пропускается с причиной, а не уходит наугад", async () => {
		const asked: { serverId?: string | null }[] = [];
		const r = await startBatch(deps(asked) as never, {
			type: "IB_BACKUP", baseKeys: ["Бух"], payload: { dir: "D:\\\\dump" },
			organizationUuid: "org", userUuid: null,
		});
		assert.equal(isBatchError(r), false);
		assert.equal(asked.length, 0, "агент не выбирался");
		if (!isBatchError(r)) {
			assert.equal(r.queued, 0);
			assert.match(r.skipped[0]?.reason ?? "", /нескольких серверах/);
		}
	});
});
