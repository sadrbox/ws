// Проверка GET /v1/status на живом сервисе (панель статуса чата): печатает сводку и возвращает
// 0, если ответ корректен по форме. Не требует LLM.
//
//   node --experimental-strip-types --env-file=.env --env-file=.env.local tools/status_check.ts [--base URL] [--org uuid]

import jwt from "jsonwebtoken";
import { loadConfig } from "../src/config.ts";
import { createPools } from "../src/db/pool.ts";

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i++) if (process.argv[i].startsWith("--")) args.set(process.argv[i].slice(2), process.argv[++i]);
const BASE = args.get("base") ?? "http://192.168.1.112:3100";
const ORG = args.get("org") ?? "a1410911-7421-45da-9632-7e4fc48e91c2";

async function main(): Promise<number> {
	const cfg = loadConfig({ ...process.env, LOG_LEVEL: "warn" });
	const { db, erp } = createPools(cfg.DATABASE_URL, cfg.ERP_DATABASE_URL);
	const u = await erp.query<{ uuid: string }>(`SELECT u.uuid FROM users u JOIN access_rights a ON a."userUuid" = u.uuid WHERE a."organizationUuid" = $1 AND u."deletedAt" IS NULL ORDER BY (a.role = 'admin') DESC, u.id LIMIT 1`, [ORG]);
	const token = jwt.sign({ uuid: u.rows[0].uuid }, cfg.JWT_SECRET, { expiresIn: "1h" });
	const r = await fetch(`${BASE}/v1/status`, { headers: { authorization: `Bearer ${token}` } });
	const env = (await r.json()) as { success: boolean; data?: Record<string, unknown>; error?: unknown };
	await Promise.all([db.end(), erp.end()]);
	console.log(`HTTP ${r.status}`, JSON.stringify(env.data ?? env.error, null, 1));
	const d = env.data as { service?: { version?: string }; llm?: { ok?: boolean }; agent?: { configured?: boolean }; onec?: { reachable?: boolean } } | undefined;
	const ok = r.status === 200 && env.success && typeof d?.service?.version === "string" && typeof d?.llm?.ok === "boolean" && typeof d?.agent?.configured === "boolean" && typeof d?.onec?.reachable === "boolean";
	console.log(ok ? "PASS: /v1/status" : "FAIL: /v1/status");
	return ok ? 0 : 1;
}

main().then((rc) => process.exit(rc)).catch((e) => { console.error("FATAL:", e instanceof Error ? e.message : e); process.exit(2); });
