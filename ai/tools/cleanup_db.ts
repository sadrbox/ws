// Очистка БД AI-сервиса от тестовых данных организации: диалоги (с сообщениями и файлами —
// каскадом), распознанные выписки, исполненные команды. Агенты и журнал аудита не трогаются.
// По умолчанию только считает; удаляет с --apply.
//
//   node --experimental-strip-types --env-file=.env --env-file=.env.local tools/cleanup_db.ts [--org uuid] [--older-than-days N] [--apply]
//
// Запускать на сервере (192.168.1.112), где доступна БД: ssh support@192.168.1.112 'bash -lc "cd /mnt/ws/app/ai && node … tools/cleanup_db.ts --apply"'.

import { loadConfig } from "../src/config.ts";
import { createPools } from "../src/db/pool.ts";

const args = new Map<string, string>();
const flags = new Set<string>();
for (let i = 2; i < process.argv.length; i++) {
	const a = process.argv[i];
	if (!a.startsWith("--")) continue;
	const next = process.argv[i + 1];
	if (next && !next.startsWith("--")) { args.set(a.slice(2), next); i++; } else flags.add(a.slice(2));
}
const ORG = args.get("org") ?? "a1410911-7421-45da-9632-7e4fc48e91c2";
const DAYS = Number(args.get("older-than-days") ?? "0");
const APPLY = flags.has("apply");

async function main(): Promise<number> {
	const cfg = loadConfig({ ...process.env, LOG_LEVEL: "warn" });
	const { db, erp } = createPools(cfg.DATABASE_URL, cfg.ERP_DATABASE_URL);
	const age = DAYS > 0 ? `AND created_at < now() - interval '${Math.floor(DAYS)} days'` : "";
	const count = async (sql: string) => Number((await db.query<{ n: string }>(sql, [ORG])).rows[0]?.n ?? 0);
	const plan = [
		{ name: "chat_files", sql: `FROM chat_files WHERE organization_uuid = $1 ${age}` },
		{ name: "bank_statements", sql: `FROM bank_statements WHERE organization_uuid = $1 ${age}` },
		{ name: "conversations (+messages каскадом)", sql: `FROM conversations WHERE organization_uuid = $1 ${age}` },
		{ name: "commands (завершённые)", sql: `FROM commands WHERE organization_uuid = $1 AND state NOT IN ('queued', 'dispatched') ${age}` },
	];
	console.log(`организация ${ORG}${DAYS > 0 ? `, старше ${DAYS} дн.` : ""}${APPLY ? " — УДАЛЕНИЕ" : " — dry-run"}`);
	for (const p of plan) {
		const n = await count(`SELECT count(*) AS n ${p.sql}`);
		console.log(`  ${p.name}: ${n}`);
		if (APPLY && n > 0) await db.query(`DELETE ${p.sql}`, [ORG]);
	}
	await Promise.all([db.end(), erp.end()]);
	if (!APPLY) console.log("(dry-run: добавьте --apply, чтобы удалить)");
	return 0;
}

main().then((rc) => process.exit(rc)).catch((e) => { console.error("FATAL:", e instanceof Error ? e.message : e); process.exit(2); });
