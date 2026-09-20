// Сквозной тест канала «чат внутри 1С» (СВ1, СВ2) — от имени формы BPAPI_Чат.
//
// Поднимает AI Service локально (127.0.0.1, порт 3198) с настоящей моделью, заводит ВРЕМЕННУЮ базу с токеном и
// ведёт диалог так, как ведёт его форма: X-Base-Token + X-1C-User-Id, ходы по контракту
// docs/CONTRACT_1C_CHAT_2026-09-19.md, вызовы TOOL_CALLS выполняет «форма» и присылает toolResults.
//
// Кто выполняет вызовы (--executor):
//   agent (по умолчанию) — бизнес-агент организации через очередь: те же commandType/payload/requestId, что форма
//                          передаст в BPAPI_Шлюз.ВыполнитьКоманду; файлы, как и форма, в сервис не отправляем;
//   stub                 — заглушка с правдоподобными ответами: проверка сервиса без 1С.
//
// Запуск:  npm run onec-chat-e2e -- --org a1410911-... [--executor stub] [--customer "физули"]
//          [--product "облачное хранилище"] [--pdf C:\выписка.pdf]
//          [--bin <БИН организации 1С хода>]
// PDF: --bin должен совпадать с БИН владельца выписки — иначе модель справедливо переспросит, чью выписку грузить.
// Стоимость: несколько вызовов модели, ~5–10 центов. Токен базы в вывод не печатается.

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "../src/config.ts";
import { createLogger } from "../src/logger.ts";
import { createPools } from "../src/db/pool.ts";
import { migrate } from "../src/db/migrate.ts";
import { createApp } from "../src/server.ts";
import { BaseTokenStore } from "../src/bases/tokens.ts";

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ""), process.argv[i + 1] ?? "");
const ORG = args.get("org") ?? "a1410911-7421-45da-9632-7e4fc48e91c2";
const EXECUTOR = args.get("executor") ?? "agent";
const CUSTOMER = args.get("customer") ?? "физули";
const PRODUCT = args.get("product") ?? "облачное хранилище";
const PDF = args.get("pdf") ?? "";
const PORT = Number(args.get("port") ?? 3198);
const USER_ID = randomUUID();

const results: boolean[] = [];
function note(ok: boolean, step: string, detail = ""): void {
	results.push(ok);
	console.log(`  ${ok ? "✓" : "✗"} [${ok ? "PASS" : "FAIL"}] ${step}${detail ? " — " + detail : ""}`);
}
const short = (s: string, n = 220) => (s ?? "").replace(/\s+/g, " ").slice(0, n);

type Call = { callId: string; commandType: string; payload: Record<string, unknown>; requestId?: string };
type Reply = { conversationId: string; state: string; text: string; confirmation?: { tool: string; card: string }; calls?: Call[]; documents?: { type: string; number: string; title: string }[] };
type Envelope<T> = { success: boolean; data?: T; error?: { code: string; message: string } };
type ClientResult = { success: boolean; data?: unknown; error?: { code: string; message: string; details?: unknown }; status?: number };

