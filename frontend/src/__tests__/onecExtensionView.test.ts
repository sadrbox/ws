/**
 * Вкладка «Базы с расширением»: подписи и итоги (23.09).
 *
 * Сводку теперь собирает сервис из источников САМОГО расширения — заявок, токенов, среза бизнес-агентов и
 * запросов самой базы по каналу чата (`GET /v1/onec/extension-bases`), поэтому здесь проверяется только то, что
 * видит человек: как называется состояние доступа, откуда взялась версия и кого показывать отстающим.
 */
import { describe, expect, it } from "vitest";
import { compareVersions, extensionRows, extensionSummary } from "src/models/OneCAdmin/extensionView";
import type { ExtensionBase } from "src/services/onec/api";

const item = (over: Partial<ExtensionBase> = {}): ExtensionBase => ({
	baseKey: "erp_main", name: "Бухгалтерия", organizationUuid: "org-1", organizationName: "ТОО Ромашка",
	extVersion: "1.6.0", extVersionSource: "agent", access: "active", transport: "http",
	agentId: "a1", agentName: "Бухгалтерия", approvedAt: "2026-09-20T10:00:00.000Z", seenAt: "2026-09-23T08:00:00.000Z",
	chatSeenAt: null, lastExchangeAt: "2026-09-23T08:00:00.000Z", lastExchangeSource: "agent",
	pending: false, ...over,
});

describe("базы с расширением", () => {
	it("состояние доступа называется словами, а не кодом", () => {
		const labels = extensionRows([
			item({ baseKey: "a", access: "active" }),
			item({ baseKey: "b", access: "rotating" }),
			item({ baseKey: "c", access: "revoked" }),
			item({ baseKey: "d", access: "none" }),
		]).map((r) => r.accessLabel);
		expect(new Set(labels).size).toBe(4);
		expect(labels[0]).toBe("действует");
		expect(labels[3]).toBe("не выдавался");
	});

	it("версия со слов заявки помечена: агент её не подтверждал", () => {
		const [fresh] = extensionRows([item()]);
		expect(fresh.versionStale).toBe(false);
		const [stale] = extensionRows([item({ extVersionSource: "registration", extVersion: "1.5.0" })]);
		expect(stale.versionStale).toBe(true);
	});

	/*
	 * С2: версия из канала чата — ЖИВАЯ, звёздочки не заслуживает. Пометка «*» означает «со слов заявки, могло
	 * устареть»; база, назвавшая сборку в сегодняшнем запросе, под это не подходит, и путать эти два случая
	 * нельзя: по звёздочке человек идёт проверять то, что уже проверено.
	 */
	it("версия из канала чата не помечается устаревшей, но названа своим источником", () => {
		const [row] = extensionRows([item({
			extVersionSource: "chat", extVersion: "1.6.1", agentName: null, seenAt: null,
			chatSeenAt: "2026-09-23T09:00:00.000Z", lastExchangeAt: "2026-09-23T09:00:00.000Z", lastExchangeSource: "chat",
		})]);
		expect(row.versionStale).toBe(false);
		expect(row.versionFromChat).toBe(true);
		expect(row.lastExchangeAt).toBe("2026-09-23T09:00:00.000Z");
		expect(row.lastExchangeSource).toBe("chat");
	});

	it("транспорт пуст — «агент не сообщал», а не «связи нет»", () => {
		expect(extensionRows([item({ transport: null })])[0].transportLabel).toBe("—");
		expect(extensionRows([item({ transport: "com" })])[0].transportLabel).toBe("COM");
	});

	it("версии сравниваются числами: 1.10.0 новее 1.9.0, хотя по алфавиту наоборот", () => {
		expect(compareVersions("1.10.0", "1.9.0")).toBeGreaterThan(0);
		expect(compareVersions("1.6.0", "1.6.0")).toBe(0);
		expect(compareVersions("1.4", "1.4.1")).toBeLessThan(0);
	});

	it("отстающими считаются базы старее САМОЙ СВЕЖЕЙ сборки, а не самой частой", () => {
		/*
		 * Пока обновление идёт по клиентам, частой какое-то время остаётся СТАРАЯ сборка. Считай эталоном её —
		 * и «отстающими» оказались бы уже обновлённые базы, то есть список звонков был бы ровно наоборот.
		 */
		const rows = extensionRows([
			item({ baseKey: "a", extVersion: "1.5.0" }),
			item({ baseKey: "b", extVersion: "1.5.0" }),
			item({ baseKey: "c", extVersion: "1.6.0" }),
		]);
		const s = extensionSummary(rows);
		expect(s.newestVersion).toBe("1.6.0");
		expect(s.outdated).toEqual(["a", "b"]);
		expect(s.bases).toBe(3);
	});

	it("итоги считают доступ и ожидающие заявки; без версии — «не видели», а не «устарело»", () => {
		const s = extensionSummary(extensionRows([
			item({ baseKey: "known" }),
			item({ baseKey: "silent", extVersion: "", extVersionSource: "none", access: "none", pending: true }),
			item({ baseKey: "off", access: "revoked" }),
		]));
		expect(s.withAccess).toBe(1);
		expect(s.pending).toBe(1);
		expect(s.unknownVersion).toBe(1);
		expect(s.outdated).toEqual([]);
	});
});
