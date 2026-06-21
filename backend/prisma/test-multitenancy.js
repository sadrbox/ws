// ─────────────────────────────────────────────────────────────────────────────
// Тест мультитенантности (изоляция данных по организациям).
//
// Создаёт изолированный мок-набор: 10 организаций, по 5 сотрудников и 5 пользователей
// в каждой (всего 50 «обычных» юзеров), плюс спец-пользователи для проверки
// мульти-орг доступа и граничных случаев. Затем прогоняет ПРОДАКШН-функции изоляции
// (tenantMiddleware → tenantFilter → checkOwnership из utils/auth.js) от лица каждого
// пользователя и проверяет, что НИ ОДИН не видит чужих данных.
//
// Все тестовые сущности помечены зарезервированными префиксами и не пересекаются с
// реальными данными (и с генератором seed-testdata.js, у которого префикс «9990»):
//   орг BIN «9995…», контрагент BIN «9996…», сотрудник ИИН «9997…», юзер «mt_…».
//
// Запуск:            node prisma/test-multitenancy.js          (создать + протестировать, данные ОСТАЮТСЯ)
// Только очистка:    node prisma/test-multitenancy.js --cleanup
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "./prisma-client.js";
import bcrypt from "bcryptjs";
import { tenantMiddleware, tenantFilter, checkOwnership } from "../utils/auth.js";

const ORG_BIN_PREFIX = "9995";
const CP_BIN_PREFIX = "9996";
const EMP_IIN_PREFIX = "9997";
const USER_PREFIX = "mt_";
const PASSWORD = "Test1234!";
const N_ORGS = 10;
const USERS_PER_ORG = 5;
const EMP_PER_ORG = 5;
const CP_PER_ORG = 3;

const pad8 = (n) => String(n).padStart(8, "0");

// ─── Очистка прежнего тест-набора (FK-безопасный порядок) ────────────────────
async function cleanup() {
	const orgs = await prisma.organization.findMany({ where: { bin: { startsWith: ORG_BIN_PREFIX } }, select: { uuid: true } });
	const orgUuids = orgs.map((o) => o.uuid);
	const users = await prisma.user.findMany({ where: { username: { startsWith: USER_PREFIX } }, select: { uuid: true } });
	const userUuids = users.map((u) => u.uuid);

	if (userUuids.length) await prisma.userSetting.deleteMany({ where: { userUuid: { in: userUuids } } });
	if (orgUuids.length) await prisma.userSetting.deleteMany({ where: { organizationUuid: { in: orgUuids } } });
	await prisma.user.deleteMany({ where: { username: { startsWith: USER_PREFIX } } });
	if (orgUuids.length) await prisma.contract.deleteMany({ where: { organizationUuid: { in: orgUuids } } });
	await prisma.counterparty.deleteMany({ where: { bin: { startsWith: CP_BIN_PREFIX } } });
	await prisma.employee.deleteMany({ where: { iin: { startsWith: EMP_IIN_PREFIX } } });
	await prisma.organization.deleteMany({ where: { bin: { startsWith: ORG_BIN_PREFIX } } });
	return { orgs: orgUuids.length, users: userUuids.length };
}

