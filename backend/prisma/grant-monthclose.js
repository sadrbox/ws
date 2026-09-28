// ─────────────────────────────────────────────────────────────────────────────
// РАЗОВЫЙ СКРИПТ КР-19 аудита 27.09: право «Закрытие месяца» (MonthClose) тем, у кого есть право на
// проводки (AccountingEntry).
//
// ЗАЧЕМ. Маршрут `month-closes` впервые попал под проверку прав (utils/routeModels.js: MonthClose).
// Профили — шаблоны: при назначении они разворачиваются в строки access_permissions, и у старых
// назначений строки MonthClose нет вовсе. Не-админ бухгалтер со старым профилем получает 403 на
// закрытии месяца, пока профиль не переназначат. Новые назначения не затронуты: профиль «Бухгалтер»
// (и «Обслуживающий бухгалтер», «Владелец») даёт MonthClose = full сам (services/permissionProfiles.js).
//
// ЧТО ДЕЛАЕТ. Каждой паре (пользователь, организация) с правом AccountingEntry уровня readonly/full
// выдаёт MonthClose того же уровня. Уже выданное НЕ ПОНИЖАЕТ: у кого MonthClose выше — не трогаем.
// Глобальные права (organizationUuid = null) — так же, парой (пользователь, null). Удалённые
// пользователи и снятые строки права (deletedAt) не учитываются.
//
// ЗАПУСК (backend/, сначала проверка — ничего не пишет):
//   node prisma/grant-monthclose.js --dry-run
//   node prisma/grant-monthclose.js
// Повторный запуск безопасен: второй раз добавлять и повышать уже нечего.
// ─────────────────────────────────────────────────────────────────────────────
import { pathToFileURL } from "node:url";

export const SOURCE_MODEL = "AccountingEntry";
export const TARGET_MODEL = "MonthClose";

const RANK = { none: 0, readonly: 1, full: 2 };
/** Уровень доступа как число; неизвестное значение — как «нет доступа». */
export const rankOf = (level) => RANK[level] ?? 0;

const keyOf = (r) => `${r.userUuid}|${r.organizationUuid ?? ""}`;

/**
 * План выдачи — чистая функция (проверяется тестом без базы).
 * @param {{userUuid:string, organizationUuid:string|null, accessLevel:string}[]} sourceRows — права AccountingEntry
 * @param {{userUuid:string, organizationUuid:string|null, accessLevel:string}[]} targetRows — права MonthClose
 * @returns {{ create: object[], raise: object[], unchanged: object[] }}
 *   create — строки MonthClose, которых нет; raise — есть, но ниже (from → to); unchanged — уже не ниже.
 */
export function planMonthCloseGrants(sourceRows, targetRows) {
	// Глобальная пара (организация null) уникальным индексом не защищена — дублей может быть
	// несколько: берём наибольший уровень с обеих сторон.
	const want = new Map();
	for (const r of sourceRows) {
		const k = keyOf(r);
		const prev = want.get(k);
		if (!prev || rankOf(r.accessLevel) > rankOf(prev.accessLevel)) want.set(k, r);
	}
	const have = new Map();
	for (const r of targetRows) {
		const k = keyOf(r);
		const prev = have.get(k);
		if (!prev || rankOf(r.accessLevel) > rankOf(prev.accessLevel)) have.set(k, r);
	}
	const create = [];
	const raise = [];
	const unchanged = [];
	for (const [k, src] of want) {
		const to = src.accessLevel;
		if (rankOf(to) === 0) continue; // AccountingEntry «нет доступа» — выдавать нечего
		const base = { userUuid: src.userUuid, organizationUuid: src.organizationUuid ?? null, user: src.user, organization: src.organization };
		const cur = have.get(k);
		if (!cur) create.push({ ...base, to });
		else if (rankOf(cur.accessLevel) < rankOf(to)) raise.push({ ...base, from: cur.accessLevel, to });
		else unchanged.push({ ...base, level: cur.accessLevel });
	}
	return { create, raise, unchanged };
}

/** Уровни «не ниже» данного — их повышение не трогает (не понижать выданное). */
const atOrAbove = (level) => Object.keys(RANK).filter((l) => RANK[l] >= rankOf(level));

const who = (r) => `${r.user?.username ?? r.userUuid} @ ${r.organizationUuid ? (r.organization?.name ?? r.organizationUuid) : "(глобально)"}`;

async function main() {
	const args = process.argv.slice(2);
	const unknown = args.filter((a) => a !== "--dry-run");
	if (unknown.length) {
		console.error(`Неизвестные параметры: ${unknown.join(" ")}\nЗапуск: node prisma/grant-monthclose.js [--dry-run]`);
		process.exit(2);
	}
	const dryRun = args.includes("--dry-run");
	if (!process.env.DATABASE_URL) {
		// prisma-client.js сам читает .env; без адреса базы работать не с чем.
		await import("dotenv/config");
		if (!process.env.DATABASE_URL) {
			console.error("DATABASE_URL не задан");
			process.exit(2);
		}
	}
	const { prisma } = await import("./prisma-client.js");
	try {
		const select = {
			userUuid: true, organizationUuid: true, accessLevel: true,
			user: { select: { username: true } },
			organization: { select: { name: true } },
		};
		const sourceRows = await prisma.accessPermission.findMany({
			where: { modelName: SOURCE_MODEL, deletedAt: null, accessLevel: { in: ["readonly", "full"] }, user: { deletedAt: null } },
			select,
		});
		const targetRows = await prisma.accessPermission.findMany({ where: { modelName: TARGET_MODEL }, select });
		const plan = planMonthCloseGrants(sourceRows, targetRows);

		console.log(`КР-19: право ${TARGET_MODEL} по праву ${SOURCE_MODEL}${dryRun ? " — ПРОВЕРКА, ничего не записывается" : ""}`);
		console.log(`  строк ${SOURCE_MODEL} (readonly/full): ${sourceRows.length}`);
		console.log(`  добавить ${TARGET_MODEL}: ${plan.create.length}; повысить: ${plan.raise.length}; уже не ниже: ${plan.unchanged.length}`);
		for (const r of plan.create) console.log(`  + ${who(r)}: ${TARGET_MODEL} → ${r.to}`);
		for (const r of plan.raise) console.log(`  ↑ ${who(r)}: ${TARGET_MODEL} ${r.from} → ${r.to}`);

		if (dryRun) {
			console.log("Проверка окончена: ничего не записано. Выполнить — тот же запуск без --dry-run.");
			return;
		}
		if (!plan.create.length && !plan.raise.length) {
			console.log("Делать нечего.");
			return;
		}
		const done = await prisma.$transaction(async (tx) => {
			const created = plan.create.length
				? (await tx.accessPermission.createMany({
					data: plan.create.map((r) => ({ userUuid: r.userUuid, organizationUuid: r.organizationUuid, modelName: TARGET_MODEL, accessLevel: r.to })),
					skipDuplicates: true,
				})).count
				: 0;
			let raised = 0;
			for (const r of plan.raise) {
				raised += (await tx.accessPermission.updateMany({
					where: { userUuid: r.userUuid, organizationUuid: r.organizationUuid, modelName: TARGET_MODEL, accessLevel: { notIn: atOrAbove(r.to) } },
					data: { accessLevel: r.to },
				})).count;
			}
			return { created, raised };
		}, { maxWait: 10_000, timeout: 120_000 });
		console.log(`Готово: добавлено ${done.created}, повышено ${done.raised}.`);
	} finally {
		await prisma.$disconnect();
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((e) => {
		console.error("Ошибка:", e?.message || e);
		process.exit(1);
	});
}
