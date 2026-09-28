// ─────────────────────────────────────────────────────────────────────────────
// РАЗОВЫЙ СКРИПТ (КР-11 аудита 27.09): проводки проведённых «Закрытий месяца» —
// датой КОНЦА закрываемого периода.
//
// ЗАЧЕМ. До исправления У6 (аудит 26.09) проводки закрытия датировались датой документа:
// закрытие января, проведённое 01.08, стояло в оборотах августа, а ОСВ января оставалась
// без закрытия (финрезультат 0). Код исправлен (accountingPosting.entryDateOf), но уже
// проведённые закрытия хранят старые даты. «Пересчитать себестоимость» их не трогает:
// закрытые периоды пересчёт не затрагивает по определению — отсюда отдельный скрипт.
//
// ЧТО ДЕЛАЕТ. По каждой организации — под межпроцессной блокировкой пересчёта этой
// организации (фоновый пересчёт себестоимости в это время не идёт) и ОДНОЙ транзакцией на
// организацию — перепроводит все её проведённые закрытия по возрастанию конца периода:
// reconcileDocumentEntries("month_close", uuid) мимо границы запрета. Дата проводок — конец
// периода в поясе организации; суммы пересчитываются из текущих оборотов периода (закрытый
// период не менялся — суммы те же). Амортизация следующего закрытия опирается на
// накопленную предыдущими — поэтому строго по порядку. Сбой в организации откатывает все её
// закрытия (остаются как были), остальные организации обрабатываются.
//
// ЗАПУСК (из каталога backend, после `prisma migrate deploy` и перезапуска):
//   DB_STATEMENT_TIMEOUT_MS=0 node prisma/redate-month-closes.js --dry-run   — только отчёт
//   DB_STATEMENT_TIMEOUT_MS=0 node prisma/redate-month-closes.js             — выполнить
//   … --org <uuid>                                                           — одна организация
// --dry-run делает всё то же в транзакции и откатывает её — отчёт точный, запись не остаётся.
// Идемпотентно: повторный запуск ничего не меняет («без изменений»).
// Код выхода: 0 — всё сделано; 1 — были ошибки или организация была занята пересчётом.
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "./prisma-client.js";
import { reconcileDocumentEntries, entryDateOf } from "../services/accountingPosting.js";
import { withClusterLock, closeClusterLocks } from "../services/clusterLock.js";
import { recomputeLockName } from "../services/recomputeCosting.js";
import { orgTimeZone } from "../services/periodBounds.js";
import { r2 } from "../services/money.js";

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const ORG_ONLY = args.includes("--org") ? args[args.indexOf("--org") + 1] ?? null : null;

// Транзакция организации: закрытий может быть много, каждое — агрегат оборотов периода.
const TX_OPTIONS = { maxWait: 30_000, timeout: 30 * 60_000 };

/** Откат транзакции пробного прогона — не ошибка. */
class DryRunRollback extends Error {}