// ─── Создание мок-данных ──────────────────────────────────────────────────────
async function createData() {
	const passwordHash = await bcrypt.hash(PASSWORD, 12); // один хеш на всех тест-юзеров

	// 10 организаций.
	const orgs = [];
	for (let i = 1; i <= N_ORGS; i++) {
		const org = await prisma.organization.create({
			data: { bin: ORG_BIN_PREFIX + pad8(i), name: `MT Орг ${i}`, legalName: `ТОО «MT Орг ${i}»` },
		});
		orgs.push(org);
	}

	// Сотрудники, контрагенты, пользователи + userSettings по каждой орг.
	let empSeq = 0, cpSeq = 0;
	const baseUsers = [];
	for (let oi = 0; oi < N_ORGS; oi++) {
		const org = orgs[oi];
		// 5 сотрудников.
		for (let e = 1; e <= EMP_PER_ORG; e++) {
			empSeq++;
			await prisma.employee.create({
				data: { iin: EMP_IIN_PREFIX + pad8(empSeq), fullName: `Сотрудник ${oi + 1}-${e}`, organizationUuid: org.uuid },
			});
		}
		// 3 контрагента (org-приватные).
		for (let c = 1; c <= CP_PER_ORG; c++) {
			cpSeq++;
			await prisma.counterparty.create({
				data: { bin: CP_BIN_PREFIX + pad8(cpSeq), name: `Контрагент ${oi + 1}-${c}`, organizationUuid: org.uuid },
			});
		}
		// 2 договора (org-приватные) — для проверки изоляции списка договоров (Fix 1).
		for (let k = 1; k <= 2; k++) {
			await prisma.contract.create({
				data: { name: `MT Договор ${oi + 1}-${k}`, organizationUuid: org.uuid },
			});
		}
		// 5 пользователей: u1 — admin, остальные — member. Активная орг = своя.
		for (let u = 1; u <= USERS_PER_ORG; u++) {
			const username = `${USER_PREFIX}o${oi + 1}_u${u}`;
			const user = await prisma.user.create({
				data: { username, email: `${username}@test.local`, password: passwordHash, organizationUuid: org.uuid },
			});
			await prisma.userSetting.create({
				data: { userUuid: user.uuid, organizationUuid: org.uuid, role: u === 1 ? "admin" : "member" },
			});
			baseUsers.push({ username, user, orgIndex: oi });
		}
	}

	// 2 ГЛОБАЛЬНЫХ контрагента (organizationUuid = null) — общие для всех орг.
	for (let g = 1; g <= 2; g++) {
		cpSeq++;
		await prisma.counterparty.create({ data: { bin: CP_BIN_PREFIX + pad8(cpSeq), name: `Глобальный контрагент ${g}`, organizationUuid: null } });
	}

	// Спец-пользователи (мульти-орг доступ + граничные случаи).
	const special = {};
	async function mkUser(username, activeOrgUuid, allowedOrgUuids, isSuperAdmin = false) {
		const user = await prisma.user.create({
			data: { username, email: `${username}@test.local`, password: passwordHash, organizationUuid: activeOrgUuid, isSuperAdmin },
		});
		for (const orgUuid of allowedOrgUuids) {
			await prisma.userSetting.create({ data: { userUuid: user.uuid, organizationUuid: orgUuid, role: "member" } });
		}
		return user;
	}
	// Региональный: активная орг1, доступ к орг1/2/3 → должен видеть ТОЛЬКО активную (орг1).
	special.regional = await mkUser(`${USER_PREFIX}regional`, orgs[0].uuid, [orgs[0].uuid, orgs[1].uuid, orgs[2].uuid]);
	// Мульти без активной: доступ к орг4/5, активной нет → видит обе.
	special.multi = await mkUser(`${USER_PREFIX}multi`, null, [orgs[3].uuid, orgs[4].uuid]);
	// «Битая» активная: активная орг7 НЕ входит в доступ [орг8] → middleware сбросит активную, видит только орг8.
	special.badactive = await mkUser(`${USER_PREFIX}badactive`, orgs[6].uuid, [orgs[7].uuid]);
	// Без доступа: ни активной, ни userSettings → видит только глобальные (org=null).
	special.noaccess = await mkUser(`${USER_PREFIX}noaccess`, null, []);
	// Суперадмин: видит всё.
	special.super = await mkUser(`${USER_PREFIX}super`, null, [], true);

	return { orgs, baseUsers, special };
}

// ─── Хелперы теста ────────────────────────────────────────────────────────────
// Воспроизводит продакшн-цепочку: tenantMiddleware заполняет req.user из БД.
async function buildReq(userUuid) {
	const req = { user: { uuid: userUuid }, method: "GET", query: {} };
	await new Promise((resolve) => { void tenantMiddleware(req, {}, resolve); });
	return req;
}

const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok, detail });

