// ─────────────────────────────────────────────────────────────────────────────
// Разовая ПОЛНАЯ пересборка регистров товаров и бухпроводок по ВСЕМ проведённым
// документам — включая закрытые периоды. Нужна после изменения базиса оценки
// (себестоимость без НДС, разнесение НДС 1420/3130 и т. п.): прежние движения и проводки
// хранят суммы по-старому.
//
// КР-11 аудита 27.09: прежняя версия шла по типам, а не по хронологии (списание могло
// считаться раньше своего прихода), не знала закрытий месяца, ГТД, списаний и
// оприходований, ссылалась на несуществующие модели кассы (кассовые ордера пропускались) и
// падала на первом сбое. Теперь это обёртка над services/recomputeCosting.js — той же
// картой документов и хронологией, что «Пересчитать себестоимость», но без нижней границы:
// по каждой организации, под её межпроцессной блокировкой пересчёта, сбой документа не
// обрывает проход (документ остаётся как был и попадает в отчёт).
//
// Для передатировки проводок закрытий месяца концом периода этот скрипт НЕ нужен — есть
// точечный prisma/redate-month-closes.js (закрытую историю себестоимости он не трогает).
//
// Запуск (из каталога backend):
//   DB_STATEMENT_TIMEOUT_MS=0 node prisma/reconcile-all.js [--org <uuid>]
// Идемпотентно (delete+rebuild). Делать на копии перед прод. Код выхода 1 — были сбои
// документов или организация занята пересчётом.
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "./prisma-client.js";
import { recomputeCosting, recomputeLockName } from "../services/recomputeCosting.js";
import { withClusterLock, closeClusterLocks } from "../services/clusterLock.js";

const args = process.argv.slice(2);
const ORG_ONLY = args.includes("--org") ? args[args.indexOf("--org") + 1] ?? null : null;

async function run() {
	const orgs = await prisma.organization.findMany({
		where: ORG_ONLY ? { uuid: ORG_ONLY } : {},
		select: { uuid: true, name: true },
		orderBy: { name: "asc" },
	});
	if (ORG_ONLY && !orgs.length) {
		console.error(`Организация ${ORG_ONLY} не найдена`);
		return 1;
	}
	let problems = 0;
	for (const org of orgs) {
		console.log(`${org.name} (${org.uuid}):`);
		try {
			// Без dateFilter — полная пересборка: регистр целиком, затем проводки, в хронологии.
			const res = await withClusterLock(recomputeLockName(org.uuid), () => recomputeCosting({ organizationUuid: org.uuid, dateFilter: null }),
				(msg, detail) => console.warn(`  ! ${msg}`, detail ?? ""));
			if (res === undefined) {
				problems++;
				console.log("  ! идёт пересчёт себестоимости этой организации — пропущена, запустите позже");
				continue;
			}
			console.log(`  регистр: документов ${res.registers}, проводки: документов ${res.entries}`);
			for (const f of res.failed ?? []) {
				problems++;
				console.log(`  ! не пересобран ${f.documentType} ${f.documentUuid}: ${f.message}`);
			}
		} catch (err) {
			problems++;
			console.error(`  ! ошибка организации: ${err?.message ?? err}`);
		}
	}
	console.log(problems ? `Готово с замечаниями: ${problems}` : "✅ Пересборка завершена");
	return problems ? 1 : 0;
}

run()
	.then(async (code) => { await closeClusterLocks(); await prisma.$disconnect(); process.exit(code); })
	.catch(async (e) => { console.error(e); await closeClusterLocks().catch(() => {}); await prisma.$disconnect().catch(() => {}); process.exit(1); });