const fmtDay = (d, tz) => new Intl.DateTimeFormat("ru-RU", { timeZone: tz, day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(d));
const fmtMoment = (d, tz) => new Intl.DateTimeFormat("ru-RU", { timeZone: tz, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(d));
const money = (n) => r2(n).toFixed(2);

/** Проводки закрытия: сколько, какими датами, на какую сумму. */
async function entriesOf(client, uuid) {
	const rows = await client.accountingEntry.findMany({
		where: { documentType: "month_close", documentUuid: uuid },
		select: { date: true, amount: true },
	});
	return {
		count: rows.length,
		dates: [...new Set(rows.map((r) => new Date(r.date).getTime()))].sort((a, b) => a - b),
		total: r2(rows.reduce((s, r) => s + (Number(r.amount) || 0), 0)),
	};
}

async function processOrganization(org) {
	const closes = await prisma.monthClose.findMany({
		where: { organizationUuid: org.uuid, posted: true, deletedAt: null },
		orderBy: [{ periodEnd: "asc" }, { periodStart: "asc" }, { id: "asc" }],
		select: { uuid: true, number: true, date: true, periodStart: true, periodEnd: true, organizationUuid: true },
	});
	if (!closes.length) return { status: "empty", rows: [] };

	const rows = [];
	const run = () => prisma.$transaction(async (tx) => {
		for (const c of closes) {
			const before = await entriesOf(tx, c.uuid);
			await reconcileDocumentEntries("month_close", c.uuid, tx);
			const after = await entriesOf(tx, c.uuid);
			rows.push({ close: c, before, after, target: entryDateOf("month_close", c).getTime() });
		}
		if (DRY_RUN) throw new DryRunRollback();
	}, TX_OPTIONS);

	const locked = await withClusterLock(recomputeLockName(org.uuid), async () => {
		try {
			await run();
		} catch (err) {
			if (!(err instanceof DryRunRollback)) throw err;
		}
		return true;
	}, (msg, detail) => console.warn(`  ! ${msg}`, detail ?? ""));
	if (locked === undefined) return { status: "busy", rows: [] };
	return { status: "ok", rows };
}

/** Закрытие уже было датировано концом периода, и перепроведение ничего не поменяло. */
const unchanged = ({ before, after, target }) =>
	before.dates.length > 0 && before.dates.every((t) => t === target) && before.count === after.count && before.total === after.total;

function printRows(org, rows) {
	const tz = orgTimeZone(org.uuid);
	for (const row of rows) {
		const { close: c, before, after, target } = row;
		const label = `${c.number ? `№ ${c.number}` : "б/н"} за ${fmtDay(c.periodStart, tz)}–${fmtDay(c.periodEnd, tz)}`;
		const datesBefore = before.dates.map((t) => fmtMoment(t, tz)).join(", ") || "нет проводок";
		const same = unchanged(row);
		console.log(`  ${same ? "=" : "*"} ${label}: даты ${datesBefore} → ${fmtMoment(target, tz)}; ` +
			`проводок ${before.count} → ${after.count}; сумма ${money(before.total)} → ${money(after.total)}` +
			(same ? " — без изменений" : ""));
		if (before.total !== after.total) {
			console.log("      сумма изменилась: обороты периода менялись после закрытия — сверьте ОСВ периода");
		}
	}
}

async function main() {
	console.log(`Передатировка проводок «Закрытий месяца» концом периода${DRY_RUN ? " — ПРОБНЫЙ ПРОГОН, без записи" : ""}`);
	const orgs = await prisma.organization.findMany({
		where: ORG_ONLY ? { uuid: ORG_ONLY } : {},
		select: { uuid: true, name: true },
		orderBy: { name: "asc" },
	});
	if (ORG_ONLY && !orgs.length) {
		console.error(`Организация ${ORG_ONLY} не найдена`);
		return 1;
	}
	let changed = 0;
	let total = 0;
	let problems = 0;
	for (const org of orgs) {
		try {
			const res = await processOrganization(org);
			if (res.status === "empty") continue;
			console.log(`${org.name} (${org.uuid}):`);
			if (res.status === "busy") {
				problems++;
				console.log("  ! идёт пересчёт себестоимости этой организации — пропущена, запустите позже");
				continue;
			}
			printRows(org, res.rows);
			total += res.rows.length;
			changed += res.rows.filter((r) => !unchanged(r)).length;
		} catch (err) {
			problems++;
			console.log(`${org.name} (${org.uuid}):`);
			console.error(`  ! ошибка — закрытия организации оставлены как были: ${err?.message ?? err}`);
		}
	}
	console.log(`Итого: закрытий ${total}, ${DRY_RUN ? "будет изменено" : "изменено"} ${changed}, ошибок/пропусков ${problems}.` +
		(DRY_RUN ? " Это пробный прогон — в базе ничего не изменено." : ""));
	return problems ? 1 : 0;
}

main()
	.then(async (code) => { await closeClusterLocks(); await prisma.$disconnect(); process.exit(code); })
	.catch(async (err) => { console.error(err); await closeClusterLocks().catch(() => {}); await prisma.$disconnect().catch(() => {}); process.exit(1); });
