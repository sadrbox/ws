// Проверка лимита ходов чата без вызова модели: пустое тело даёт 400 (валидация после лимитера),
// и после RATE_LIMIT_CHAT_PER_MIN запросов подряд должен прийти 429 RATE_LIMITED с Retry-After.
//
//   node --experimental-strip-types --env-file=.env --env-file=.env.local tools/ratelimit_check.ts [--base URL] [--org uuid] [--limit 30]

import jwt from "jsonwebtoken";
import { loadConfig } from "../src/config.ts";
import { createPools } from "../src/db/pool.ts";

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i++) if (process.argv[i].startsWith("--")) args.set(process.argv[i].slice(2), process.argv[++i]);
const BASE = args.get("base") ?? "http://192.168.1.112:3100";
const ORG = args.get("org") ?? "a1410911-7421-45da-9632-7e4fc48e91c2";

async function main(): Promise<number> {
	const cfg = loadConfig({ ...process.env, LOG_LEVEL: "warn" });
	const limit = Number(args.get("limit") ?? cfg.RATE_LIMIT_CHAT_PER_MIN);
	const { db, erp } = createPools(cfg.DATABASE_URL, cfg.ERP_DATABASE_URL);
	const u = await erp.query<{ uuid: string }>(`SELECT u.uuid FROM users u JOIN access_rights a ON a."userUuid" = u.uuid WHERE a."organizationUuid" = $1 AND u."deletedAt" IS NULL ORDER BY (a.role = 'admin') DESC, u.id LIMIT 1`, [ORG]);
	const token = jwt.sign({ uuid: u.rows[0].uuid }, cfg.JWT_SECRET, { expiresIn: "1h" });
	await Promise.all([db.end(), erp.end()]);
	if (limit <= 0) { console.log("PASS: лимит выключен (0) — проверять нечего"); return 0; }
	const statuses: number[] = [];
	for (let i = 0; i < limit + 1; i++) {
		const r = await fetch(`${BASE}/v1/chat`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ organizationUuid: ORG }) });
		statuses.push(r.status);
		if (r.status === 429) {
			const body = (await r.json()) as { error?: { code?: string; retryAfterSec?: number } };
			console.log(`запрос ${i + 1}: 429 ${body.error?.code} retryAfterSec=${body.error?.retryAfterSec} Retry-After=${r.headers.get("retry-after")}`);
			break;
		}
	}
	const first429 = statuses.indexOf(429);
	// Квота общая на пользователя: если перед проверкой шли другие запросы (chat-e2e), 429 придёт
	// раньше 31-го. Важно, что он пришёл не позже лимита и до него были только 400.
	const ok = first429 >= 0 && first429 <= limit && statuses.slice(0, first429).every((s) => s === 400);
	console.log(`статусы: ${statuses.slice(0, 3).join(",")}… всего ${statuses.length}; первый 429 на запросе ${first429 + 1} (не позже ${limit + 1})`);
	console.log(ok ? "PASS: лимит ходов чата" : "FAIL: лимит ходов чата");
	return ok ? 0 : 1;
}

main().then((rc) => process.exit(rc)).catch((e) => { console.error("FATAL:", e instanceof Error ? e.message : e); process.exit(2); });
