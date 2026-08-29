// Сквозной тест M6: AI Service (настоящий, не mock) -> bpapi-agent -> buhprof_api (1С).
//
// Что делает:
//   1. поднимает AI Service на локальном порту против серверной базы (.env + .env.local);
//   2. через admin API создаёт агента и получает токен;
//   3. пишет временный agent.toml и запускает bpapi-agent.exe с ним;
//   4. гоняет через очередь тот же сценарий, что tools/e2e_test.py агента (ТЕСТ №1 ТЗ);
//   5. проверяет, что состояние агента видно в API и в аудите.
//
// Запуск:  npm run e2e -- --customer "физули" --product "хранилище базы за июнь"
// Требуется собранный агент: E:\Development\bpapi_agent\target\release\bpapi-agent.exe

import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { loadConfig } from "../src/config.ts";
import { createLogger } from "../src/logger.ts";
import { createPools } from "../src/db/pool.ts";
import { migrate } from "../src/db/migrate.ts";
import { createApp } from "../src/server.ts";

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ""), process.argv[i + 1] ?? "");
const CUSTOMER = args.get("customer") ?? "Альфа";
const PRODUCT = args.get("product") ?? "Дизи";
const AGENT_EXE = args.get("agent-exe") ?? "E:\\Development\\bpapi_agent\\target\\release\\bpapi-agent.exe";
const AGENT_TOML = args.get("agent-toml") ?? "E:\\Development\\bpapi_agent\\agent.toml";
const PORT = Number(args.get("port") ?? 3199);

const results: boolean[] = [];
function note(ok: boolean, step: string, detail = ""): void {
	results.push(ok);
	console.log(`  ${ok ? "✓" : "✗"} [${ok ? "PASS" : "FAIL"}] ${step}${detail ? " — " + detail : ""}`);
}

type Envelope<T = unknown> = { success: boolean; data?: T; error?: { code: string; message: string; details?: unknown } };