async function main(): Promise<number> {
	const cfg = loadConfig({ ...process.env, PORT: String(PORT), LOG_LEVEL: "warn" });
	const log = createLogger("warn");
	const { db, erp } = createPools(cfg.DATABASE_URL, cfg.ERP_DATABASE_URL);
	await migrate(db, log);
	const { app, queue, agents, workflow } = createApp({ cfg, log, db, erp });
	if (!workflow) throw new Error("чат не инициализирован (нет ключа модели)");
	const server = app.listen(PORT, "127.0.0.1");
	const base = `http://127.0.0.1:${PORT}/v1/onec-chat`;

	const org = (await erp.query<{ bin: string; name: string | null }>(`SELECT bin, name FROM organizations WHERE uuid = $1`, [ORG])).rows[0];
	if (!org) throw new Error(`организация ERP ${ORG} не найдена`);
	const organization = { bin: args.get("bin") ?? org.bin, name: org.name ?? "", id: randomUUID() };

	// Временные сервер и база: токен выдаётся базе, а трогать настоящие не нужно.
	const serverId = randomUUID();
	const baseId = randomUUID();
	await db.query(`INSERT INTO servers (id, organization_uuid, name) VALUES ($1, $2, $3)`, [serverId, ORG, `onec-chat-e2e ${serverId.slice(0, 8)}`]);
	await db.query(`INSERT INTO bases (id, server_id, key, name) VALUES ($1, $2, 'onec_chat_e2e', 'onec-chat-e2e (временная)')`, [baseId, serverId]);
	const tokens = new BaseTokenStore(db);
	const issued = await tokens.issue({ baseId, createdBy: "onec-chat-e2e" });
	console.log(`AI Service: ${base}\nорганизация ERP ${ORG}, организация 1С «${organization.name}» БИН ${organization.bin}, исполнитель: ${EXECUTOR}\n`);

	const headers = (token = issued.token) => ({ "content-type": "application/json", "x-base-token": token, "x-1c-user-id": USER_ID });
	let conversationId: string | null = null;
	const seenCalls: Call[] = [];

	const post = async (body: Record<string, unknown>): Promise<Reply> => {
		const r = await fetch(base + "/turn", { method: "POST", headers: headers(), body: JSON.stringify({ conversationId, user: { id: USER_ID, name: "Бухгалтер (e2e)" }, organization, ...body }) });
		const env = (await r.json()) as Envelope<Reply>;
		if (!env.success || !env.data) throw new Error(`turn: HTTP ${r.status} ${env.error?.code} ${env.error?.message}`);
		conversationId = env.data.conversationId;
		const calls = env.data.calls?.map((c) => `${c.commandType}${c.requestId ? "+requestId" : ""}`).join(", ");
		console.log(`< [${env.data.state}] ${short(env.data.text, 300)}${calls ? `  calls: ${calls}` : ""}`);
		return env.data;
	};
	const poll = async (): Promise<Reply> => {
		for (let i = 0; i < 60; i++) {
			await new Promise((r) => setTimeout(r, 5000));
			const r = await fetch(`${base}/conversations/${conversationId}`, { headers: headers() });
			const env = (await r.json()) as Envelope<Reply>;
			if (env.data && env.data.state !== "PROCESSING") {
				console.log(`< (опрос) [${env.data.state}] ${short(env.data.text, 300)}`);
				return env.data;
			}
		}
		throw new Error("ход в фоне не закончился за 5 минут");
	};

	/** «Форма»: выполнить вызов и вернуть результат по контракту; файл остаётся у «пользователя». */
	const execute = async (c: Call): Promise<ClientResult> => {
		seenCalls.push(c);
		let res: ClientResult;
		if (EXECUTOR === "stub") res = stub(c);
		else {
			const agent = await agents.pickOnline(ORG);
			if (!agent) return { success: false, status: 503, error: { code: "AGENT_OFFLINE", message: "бизнес-агент организации не на связи (e2e-исполнитель)" } };
			const cmd = await queue.enqueue({ agentId: agent.id, organizationUuid: ORG, type: c.commandType, payload: c.payload, requestId: c.requestId ?? null, conversationId, ttlSeconds: 900 });
			const done = await queue.waitResult(cmd.id, 180_000);
			res = done?.state === "done" ? { success: true, status: 200, data: done.result }
				: { success: false, status: done?.onec_http_status ?? 500, error: done?.error ?? { code: "TIMEOUT", message: `команда в состоянии ${done?.state ?? "?"}` } };
		}
		const data = res.data as { content?: string } | undefined;
		if (res.success && data && typeof data.content === "string") {
			const { content, ...rest } = data as Record<string, unknown>;
			res = { ...res, data: { ...rest, contentOmitted: true, bytes: Buffer.byteLength(String(content), "base64") } };
		}
		return res;
	};

	/** Довести ход до состояния, где нужен человек: выполнить все TOOL_CALLS, дождаться PROCESSING. */
	const drive = async (r: Reply): Promise<Reply> => {
		for (let i = 0; i < 15; i++) {
			if (r.state === "PROCESSING") { r = await poll(); continue; }
			if (r.state !== "TOOL_CALLS" || !r.calls?.length) return r;
			const toolResults = [];
			for (const c of r.calls) toolResults.push({ callId: c.callId, result: await execute(c) });
			r = await post({ toolResults });
		}
		return r;
	};
	const say = async (text: string) => { console.log(`\n> ${text}`); return drive(await post({ text })); };
	const decide = async (accepted: boolean) => { console.log(`\n> [${accepted ? "Подтвердить" : "Отменить"}]`); return drive(await post({ decision: { accepted } })); };

	try {
		const ping = await fetch(base + "/ping", { headers: headers() });
		const pingBody = (await ping.json()) as Envelope<{ base: { key: string }; serviceVersion: string }>;
		note(ping.status === 200 && pingBody.data?.base.key === "onec_chat_e2e", "ping с токеном базы", `serviceVersion ${pingBody.data?.serviceVersion}`);
		const bad = await fetch(base + "/ping", { headers: headers("bpb_wrong") });
		note(bad.status === 401, "ping с неверным токеном — 401", `HTTP ${bad.status}`);

		// 1. поиск: TOOL_CALLS → COMPLETED
		const before = seenCalls.length;
		let r = await say(`найди ${CUSTOMER}`);
		note(seenCalls.slice(before).some((c) => c.commandType === "SEARCH_COUNTERPARTIES" && !c.requestId), "поиск ушёл форме без requestId");
		note(r.state === "COMPLETED" || r.state === "WAITING_CLARIFICATION", "поиск завершён", r.state);

		// 2. реализация: карточка → подтверждение → TOOL_CALLS CREATE_SALE → COMPLETED
		conversationId = null;
		r = await say(`Создай реализацию ${CUSTOMER} на ${PRODUCT}, 1 шт, 5000`);
		for (let i = 0; i < 3 && r.state === "WAITING_CLARIFICATION"; i++) r = await say("Первый вариант");
		note(r.state === "WAITING_CONFIRMATION" && r.confirmation?.tool === "create_sale", "карточка create_sale", r.state);
		note(!seenCalls.some((c) => c.commandType === "CREATE_SALE"), "до подтверждения CREATE_SALE форме не уходил");
		if (r.state === "WAITING_CONFIRMATION") {
			r = await decide(true);
			const sale = seenCalls.find((c) => c.commandType === "CREATE_SALE");
			note(!!sale?.requestId, "CREATE_SALE ушёл форме после подтверждения, с requestId", sale?.requestId ?? "нет вызова");
			// Итог может кончаться вопросом («провести?») — это WAITING_CLARIFICATION, как и в ERP-чате.
			note(r.state === "COMPLETED" || r.state === "WAITING_CLARIFICATION", "реализация: ход завершён", `${r.state}${r.documents?.length ? `, документы: ${r.documents.map((d) => d.title).join(", ")}` : ""}`);
		}

		// 3. отчёт: RUN_REPORT, файл в сервис не пришёл
		conversationId = null;
		r = await say("ОСВ за август 2026");
		const report = seenCalls.find((c) => c.commandType === "RUN_REPORT");
		note(!!report, "RUN_REPORT ушёл форме", report ? `organizationBin ${String(report.payload.organizationBin ?? "—")}` : r.state);
		const stored = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM chat_files WHERE conversation_id = $1`, [conversationId]);
		note(stored.rows[0].n === "0", "файл отчёта в сервис не попал");
		note(r.state === "COMPLETED", "отчёт: ход завершён", r.state);

		// 4. PDF выписки: PROCESSING → карточка → TOOL_CALLS IMPORT_BANK_STATEMENT
		if (PDF) {
			conversationId = null;
			const content = (await readFile(PDF)).toString("base64");
			console.log(`\n> [вложение ${path.basename(PDF)}]`);
			const first = await post({ text: "", attachments: [{ fileName: path.basename(PDF), mimeType: "application/pdf", content }] });
			note(first.state === "PROCESSING", "PDF: ответ PROCESSING", first.state);
			r = await drive(first);
			note(r.state === "WAITING_CONFIRMATION" && r.confirmation?.tool === "import_bank_statement", "PDF: карточка загрузки выписки", r.state);
			if (r.state === "WAITING_CONFIRMATION") {
				r = await decide(true);
				const imp = seenCalls.find((c) => c.commandType === "IMPORT_BANK_STATEMENT");
				note(!!imp?.requestId && Array.isArray(imp.payload.lines), "IMPORT_BANK_STATEMENT ушёл форме с requestId и строками", imp ? `строк ${(imp.payload.lines as unknown[]).length}` : "нет вызова");
				note(r.state === "COMPLETED" || r.state === "WAITING_CLARIFICATION", "PDF: ход завершён", r.state);
			}
		}

		const audit = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM audit_log WHERE details->>'baseId' = $1 AND details->>'channel' = '1c'`, [baseId]);
		note(Number(audit.rows[0].n) > 0, "аудит с каналом 1c", `записей: ${audit.rows[0].n}`);
	} catch (e) {
		note(false, "исключение теста", e instanceof Error ? e.message : String(e));
	} finally {
		queue.close();
		server.closeAllConnections();
		await new Promise<void>((r) => server.close(() => r()));
		// Временную базу — вместе с токеном (каскад); диалоги канала этой базы — тоже.
		await db.query(`DELETE FROM conversations WHERE channel = '1c' AND base_id = $1`, [baseId]);
		await db.query(`DELETE FROM servers WHERE id = $1`, [serverId]);
		await Promise.all([db.end(), erp.end()]);
	}
	const pass = results.filter(Boolean).length;
	console.log("\n" + "=".repeat(56) + `\nИТОГ: PASS ${pass}  FAIL ${results.length - pass}`);
	return results.every(Boolean) ? 0 : 1;
}

