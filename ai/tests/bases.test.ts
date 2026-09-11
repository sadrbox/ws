// E15/A1-A2: маршрутизация «база → сервер → агент» и троттлинг полного среза по базам.
//
// Без сети и без PostgreSQL: подставляем заглушку пула, которая отвечает по тексту запроса.
// Проверяется именно РЕШЕНИЕ (кому уйдёт команда), а не SQL — ошибка здесь means команда
// выполнится не в той базе или не тем агентом, и заметят это уже по последствиям.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { Db } from "../src/db/pool.ts";
import { AgentService, type AgentRole } from "../src/agents/service.ts";
import { isPublished, needsFullBases, publicUrl, publicationReport } from "../src/bases/service.ts";

type FakeAgent = {
	id: string;
	organization_uuid: string;
	server_id: string | null;
	role: AgentRole;
	last_seen_at: Date | null;
	disabled_at: Date | null;
};

function row(a: Partial<FakeAgent> & { id: string }) {
	return {
		organization_uuid: "org-1",
		server_id: null,
		role: "business" as AgentRole,
		bases_synced_at: null,
		name: a.id,
		version: "1.0.0",
		os: "windows",
		capabilities: [],
		status: "ONLINE",
		onec_reachable: true,
		onec_version: "8.3.25",
		last_seen_at: new Date(),
		registered_at: new Date(),
		disabled_at: null,
		created_at: new Date(),
		...a,
	};
}

/** Заглушка пула: агенты из списка, базы из карты «ключ → сервер». */
function fakeDb(agents: ReturnType<typeof row>[], bases: Record<string, string> = {}): Db {
	return {
		query: async (sql: string, params?: unknown[]) => {
			if (sql.includes("FROM bases b JOIN servers s")) {
				const key = String(params?.[1] ?? "");
				const serverId = bases[key];
				return { rows: serverId ? [{ server_id: serverId }] : [], rowCount: serverId ? 1 : 0 };
			}
			if (sql.includes("FROM agents WHERE organization_uuid")) {
				const org = String(params?.[0] ?? "");
				return { rows: agents.filter((a) => a.organization_uuid === org), rowCount: 0 };
			}
			if (sql.includes("FROM agents ORDER BY created_at")) return { rows: agents, rowCount: 0 };
			return { rows: [], rowCount: 0 };
		},
	} as unknown as Db;
}

test("роль обязательна: админ-команда не уходит бизнес-агенту и наоборот", async () => {
	const svc = new AgentService(fakeDb([
		row({ id: "biz", role: "business" }),
		row({ id: "adm", role: "admin" }),
	]), 90);

	assert.equal((await svc.pickAgentFor("org-1", null, "business"))?.id, "biz");
	assert.equal((await svc.pickAgentFor("org-1", null, "admin"))?.id, "adm");
});

test("нет агента нужной роли — команда не ставится вовсе, а не уходит «хоть кому-то»", async () => {
	const svc = new AgentService(fakeDb([row({ id: "biz", role: "business" })]), 90);
	assert.equal(await svc.pickAgentFor("org-1", null, "admin"), null);
});

test("база выбирает сервер, сервер — агента: команда не уходит на чужой сервер", async () => {
	const svc = new AgentService(fakeDb(
		[
			row({ id: "agent-s1", server_id: "srv-1" }),
			row({ id: "agent-s2", server_id: "srv-2" }),
		],
		{ "buh-client-A": "srv-2" },
	), 90);

	assert.equal((await svc.pickAgentFor("org-1", "buh-client-A", "business"))?.id, "agent-s2");
});

test("неизвестная база — null: выполнять «где-нибудь» нельзя", async () => {
	const svc = new AgentService(fakeDb([row({ id: "agent-s1", server_id: "srv-1" })], {}), 90);
	assert.equal(await svc.pickAgentFor("org-1", "нет-такой-базы", "business"), null);
});