// ─── Прогон проверок ──────────────────────────────────────────────────────────
async function runTests(orgs) {
	const orgUuid = orgs.map((o) => o.uuid);
	const orgUuidSet = new Set(orgUuid);

	// Все тест-пользователи из БД.
	const users = await prisma.user.findMany({
		where: { username: { startsWith: USER_PREFIX } },
		select: { uuid: true, username: true, isSuperAdmin: true, organizationUuid: true },
	});

	// Удобный доступ к тест-контрагентам и сотрудникам.
	const testCpWhere = { bin: { startsWith: CP_BIN_PREFIX } };
	const testEmpWhere = { iin: { startsWith: EMP_IIN_PREFIX } };

	// Глобальная проверка: ВСЕГО тест-контрагентов 30 орг-приватных + 2 глобальных.
	const totalCp = await prisma.counterparty.count({ where: testCpWhere });
	check("Создано тест-контрагентов = 32 (30 орг + 2 глобальных)", totalCp === 32, `факт: ${totalCp}`);

	// ── КЛЮЧЕВАЯ проверка изоляции: НИ ОДИН пользователь не видит чужой орг ──
	let leaks = 0;
	for (const u of users) {
		const req = await buildReq(u.uuid);
		const allowed = new Set(req.user.allowedOrgUuids ?? []);
		const filter = tenantFilter(req);

		// Список контрагентов, который реально вернёт API (та же логика).
		const cps = await prisma.counterparty.findMany({
			where: { ...filter, ...testCpWhere },
			select: { uuid: true, organizationUuid: true },
		});

		// Утечка = возвращён контрагент чужой орг (не глобальный, не из allowed, не суперадмин).
		const leaked = cps.filter((c) => {
			const o = c.organizationUuid;
			if (o === null) return false; // глобальный — допустимо
			if (req.user.isSuperAdmin) return false; // суперадмин видит всё легитимно
			if (allowed.has(o)) return false; // своя орг
			return true; // ЧУЖАЯ орг → утечка
		});
		if (leaked.length) {
			leaks++;
			const orgsLeaked = [...new Set(leaked.map((c) => c.organizationUuid))];
			check(`УТЕЧКА у ${u.username}`, false, `видит чужие орг: ${orgsLeaked.join(", ")}`);
		}
	}
	check(`Изоляция списков (контрагенты): 0 утечек среди ${users.length} пользователей`, leaks === 0, `утечек: ${leaks}`);

	// ── Fix 1: список ДОГОВОРОВ теперь изолирован (раньше отдавал все орг) ──
	const testContractWhere = { name: { startsWith: "MT Договор" } };
	let contractLeaks = 0;
	for (const u of users) {
		const req = await buildReq(u.uuid);
		const allowed = new Set(req.user.allowedOrgUuids ?? []);
		const rows = await prisma.contract.findMany({ where: { ...tenantFilter(req), ...testContractWhere }, select: { organizationUuid: true } });
		const leaked = rows.filter((c) => c.organizationUuid !== null && !req.user.isSuperAdmin && !allowed.has(c.organizationUuid));
		if (leaked.length) contractLeaks++;
	}
	check(`Изоляция списков (договоры, Fix 1): 0 утечек среди ${users.length} пользователей`, contractLeaks === 0, `утечек: ${contractLeaks}`);
	{
		const u = users.find((x) => x.username === `${USER_PREFIX}o1_u1`);
		const req = await buildReq(u.uuid);
		const rows = await prisma.contract.findMany({ where: { ...tenantFilter(req), ...testContractWhere }, select: { organizationUuid: true } });
		check("Юзер орг1 видит ровно свои 2 договора (не все 20)", rows.length === 2 && rows.every((c) => c.organizationUuid === orgUuid[0]), `count=${rows.length}`);
	}

	// ── Точное скоупирование по сценариям ──
	const byName = Object.fromEntries(users.map((u) => [u.username, u]));
	async function visibleCpOrgs(username) {
		const u = byName[username];
		const req = await buildReq(u.uuid);
		const cps = await prisma.counterparty.findMany({ where: { ...tenantFilter(req), ...testCpWhere }, select: { organizationUuid: true } });
		return { req, count: cps.length, orgs: new Set(cps.map((c) => c.organizationUuid)) };
	}

	// Обычный юзер орг1 (mt_o1_u1): видит ровно 3 контрагента своей орг1.
	{
		const v = await visibleCpOrgs(`${USER_PREFIX}o1_u1`);
		check("Юзер орг1 видит ровно свои 3 контрагента", v.count === CP_PER_ORG && v.orgs.size === 1 && v.orgs.has(orgUuid[0]), `count=${v.count}`);
		check("Юзер орг1 НЕ видит контрагентов орг2", !v.orgs.has(orgUuid[1]), "");
	}
	// Региональный (активная орг1, доступ 1/2/3): видит ТОЛЬКО активную орг1 (3).
	{
		const v = await visibleCpOrgs(`${USER_PREFIX}regional`);
		check("Региональный (активная орг1) видит только орг1 = 3", v.count === 3 && v.orgs.size === 1 && v.orgs.has(orgUuid[0]), `count=${v.count}, orgs=${v.orgs.size}`);
	}
	// Мульти без активной (доступ 4/5): видит обе = 6.
	{
		const v = await visibleCpOrgs(`${USER_PREFIX}multi`);
		check("Мульти без активной (орг4+5) видит 6", v.count === 6 && v.orgs.has(orgUuid[3]) && v.orgs.has(orgUuid[4]) && v.orgs.size === 2, `count=${v.count}`);
	}
	// Битая активная (орг7 не в доступе [орг8]): middleware сбросил активную → видит орг8 = 3.
	{
		const v = await visibleCpOrgs(`${USER_PREFIX}badactive`);
		const activeReset = v.req.user.organizationUuid === null;
		check("Битая активная сброшена middleware (security)", activeReset, `active=${v.req.user.organizationUuid}`);
		check("Битая активная видит только орг8 = 3", v.count === 3 && v.orgs.size === 1 && v.orgs.has(orgUuid[7]), `count=${v.count}`);
	}
	// Без доступа: видит только глобальные (org=null) = 2, ни одной орг-приватной.
	{
		const v = await visibleCpOrgs(`${USER_PREFIX}noaccess`);
		const onlyGlobal = [...v.orgs].every((o) => o === null);
		check("Без доступа видит только глобальные (2), 0 орг-приватных", v.count === 2 && onlyGlobal, `count=${v.count}`);
	}
	// Суперадмин: видит все 32 тест-контрагента.
	{
		const v = await visibleCpOrgs(`${USER_PREFIX}super`);
		check("Суперадмин видит все 32 тест-контрагента", v.count === 32, `count=${v.count}`);
	}

	// ── Сотрудники: каждый обычный юзер видит ровно 5 сотрудников своей орг ──
	{
		let empOk = true, empDetail = "";
		for (let oi = 0; oi < N_ORGS; oi++) {
			const u = byName[`${USER_PREFIX}o${oi + 1}_u1`];
			const req = await buildReq(u.uuid);
			const emps = await prisma.employee.findMany({ where: { ...tenantFilter(req), ...testEmpWhere }, select: { organizationUuid: true } });
			const foreign = emps.filter((e) => e.organizationUuid !== orgUuid[oi]);
			if (emps.length !== EMP_PER_ORG || foreign.length) { empOk = false; empDetail = `орг${oi + 1}: count=${emps.length}, чужих=${foreign.length}`; break; }
		}
		check("Сотрудники: каждый юзер видит ровно свои 5, без чужих", empOk, empDetail);
	}

	// ── checkOwnership: единичный доступ к записи ──
	{
		const u1 = byName[`${USER_PREFIX}o1_u1`];
		const req1 = await buildReq(u1.uuid);
		const cpOrg1 = await prisma.counterparty.findFirst({ where: { organizationUuid: orgUuid[0], ...testCpWhere } });
		const cpOrg2 = await prisma.counterparty.findFirst({ where: { organizationUuid: orgUuid[1], ...testCpWhere } });
		const cpGlobal = await prisma.counterparty.findFirst({ where: { organizationUuid: null, ...testCpWhere } });
		check("checkOwnership: юзер орг1 → своя запись = доступ", checkOwnership(cpOrg1, req1) === true, "");
		check("checkOwnership: юзер орг1 → чужая (орг2) запись = ОТКАЗ", checkOwnership(cpOrg2, req1) === false, "");
		check("checkOwnership: юзер орг1 → глобальная запись = доступ", checkOwnership(cpGlobal, req1) === true, "");

		const sup = byName[`${USER_PREFIX}super`];
		const reqS = await buildReq(sup.uuid);
		check("checkOwnership: суперадмин → любая запись = доступ", checkOwnership(cpOrg2, reqS) === true, "");
	}
}