/** Заглушка 1С: правдоподобные ответы шлюза на каждую команду. */
function stub(c: Call): ClientResult {
	const id = () => randomUUID();
	switch (c.commandType) {
		case "SEARCH_COUNTERPARTIES": return { success: true, status: 200, data: { items: [{ id: id(), name: `${CUSTOMER} ТОО`, bin: "900000000001" }] } };
		case "SEARCH_PRODUCTS": return { success: true, status: 200, data: { items: [{ id: id(), name: PRODUCT, isService: true, vatRate: "12%" }] } };
		case "GET_ORGANIZATIONS": return { success: true, status: 200, data: { items: [{ id: id(), name: "Организация", bin: "831111302342" }] } };
		case "GET_WAREHOUSES": return { success: true, status: 200, data: { items: [{ id: id(), name: "Основной склад" }] } };
		case "CREATE_SALE": return { success: true, status: 201, data: { id: id(), number: "0000123", posted: false, total: 5000 } };
		case "RUN_REPORT": return { success: true, status: 200, data: { fileName: "ОСВ.pdf", format: "pdf", mimeType: "application/pdf", content: Buffer.from("%PDF-stub").toString("base64") } };
		case "IMPORT_BANK_STATEMENT": return { success: true, status: 201, data: { created: 1, existing: 0, failed: 0, lines: [], createdCounterparties: [] } };
		default: return { success: true, status: 200, data: { ok: true } };
	}
}

main().then((code) => process.exit(code)).catch((e) => { console.error("onec-chat-e2e упал:", e); process.exit(1); });
