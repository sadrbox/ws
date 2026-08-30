// Сквозной тест диалога (ТЕСТ №2 ТЗ): текст → Claude → tools → очередь → агент → 1С.
//
// Поднимает AI Service локально (порт 3199) с настоящим AnthropicProvider, временного агента
// для организации ERP (тот же org, что у боевого агента) и ведёт скриптовый диалог от имени
// реального пользователя ERP (JWT подписывается тем же JWT_SECRET). В конце всё убирает.
//
// Запуск:  npm run chat-e2e -- --org a1410911-... --customer "физули" --product "хранилище базы за июнь"
// Стоимость: несколько вызовов claude-opus-5, ~5–10 центов.

import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import jwt from "jsonwebtoken";
import { loadConfig } from "../src/config.ts";
import { createLogger } from "../src/logger.ts";
import { createPools } from "../src/db/pool.ts";
import { migrate } from "../src/db/migrate.ts";
import { createApp } from "../src/server.ts";

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ""), process.argv[i + 1] ?? "");
const ORG = args.get("org") ?? "a1410911-7421-45da-9632-7e4fc48e91c2";
const CUSTOMER = args.get("customer") ?? "Физули";
const PRODUCT = args.get("product") ?? "хранилище базы за июнь";
const AGENT_EXE = args.get("agent-exe") ?? "E:\\Development\\bpapi_agent\\target\\release\\bpapi-agent.exe";
const AGENT_TOML = args.get("agent-toml") ?? "E:\\Development\\bpapi_agent\\agent.toml";
const PORT = Number(args.get("port") ?? 3199);

const results: boolean[] = [];
function note(ok: boolean, step: string, detail = ""): void {
	results.push(ok);
	console.log(`  ${ok ? "✓" : "✗"} [${ok ? "PASS" : "FAIL"}] ${step}${detail ? " — " + detail : ""}`);
}
const short = (s: string, n = 220) => s.replace(/\s+/g, " ").slice(0, n);

type Reply = { conversationId: string; state: string; text: string; confirmation?: { tool: string } | null; attachments?: { fileName: string; size?: number; content: string }[]; usage?: { inputTokens: number; outputTokens: number; cacheRead?: number } };
type Envelope<T> = { success: boolean; data?: T; error?: { code: string; message: string } };