// ─── main ─────────────────────────────────────────────────────────────────────
async function main() {
	const cleanupOnly = process.argv.includes("--cleanup");
	if (cleanupOnly) {
		const r = await cleanup();
		console.log(`Очищено: организаций ${r.orgs}, пользователей ${r.users}.`);
		return;
	}

	console.log("Очистка прежнего тест-набора…");
	await cleanup();
	console.log("Создание мок-данных (10 орг × 5 юзеров/сотрудников + спец-юзеры)…");
	const { orgs } = await createData();
	console.log("Прогон проверок изоляции (продакшн tenantFilter/checkOwnership)…\n");
	await runTests(orgs);

	// Отчёт.
	const passed = results.filter((r) => r.ok).length;
	const failed = results.filter((r) => !r.ok);
	for (const r of results) {
		console.log(`${r.ok ? "✓" : "✗"} ${r.name}${r.detail ? `  — ${r.detail}` : ""}`);
	}
	console.log(`\nИтог: ${passed}/${results.length} проверок пройдено.`);

	// По умолчанию ЧИСТИМ за собой (мок-данные ломают интеграционный test-suite,
	// который ходит в ту же БД). С флагом --keep — оставляем для ручного логина.
	if (process.argv.includes("--keep")) {
		console.log("\nМок-данные ОСТАВЛЕНЫ в БД (--keep) для ручной проверки логина:");
		console.log(`  Логин: mt_o<1..10>_u<1..5> (напр. mt_o1_u1), пароль: ${PASSWORD}`);
		console.log("  Мульти-орг: mt_regional, mt_multi; граничные: mt_badactive, mt_noaccess, mt_super");
		console.log("  ⚠ Перед запуском `node --test` выполните очистку: node prisma/test-multitenancy.js --cleanup");
	} else {
		await cleanup();
		console.log("\nМок-данные очищены (БД чистая). Для ручного логина: запустите с флагом --keep.");
	}

	if (failed.length) process.exitCode = 1;
}

main()
	.catch((e) => { console.error(e); process.exitCode = 1; })
	.finally(() => prisma.$disconnect());