test("псевдо-база default = обращение без базы: агент протокола v1 продолжает работать", async () => {
	const svc = new AgentService(fakeDb([row({ id: "old", server_id: null })]), 90);
	assert.equal((await svc.pickAgentFor("org-1", "default", "business"))?.id, "old");
	assert.equal((await svc.pickOnline("org-1"))?.id, "old");
});

test("офлайн и отключённые агенты в выборе не участвуют", async () => {
	const давно = new Date(Date.now() - 10 * 60 * 1000);
	const svc = new AgentService(fakeDb([
		row({ id: "offline", last_seen_at: давно }),
		row({ id: "disabled", disabled_at: new Date() }),
	]), 90);
	assert.equal(await svc.pickAgentFor("org-1", null, "business"), null);
});

test("режим any: чужой агент берётся только при обращении без базы", async () => {
	const агенты = [row({ id: "чужой", organization_uuid: "org-2", server_id: "srv-9" })];
	const svc = new AgentService(fakeDb(агенты, { "база-org1": "srv-1" }), 90, "any");

	// Без базы — прежнее поведение одиночного стенда: берём любого онлайн-агента.
	assert.equal((await svc.pickAgentFor("org-1", null, "business"))?.id, "чужой");
	// С базой — нет: база принадлежит серверу своей организации, и подмена молча увела бы
	// команду в чужую базу. Ровно то, от чего предупреждает ТЗ (AGENT_ORG_BINDING).
	assert.equal(await svc.pickAgentFor("org-1", "база-org1", "business"), null);
});

test("полный срез по базам: нужен при первом heartbeat и по истечении интервала", () => {
	const сейчас = Date.now();
	assert.equal(needsFullBases(null, 300, сейчас), true);
	assert.equal(needsFullBases(new Date(сейчас - 60_000), 300, сейчас), false);
	assert.equal(needsFullBases(new Date(сейчас - 301_000), 300, сейчас), true);
});

// ── Срез публикаций: один критерий «опубликована» и честный разбор ──────────
//
// Правило родилось из измерения: агент присылал сто десять записей, все с
// `published: false`, и объявлял список полным — а сразу перед этим наша же команда
// IB_PUBLISH вернула адрес публикации. Срез, в котором нет ни одной опубликованной
// базы, снаружи неотличим от читателя, который не умеет читать, и принимать его за
// факт нельзя: он затирал состояние, проверенное делом.

test("опубликована: явное true, либо адрес при умолчанном признаке", () => {
	assert.equal(isPublished({ key: "a", published: true }), true);
	// Адрес берётся из default.vrd — его нельзя получить, не найдя публикацию.
	assert.equal(isPublished({ key: "b", url: "http://localhost/b" }), true);
	// Явное «нет» — это ответ, и он отрицательный.
	assert.equal(isPublished({ key: "c", published: false, url: "http://localhost/c" }), false);
	// Ни признака, ни адреса — незнание агента, а НЕ «да». Раньше критерий был
	// `published !== false`, и такая запись становилась опубликованной.
	assert.equal(isPublished({ key: "d" }), false);
});

test("разбор среза: «не нашёл» без доказательств просмотра не принимается", () => {
	const all = [{ key: "a", published: false }, { key: "b", published: false }];
	// Ни source, ни lookedIn — ровно та сборка агента, которая однажды объявила полным
	// просмотр пустого каталога и «сняла» публикацию у ста десяти работающих баз.
	const r = publicationReport(all, true);
	assert.equal(r.total, 2);
	assert.equal(r.published, 0);
	assert.equal(r.complete, true);
	assert.equal(r.evidence, false);
	assert.equal(r.accepted, false);
});

test("разбор среза: «посмотрел везде и не нашёл» — это ответ, и он принимается", () => {
	// Сервер, где действительно ничего не опубликовано, обязан иметь возможность это
	// сказать. Отличает его от поломки одно: агент называет, ГДЕ смотрел.
	const r = publicationReport(
		[{ key: "a", published: false }], true,
		{ source: "iis", lookedIn: 105 },
	);
	assert.equal(r.published, 0);
	assert.equal(r.evidence, true);
	assert.equal(r.accepted, true);
});