async function main(): Promise<number> {
	const cfg = loadConfig({ ...process.env, PORT: String(PORT), LOG_LEVEL: "warn" });
	if (!cfg.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY не задан");
	const log = createLogger("warn");
	const { db, erp } = createPools(cfg.DATABASE_URL, cfg.ERP_DATABASE_URL);
	await migrate(db, log);
	const { app, queue, workflow } = createApp({ cfg, log, db, erp });
	if (!workflow) throw new Error("чат не инициализирован (LLM)");
	const server = app.listen(PORT);
	const base = `http://127.0.0.1:${PORT}`;

	// пользователь ERP с доступом к организации
	const u = await erp.query<{ uuid: string; username: string | null }>(
		`SELECT u.uuid, u.username FROM users u JOIN access_rights a ON a."userUuid" = u.uuid
		  WHERE a."organizationUuid" = $1 AND u."deletedAt" IS NULL ORDER BY (a.role = 'admin') DESC, u.id LIMIT 1`, [ORG]);
	if (!u.rows[0]) throw new Error(`нет пользователей ERP с доступом к организации ${ORG}`);
	const user = u.rows[0];
	const token = jwt.sign({ uuid: user.uuid }, cfg.JWT_SECRET, { expiresIn: "1h" });
	console.log(`AI Service: ${base}\nпользователь ERP: ${user.username ?? user.uuid}, организация ${ORG}\n`);

	const adminHeaders = { "content-type": "application/json", "x-admin-key": cfg.AGENT_ADMIN_KEY };
	const created = await fetch(base + "/admin/v1/agents", { method: "POST", headers: adminHeaders, body: JSON.stringify({ organizationUuid: ORG, name: "chat-e2e (временный)" }) })
		.then((r) => r.json() as Promise<Envelope<{ agent: { id: string }; token: string }>>);
	const agentId = created.data!.agent.id;

	const toml = (await readFile(AGENT_TOML, "utf8"))
		.replace(/^id\s*=.*$/m, `id = "${agentId}"`)
		.replace(/^(\[cloud\][\s\S]*?^url\s*=).*$/m, `$1 "${base}"`)
		.replace(/^(\[cloud\][\s\S]*?^token\s*=).*$/m, `$1 "${created.data!.token}"`)
		.replace(/^heartbeat_secs\s*=.*$/m, "heartbeat_secs = 5")
		.replace(/^poll_wait_secs\s*=.*$/m, "poll_wait_secs = 10")
		.replace(/^(\[cloud\][\s\S]*?^timeout_secs\s*=).*$/m, "$1 20");
	const dir = await mkdtemp(path.join(os.tmpdir(), "bpapi-chat-"));
	await writeFile(path.join(dir, "agent.toml"), toml.replace(/^data_dir\s*=.*$/m, `data_dir = "${dir.replace(/\\/g, "\\\\")}"`), "utf8");
	let agentProc: ChildProcess | null = spawn(AGENT_EXE, ["run", "--config", path.join(dir, "agent.toml")], { stdio: "ignore" });

	// Важно: боевой агент той же организации сейчас тоже ONLINE и смотрит на ai.buhprof.kz;
	// локальный сервис выберет ЛЮБОГО online-агента организации из общей базы. Чтобы команды
	// ушли именно временному агенту, ждём его регистрации и на время теста отключаем остальных.
	const others = (await db.query<{ id: string }>(`SELECT id FROM agents WHERE organization_uuid = $1 AND id <> $2 AND disabled_at IS NULL`, [ORG, agentId])).rows.map((r) => r.id);
	await db.query(`UPDATE agents SET disabled_at = now() WHERE id = ANY($1)`, [others]);

	let conversationId: string | null = null;
	const say = async (text: string): Promise<Reply> => {
		const r = await fetch(base + "/v1/chat", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
			body: JSON.stringify({ conversationId, text, organizationUuid: ORG }) });
		const env = (await r.json()) as Envelope<Reply>;
		if (!env.success || !env.data) throw new Error(`chat: HTTP ${r.status} ${env.error?.code} ${env.error?.message}`);
		conversationId = env.data.conversationId;
		console.log(`\n> ${text}\n< [${env.data.state}] ${short(env.data.text, 400)}${env.data.usage ? `   (tokens in=${env.data.usage.inputTokens} cached=${env.data.usage.cacheRead ?? 0} out=${env.data.usage.outputTokens})` : ""}`);
		return env.data;
	};

	try {
		let online = false;
		for (let i = 0; i < 40 && !online; i++) {
			await new Promise((r) => setTimeout(r, 500));
			const a = await db.query<{ last_seen_at: Date | null }>(`SELECT last_seen_at FROM agents WHERE id = $1`, [agentId]);
			online = !!a.rows[0]?.last_seen_at;
		}
		note(online, "временный агент online");

		// 0. без токена — 401
		const noAuth = await fetch(base + "/v1/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "привет" }) });
		note(noAuth.status === 401, "чат без JWT", `HTTP ${noAuth.status}`);

		// 1. создание реализации — ожидаем карточку подтверждения (или уточнение)
		let r = await say(`Создай реализацию для ${CUSTOMER}: ${PRODUCT} 2 штуки по 1500 тенге`);
		for (let i = 0; i < 3 && r.state === "WAITING_CLARIFICATION"; i++) {
			// модель спрашивает (например, какой из вариантов номенклатуры) — отвечаем «первый»
			r = await say("Первый вариант");
		}
		note(r.state === "WAITING_CONFIRMATION" && r.confirmation?.tool === "create_sale", "карточка подтверждения create_sale", r.state);
		if (r.state !== "WAITING_CONFIRMATION") throw new Error("диалог не дошёл до подтверждения");

		// 2. подтверждение → документ создан (не проведён)
		r = await say("да");
		const numbered = (t: string) => /(^|\n)\s*1[.)]\s/.test(t);
		for (let i = 0; i < 4; i++) {
			if (r.state === "WAITING_CLARIFICATION" && numbered(r.text)) r = await say("Первый");
			else if (r.state === "WAITING_CONFIRMATION") r = await say("да");
			else break;
		}
		const numMatch = r.text.match(/\d{6,}/);
		note(!!numMatch && (r.state === "COMPLETED" || r.state === "WAITING_CLARIFICATION"), "документ создан после «да»", numMatch?.[0] ?? r.state);
		const created2 = await db.query<{ state: string; result: { number?: string; posted?: boolean } | null }>(
			`SELECT state, result FROM commands WHERE conversation_id = $1 AND type = 'CREATE_SALE' ORDER BY created_at DESC LIMIT 1`, [conversationId]);
		note(created2.rows[0]?.state === "done" && created2.rows[0].result?.posted === false, "в 1С: создан, НЕ проведён", `№ ${created2.rows[0]?.result?.number}`);

		// 3. проведение — только через подтверждение
		r = await say("Проведи этот документ");
		note(r.state === "WAITING_CONFIRMATION" && r.confirmation?.tool === "post_sale", "проведение требует подтверждения", r.state);
		r = await say("да");
		const posted = await db.query<{ state: string; result: { posted?: boolean } | null }>(
			`SELECT state, result FROM commands WHERE conversation_id = $1 AND type = 'POST_SALE' ORDER BY created_at DESC LIMIT 1`, [conversationId]);
		note(posted.rows[0]?.result?.posted === true, "документ проведён", `${r.state}, posted=${posted.rows[0]?.result?.posted}`);

		// 4. печатная форма — вложение PDF
		r = await say("Дай акт по этому документу");
		const pdf = r.attachments?.[0];
		note(!!pdf && pdf.content.length > 1000, "PDF во вложении", pdf ? `${pdf.fileName} (${Math.round(pdf.content.length * 0.75 / 1024)} КБ)` : r.state);

		// 5. отмена проведения — подтверждение и отказ
		r = await say("Отмени проведение");
		note(r.state === "WAITING_CONFIRMATION" && r.confirmation?.tool === "unpost_sale", "отмена проведения — подтверждение", r.state);
		r = await say("нет");
		note(r.state === "COMPLETED" && /отмен/i.test(r.text), "отказ от операции", short(r.text, 60));
		const stillPosted = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM commands WHERE conversation_id = $1 AND type = 'UNPOST_SALE'`, [conversationId]);
		note(stillPosted.rows[0].n === "0", "UNPOST не отправлялся в 1С после «нет»");

		// 6. защита от выдуманных id: модель либо откажется сама, либо реестр отклонит вызов —
		//    в любом случае команда с чужим id в 1С не уходит.
		r = await say("Прочитай документ с id 11111111-2222-3333-4444-555555555555");
		const bogus = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM commands WHERE conversation_id = $1 AND payload::text LIKE '%11111111-2222-3333-4444-555555555555%'`, [conversationId]);
		note(bogus.rows[0].n === "0", "выдуманный id не ушёл в 1С", short(r.text, 80));

		const audit = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM audit_log WHERE conversation_id = $1`, [conversationId]);
		note(Number(audit.rows[0].n) >= 15, "аудит диалога", `записей: ${audit.rows[0].n}`);
	} catch (e) {
		note(false, "исключение теста", e instanceof Error ? e.message : String(e));
	}
	return finish(agentProc, server, db, erp, queue, agentId, others);
}

async function finish(agentProc: ChildProcess | null, server: ReturnType<import("express").Express["listen"]>, db: import("pg").Pool, erp: import("pg").Pool, queue: { close(): void }, agentId: string, others: string[]): Promise<number> {
	agentProc?.kill();
	queue.close();
	await new Promise((r) => setTimeout(r, 300));
	await new Promise<void>((r) => server.close(() => r()));
	// вернуть боевых агентов и убрать временного
	await db.query(`UPDATE agents SET disabled_at = NULL WHERE id = ANY($1)`, [others]);
	await db.query(`UPDATE conversations SET agent_id = NULL WHERE agent_id = $1`, [agentId]);
	await db.query(`DELETE FROM commands WHERE agent_id = $1`, [agentId]);
	await db.query(`DELETE FROM agents WHERE id = $1`, [agentId]);
	await Promise.all([db.end(), erp.end()]);
	const pass = results.filter(Boolean).length;
	console.log("\n" + "=".repeat(56) + `\nИТОГ: PASS ${pass}  FAIL ${results.length - pass}`);
	return results.every(Boolean) ? 0 : 1;
}

main().then((code) => process.exit(code)).catch((e) => { console.error("chat-e2e упал:", e); process.exit(1); });
