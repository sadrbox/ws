// Зонд администрирования 1С: прогоняет ЧИТАЮЩИЕ команды по базам и печатает таблицу
// «база → итог → время». Нужен обеим сторонам разработки: сервис и агент чинятся по
// очереди, и после каждой правки вопрос один и тот же — «что теперь работает».
//
// Команды ставятся прямо в очередь, минуя HTTP: так зонд не зависит от прокси, его
// лимитов и от JWT, и меряет ровно то, что делает агент.
//
// Только чтение: CLUSTER_* и IB_LIST_*. Изменяющих команд здесь нет и быть не должно —
// на живых клиентских базах их запускать нельзя.
//
//   node --experimental-strip-types --env-file=.env tools/onec_probe.ts            # 10 баз, расширения
//   node --experimental-strip-types --env-file=.env tools/onec_probe.ts --cmd IB_LIST_USERS --limit 5
//   node --experimental-strip-types --env-file=.env tools/onec_probe.ts --base akacapital
//   node --experimental-strip-types --env-file=.env tools/onec_probe.ts --cmd CLUSTER_LIST_INFOBASES --cluster
//   node … tools/onec_probe.ts --parallel 4     # сколько ставить одновременно (потолок ищется так)

import { randomUUID } from "node:crypto";
import { loadConfig } from "../src/config.ts";
import { createPools } from "../src/db/pool.ts";

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i++) {
	if (!process.argv[i].startsWith("--")) continue;
	const key = process.argv[i].slice(2);
	const next = process.argv[i + 1];
	if (next && !next.startsWith("--")) { args.set(key, next); i++; } else args.set(key, "1");
}

const CMD = (args.get("cmd") ?? "IB_LIST_EXTENSIONS").toUpperCase();
const LIMIT = Number(args.get("limit") ?? 10);
const ONE_BASE = args.get("base") ?? null;
const CLUSTER_ONLY = args.has("cluster");
const PARALLEL = Number(args.get("parallel") ?? 1);
const WAIT_SECS = Number(args.get("wait") ?? 300);

type Row = { base: string; state: string; code: string; message: string; secs: number; summary: string };

/** Короткая выжимка успешного ответа — чтобы видеть, что данные не пустые. */
function summarize(result: unknown): string {
	const r = result as { items?: unknown[]; info?: Record<string, unknown> } | null;
	if (Array.isArray(r?.items)) return `${r.items.length} шт.`;
	if (r?.info) return Object.keys(r.info).length + " полей";
	return result ? "есть" : "—";
}

async function main(): Promise<number> {
	const cfg = loadConfig({ ...process.env, LOG_LEVEL: "warn" });
	const { db, erp } = createPools(cfg.DATABASE_URL, cfg.ERP_DATABASE_URL);

	const agent = (await db.query<{ id: string; organization_uuid: string; capabilities: string[] }>(
		`SELECT id, organization_uuid, capabilities FROM agents
		  WHERE role = 'admin' AND disabled_at IS NULL
		    AND last_seen_at > now() - ($1 || ' seconds')::interval
		  ORDER BY last_seen_at DESC LIMIT 1`,
		[String(cfg.AGENT_OFFLINE_AFTER_SECS)],
	)).rows[0];
	if (!agent) { console.log("админ-агент не на связи — ставить команды некому"); await Promise.all([db.end(), erp.end()]); return 1; }
	console.log(`агент: ${agent.id.slice(0, 8)} | способности: ${agent.capabilities.join(", ")}`);

	// Кластерные команды базу не адресуют; внутрибазовым нужен список ключей.
	const keys: (string | null)[] = CLUSTER_ONLY
		? [null]
		: ONE_BASE
			? [ONE_BASE]
			: (await db.query<{ key: string }>(
				`SELECT key FROM bases WHERE status = 'ONLINE' AND disabled_at IS NULL ORDER BY key LIMIT $1`, [LIMIT],
			)).rows.map((r) => r.key);

	console.log(`команда: ${CMD} | баз: ${keys.length} | одновременно: ${PARALLEL}\n`);

	const queue = [...keys];
	const rows: Row[] = [];

	const worker = async () => {
		for (;;) {
			const key = queue.shift();
			if (key === undefined) return;
			const id = "cmd_" + randomUUID().replace(/-/g, "").slice(0, 16);
			const payload = key ? { baseKey: key } : {};
			const t0 = Date.now();
			await db.query(
				`INSERT INTO commands (id, agent_id, organization_uuid, base_key, type, payload, expires_at)
				 VALUES ($1,$2,$3,$4,$5,$6::jsonb, now() + ($7 || ' seconds')::interval)`,
				[id, agent.id, agent.organization_uuid, key, CMD, JSON.stringify(payload), String(WAIT_SECS)],
			);
			let row: Row = { base: key ?? "(кластер)", state: "TIMEOUT", code: "", message: "", secs: 0, summary: "" };
			while (Date.now() - t0 < WAIT_SECS * 1000) {
				const r = (await db.query<{ state: string; result: unknown; error: { code: string; message: string } | null }>(
					"SELECT state, result, error FROM commands WHERE id = $1", [id],
				)).rows[0];
				if (r.state === "done" || r.state === "failed") {
					row = {
						base: key ?? "(кластер)", state: r.state,
						code: r.error?.code ?? "", message: r.error?.message ?? "",
						secs: Math.round((Date.now() - t0) / 1000),
						summary: r.state === "done" ? summarize(r.result) : "",
					};
					break;
				}
				await new Promise((s) => setTimeout(s, 1500));
			}
			if (row.state === "TIMEOUT") row.secs = Math.round((Date.now() - t0) / 1000);
			rows.push(row);
			const mark = row.state === "done" ? "OK  " : "FAIL";
			console.log(`  ${mark} ${row.base.padEnd(26)} ${String(row.secs).padStart(4)}с  ${row.summary}${row.code ? row.code + " " + row.message.slice(0, 70) : ""}`);
		}
	};
	await Promise.all(Array.from({ length: Math.max(1, Math.min(PARALLEL, keys.length)) }, worker));

	const ok = rows.filter((r) => r.state === "done");
	const times = rows.map((r) => r.secs).sort((a, b) => a - b);
	console.log(`\nитого: ok=${ok.length} fail=${rows.length - ok.length} из ${rows.length}`);
	if (times.length) {
		const median = times[Math.floor(times.length / 2)];
		console.log(`время: мин ${times[0]}с | медиана ${median}с | макс ${times[times.length - 1]}с`);
	}
	// Ошибки группируем: одинаковый код на многих базах — это одна проблема, а не N.
	const byCode = new Map<string, string[]>();
	for (const r of rows.filter((x) => x.state !== "done")) {
		const list = byCode.get(r.code || r.state) ?? [];
		list.push(r.base);
		byCode.set(r.code || r.state, list);
	}
	for (const [code, bases] of byCode) {
		console.log(`\n${code} (${bases.length}): ${bases.slice(0, 8).join(", ")}${bases.length > 8 ? " …" : ""}`);
		const sample = rows.find((r) => (r.code || r.state) === code && r.message);
		if (sample) console.log(`   ${sample.message.slice(0, 200)}`);
		else console.log("   (сообщение пустое — агент не передал текст ошибки)");
	}
	await Promise.all([db.end(), erp.end()]);
	return rows.length && ok.length === rows.length ? 0 : 1;
}

main().then((rc) => process.exit(rc)).catch((e) => { console.error("FATAL:", e instanceof Error ? e.message : e); process.exit(2); });