test("разбор среза: доказательства без обещания полноты не делают срез достоверным", () => {
	const r = publicationReport([{ key: "a", published: false }], false, { source: "iis", lookedIn: 105 });
	assert.equal(r.accepted, false);
});

test("разбор среза: одна найденная публикация делает срез достоверным", () => {
	const r = publicationReport([{ key: "a", published: true, url: "http://localhost/a" }, { key: "b", published: false }], false);
	assert.equal(r.published, 1);
	assert.equal(r.accepted, true);
	// `complete` при этом остаётся своим: он решает только вопрос массового снятия.
	assert.equal(r.complete, false);
});

// ── Занятый агент — не молчащий ────────────────────────────────────────────
//
// Живой случай (2026-09-11): агент забрал два чтения расширений и ушёл их выполнять.
// Опрос команд он при этом не переоткрывает и heartbeat не шлёт — и через десять секунд
// сервис объявлял его «не на связи», а панель отказывала в следующей команде: «Админ-агент
// 1С не на связи» — ровно в тот момент, когда агент делал то, что ему поручили.
//
// Отличить остановленную службу от работающей можно фактом, который известен нам самим:
// мы вручили ему команду и знаем, сколько она вправе идти.

test("агент, забравший команду, считается на связи, пока идёт её срок", async () => {
	// heartbeat молчит десять минут — при прежних правилах это «офлайн» с запасом.
	const svc = new AgentService(fakeDb([row({ id: "adm", role: "admin", last_seen_at: new Date(Date.now() - 10 * 60_000) })]), 90);
	svc.notePollOpen("adm");
	// Опрос закрылся ПОТОМУ, что агент забрал работу на десять минут вперёд.
	svc.notePollClosed("adm", Date.now() + 10 * 60_000);

	const [view] = await svc.listAll();
	assert.equal(view.online, true);
});

test("тот же молчащий агент без взятой работы — не на связи", async () => {
	const svc = new AgentService(fakeDb([row({ id: "adm", role: "admin", last_seen_at: new Date(Date.now() - 10 * 60_000) })]), 90);
	svc.notePollOpen("adm");
	// Команд не было: опрос закрылся по своему сроку, и работающий агент открыл бы новый.
	svc.notePollClosed("adm");

	const [view] = await svc.listAll();
	// Решает heartbeat — он молчит дольше отведённого, значит службы нет.
	assert.equal(view.online, false);
});

// ── Публичный адрес публикации ─────────────────────────────────────────────
//
// Агент отдаёт адрес из привязки сайта IIS: при привязке без имени узла это
// `http://localhost/<база>` — честно и рабочее с самого сервера, но снаружи бесполезно.
// Публичное имя сервера задают настройкой, и оно подставляется ТОЛЬКО ДЛЯ ПОКАЗА.

test("публичный адрес: подменяется узел, путь остаётся агентским", () => {
	assert.equal(
		publicUrl("http://localhost/adinurip", "1c.buhprof.kz"),
		"http://1c.buhprof.kz/adinurip",
	);
});

test("публичный адрес: настройка вправе задать протокол и порт", () => {
	assert.equal(publicUrl("http://localhost/buh", "https://1c.buhprof.kz"), "https://1c.buhprof.kz/buh");
	assert.equal(publicUrl("http://localhost/buh", "1c.buhprof.kz:8080"), "http://1c.buhprof.kz:8080/buh");
});

test("публичный адрес: без настройки и при мусоре в ней отдаём ответ агента", () => {
	assert.equal(publicUrl("http://localhost/buh", null), "http://localhost/buh");
	assert.equal(publicUrl("http://localhost/buh", "   "), "http://localhost/buh");
	// Неразбираемая настройка не должна ломать показ.
	assert.equal(publicUrl("http://localhost/buh", "://"), "http://localhost/buh");
	// Нет адреса — нечего и подменять: база не опубликована.
	assert.equal(publicUrl(null, "1c.buhprof.kz"), null);
});