async function main(): Promise<number> {
	const cfg = loadConfig({ ...process.env, PORT: String(PORT), LOG_LEVEL: "warn" });
	const log = createLogger("warn");
	const { db, erp } = createPools(cfg.DATABASE_URL, cfg.ERP_DATABASE_URL);
	await migrate(db, log);
	const { app, queue } = createApp({ cfg, log, db, erp });
	const server = app.listen(PORT);
	const base = `http://127.0.0.1:${PORT}`;
	console.log(`AI Service: ${base} (база: ${new URL(cfg.DATABASE_URL).host})\n`);

	const admin = async <T,>(method: string, p: string, body?: unknown): Promise<{ status: number; body: Envelope<T> }> => {
		const r = await fetch(base + p, {
			method, headers: { "content-type": "application/json", "x-admin-key": cfg.AGENT_ADMIN_KEY },
			body: body === undefined ? undefined : JSON.stringify(body),
		});
		return { status: r.status, body: (await r.json()) as Envelope<T> };
	};

	let agentProc: ChildProcess | null = null;
	try {
		const h = await fetch(base + "/health").then((r) => r.json() as Promise<Envelope<{ version: string }>>);
		note(h.success, "health", h.data?.version);

		// без ключа — отказ
		const noKey = await fetch(base + "/admin/v1/agents");
		note(noKey.status === 401, "admin без ключа", `HTTP ${noKey.status}`);

		// агент
		const orgUuid = "e2e-" + randomUUID();
		const created = await admin<{ agent: { id: string }; token: string }>("POST", "/admin/v1/agents", { organizationUuid: orgUuid, name: "e2e" });
		note(created.status === 201 && !!created.body.data?.token, "создание агента", created.body.data?.agent.id);
		const agentId = created.body.data!.agent.id;
		const token = created.body.data!.token;

		// временный конфиг агента: cloud -> наш сервис, всё остальное из рабочего agent.toml
		const toml = await readFile(AGENT_TOML, "utf8");
		const patched = toml
			.replace(/^id\s*=.*$/m, `id = "${agentId}"`)
			.replace(/^url\s*=\s*"http:\/\/127\.0\.0\.1:8080"/m, `url = "${base}"`)
			.replace(/^token\s*=\s*"dev-cloud-token-change-me"/m, `token = "${token}"`)
			.replace(/^heartbeat_secs\s*=.*$/m, "heartbeat_secs = 5")
			.replace(/^poll_wait_secs\s*=.*$/m, "poll_wait_secs = 10")
			.replace(/^timeout_secs\s*=\s*30/m, "timeout_secs = 20");
		const dir = await mkdtemp(path.join(os.tmpdir(), "bpapi-e2e-"));
		const tomlPath = path.join(dir, "agent.toml");
		await writeFile(tomlPath, patched.replace(/^data_dir\s*=.*$/m, `data_dir = "${dir.replace(/\\/g, "\\\\")}"`), "utf8");

		agentProc = spawn(AGENT_EXE, ["run", "--config", tomlPath], { stdio: ["ignore", "pipe", "pipe"] });
		const agentLog: string[] = [];
		agentProc.stdout?.on("data", (d) => agentLog.push(String(d)));
		agentProc.stderr?.on("data", (d) => agentLog.push(String(d)));

		// ждём регистрацию
		let online = false;
		for (let i = 0; i < 40 && !online; i++) {
			await new Promise((r) => setTimeout(r, 500));
			const a = await admin<{ items: { id: string; online: boolean; onec: { reachable: boolean } }[] }>("GET", "/admin/v1/agents");
			online = !!a.body.data?.items.find((x) => x.id === agentId && x.online);
		}
		note(online, "агент зарегистрировался и online");

		const run = async (type: string, payload: Record<string, unknown> = {}, requestId?: string, expect = "SUCCESS", expectCode?: string, label?: string) => {
			const c = await admin<{ id: string }>("POST", "/admin/v1/commands", { agentId, type, payload, requestId });
			const id = c.body.data!.id;
			const r = await admin<{ state: string; result: Record<string, unknown> | null; error: { code: string } | null }>("GET", `/admin/v1/commands/${id}?wait=90`);
			const d = r.body.data!;
			const status = d.state === "done" ? "SUCCESS" : d.state === "failed" ? "ERROR" : d.state.toUpperCase();
			const ok = status === expect && (!expectCode || d.error?.code === expectCode);
			const res = d.result ?? {};
			const extra = ok && d.result ? String(res.number ?? res.version ?? (Array.isArray(res.items) ? `items=${res.items.length}` : "")) : d.error?.code ?? "";
			note(ok, label ?? type, `${status} ${extra}`.trim());
			return ok ? d.result : null;
		};

		await run("HEALTH");
		await run("EXECUTE_SQL", { sql: "DROP TABLE" }, undefined, "ERROR", "UNKNOWN_COMMAND");
		await run("CREATE_SALE", { customerId: "x", items: [] }, undefined, "ERROR", "MISSING_REQUEST_ID", "CREATE_SALE без requestId");

		const cust = await run("SEARCH_COUNTERPARTIES", { q: CUSTOMER, limit: 5 });
		const prod = await run("SEARCH_PRODUCTS", { q: PRODUCT, limit: 5 });
		const whs = await run("GET_WAREHOUSES");
		const customer = (cust?.items as { id: string }[] | undefined)?.[0];
		const product = (prod?.items as { id: string; isService?: boolean }[] | undefined)?.[0];
		if (!customer || !product) {
			note(false, "подготовка", "контрагент/номенклатура не найдены — укажите --customer/--product");
			return finish();
		}
		const payload: Record<string, unknown> = {
			customerId: customer.id,
			items: [{ productId: product.id, quantity: 2, price: 1500 }],
			comment: "e2e AI Service → агент → 1С",
		};
		if (!product.isService && whs?.items) payload.warehouseId = (whs.items as { id: string }[])[0].id;

		let rid = randomUUID();
		// Первая попытка без договора: либо документ, либо штатное уточнение CONTRACT_AMBIGUOUS (§15 ТЗ).
		const first = await admin<{ id: string }>("POST", "/admin/v1/commands", { agentId, type: "CREATE_SALE", payload, requestId: rid });
		const firstRes = await admin<{ state: string; result: Record<string, unknown> | null; error: { code: string; details?: { candidates?: { id: string }[] } } | null }>(
			"GET", `/admin/v1/commands/${first.body.data!.id}?wait=90`);
		let sale: Record<string, unknown> | null = null;
		if (firstRes.body.data?.state === "done") {
			sale = firstRes.body.data.result;
			note(true, "CREATE_SALE", `SUCCESS ${sale?.number}`);
		} else if (firstRes.body.data?.error?.code === "CONTRACT_AMBIGUOUS") {
			const cands = firstRes.body.data.error.details?.candidates ?? [];
			note(cands.length > 0, "CREATE_SALE → уточнение договора", `CONTRACT_AMBIGUOUS, кандидатов: ${cands.length}`);
			payload.contractId = cands[0]?.id;
			rid = randomUUID();
			sale = await run("CREATE_SALE", payload, rid, "SUCCESS", undefined, "CREATE_SALE (с contractId)");
		} else {
			note(false, "CREATE_SALE", `${firstRes.body.data?.state} ${firstRes.body.data?.error?.code ?? ""}`);
		}
		if (!sale) return finish();

		const again = await run("CREATE_SALE", payload, rid, "SUCCESS", undefined, "CREATE_SALE повтор requestId");
		note(!!again && again.id === sale.id && again.idempotent === true, "идемпотентность", `тот же документ: ${again?.id === sale.id}`);

		const doc = { documentId: sale.id as string };
		await run("GET_SALE", doc);
		const posted = await run("POST_SALE", doc, randomUUID());
		const pdf = await run("PRINT_SALE", { ...doc, form: product.isService ? "АктОбОказанииУслуг" : "РасходнаяНакладная" });
		if (pdf) note(pdf.mimeType === "application/pdf" && Number(pdf.size) > 1000, "PDF", `${pdf.size} байт`);
		if (posted) await run("UNPOST_SALE", doc, randomUUID());

		const audit = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM audit_log WHERE agent_id = $1`, [agentId]);
		note(Number(audit.rows[0].n) >= 5, "аудит", `записей: ${audit.rows[0].n}`);

		if (results.some((x) => !x)) console.log("\n--- хвост лога агента ---\n" + agentLog.slice(-10).join(""));
	} finally {
		// Порядок важен: сначала агент, потом очередь (будит long-poll), потом сервер и пул.
		agentProc?.kill();
		queue.close();
		await new Promise((r) => setTimeout(r, 300));
		await new Promise<void>((r) => server.close(() => r()));
		await Promise.all([db.end(), erp.end()]);
	}
	return finish();
}

function finish(): number {
	const pass = results.filter(Boolean).length;
	console.log("\n" + "=".repeat(56) + `\nИТОГ: PASS ${pass}  FAIL ${results.length - pass}`);
	return results.every(Boolean) ? 0 : 1;
}

main().then((code) => process.exit(code)).catch((e) => { console.error("e2e упал:", e); process.exit(1); });
