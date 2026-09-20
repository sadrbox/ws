// Токены баз для чата внутри 1С (СВ1) — служебная команда до мастера в панели (ПН1).
//
//   npm run base-token -- issue  --base <ключ базы | id> [--server <имя сервера>] [--org <uuid ERP>] [--by <кто>]
//   npm run base-token -- revoke --id <id токена> [--by <кто>]
//   npm run base-token -- list   [--base <ключ базы | id>]
//
// Токен печатается ОДИН раз, при выпуске, в stdout; в сервисе хранится только его хэш. Вставьте его в настройки
// чата в 1С (безопасное хранилище БСП). В журналы и тикеты не копировать.

import { loadConfig } from "../src/config.ts";
import { createPools } from "../src/db/pool.ts";
import { migrate } from "../src/db/migrate.ts";
import { createLogger } from "../src/logger.ts";
import { BaseTokenStore } from "../src/bases/tokens.ts";

const [cmd, ...rest] = process.argv.slice(2);
const args = new Map<string, string>();
for (let i = 0; i < rest.length; i += 2) args.set(rest[i].replace(/^--/, ""), rest[i + 1] ?? "");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function main(): Promise<number> {
	const cfg = loadConfig();
	const log = createLogger("warn");
	const { db, erp } = createPools(cfg.DATABASE_URL, cfg.ERP_DATABASE_URL);
	try {
		await migrate(db, log);
		const store = new BaseTokenStore(db);

		const findBase = async (ref: string): Promise<{ id: string; key: string; server: string } | null> => {
			const server = args.get("server") ?? null;
			const r = await db.query<{ id: string; key: string; server: string }>(
				`SELECT b.id, b.key, s.name AS server FROM bases b JOIN servers s ON s.id = b.server_id
				  WHERE (b.id::text = $1 OR lower(b.key) = lower($1)) AND ($2::text IS NULL OR s.name = $2)`, [ref, server]);
			if (r.rows.length > 1) {
				console.error(`Базу «${ref}» знают несколько серверов: ${r.rows.map((x) => x.server).join(", ")} — уточните --server`);
				return null;
			}
			return r.rows[0] ?? null;
		};

		if (cmd === "issue") {
			const ref = args.get("base");
			if (!ref) { console.error("Нужен --base <ключ базы | id>"); return 2; }
			const base = await findBase(ref);
			if (!base) { console.error(`База «${ref}» не найдена`); return 1; }
			const org = args.get("org") || null;
			if (org && !UUID.test(org)) { console.error("--org: UUID организации ERP"); return 2; }
			const t = await store.issue({ baseId: base.id, organizationUuid: org, createdBy: args.get("by") || "base-token (служебная команда)" });
			console.log(`База: ${base.key} (сервер ${base.server}), организация ERP: ${t.organizationUuid}`);
			console.log(`Id токена: ${t.id}`);
			console.log(`Токен (показывается один раз): ${t.token}`);
			return 0;
		}
		if (cmd === "revoke") {
			const id = args.get("id") ?? "";
			if (!UUID.test(id)) { console.error("Нужен --id <id токена>"); return 2; }
			const ok = await store.revoke(id, args.get("by") || "base-token (служебная команда)");
			console.log(ok ? "Токен отозван" : "Токен не найден или уже отозван");
			return ok ? 0 : 1;
		}
		if (cmd === "list") {
			const ref = args.get("base");
			const base = ref ? await findBase(ref) : null;
			if (ref && !base) { console.error(`База «${ref}» не найдена`); return 1; }
			for (const t of await store.list(base?.id ?? null)) {
				console.log(`${t.id}  ${t.baseKey}  org ${t.organizationUuid}  выпущен ${t.createdAt.toISOString()} (${t.createdBy})${t.revokedAt ? `  ОТОЗВАН ${t.revokedAt.toISOString()} (${t.revokedBy ?? ""})` : ""}`);
			}
			return 0;
		}
		console.error("Команда: issue | revoke | list (см. заголовок tools/base_token.ts)");
		return 2;
	} finally {
		await Promise.all([db.end(), erp.end()]);
	}
}

main().then((code) => process.exit(code), (e) => {
	console.error("Ошибка:", e instanceof Error ? e.message : e);
	process.exit(1);
});
