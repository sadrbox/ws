// Сквозной тест печати через чат на живом сервисе: загрузка выписки (документы уже есть →
// «уже в базе», в отчёте появляются documentId) → печать платёжного поручения в PDF и XLSX →
// файлы скачиваются по ссылке с JWT.
//
//   node --experimental-strip-types --env-file=.env --env-file=.env.local tools/print_chat_e2e.ts <выписка.pdf> [--base URL] [--org uuid]

import { readFile } from "node:fs/promises";
import path from "node:path";
import jwt from "jsonwebtoken";
import { loadConfig } from "../src/config.ts";
import { createPools } from "../src/db/pool.ts";

const args = new Map<string, string>();
const files: string[] = [];
for (let i = 2; i < process.argv.length; i++) {
	const a = process.argv[i];
	if (a.startsWith("--")) args.set(a.slice(2), process.argv[++i]);
	else files.push(a);
}
const BASE = args.get("base") ?? "http://192.168.1.112:3100";
const ORG = args.get("org") ?? "a1410911-7421-45da-9632-7e4fc48e91c2";

type FileRef = { fileId: string; fileName: string; mimeType: string; size: number; url: string };
type Reply = { conversationId: string; state: string; text: string; confirmation?: { tool: string; card: string } | null; attachments?: FileRef[] };
type Env<T> = { success: boolean; data?: T; error?: { code: string; message: string } };

async function main(): Promise<number> {
	if (!files.length) throw new Error("укажите PDF выписки");
	const cfg = loadConfig({ ...process.env, LOG_LEVEL: "warn" });
	const { db, erp } = createPools(cfg.DATABASE_URL, cfg.ERP_DATABASE_URL);
	const u = await erp.query<{ uuid: string }>(
		`SELECT u.uuid FROM users u JOIN access_rights a ON a."userUuid" = u.uuid WHERE a."organizationUuid" = $1 AND u."deletedAt" IS NULL ORDER BY (a.role = 'admin') DESC, u.id LIMIT 1`, [ORG]);
	const token = jwt.sign({ uuid: u.rows[0].uuid }, cfg.JWT_SECRET, { expiresIn: "1h" });
	const H = { authorization: `Bearer ${token}` };
	let conversationId: string | null = null;

	const say = async (text: string, attachments?: { fileName: string; mimeType: string; content: string }[]): Promise<Reply> => {
		const started = Date.now();
		const r = await fetch(`${BASE}/v1/chat`, { method: "POST", headers: { ...H, "content-type": "application/json" }, body: JSON.stringify({ conversationId, text, organizationUuid: ORG, ...(attachments ? { attachments } : {}) }) });
		const env = (await r.json()) as Env<Reply>;
		if (!env.success || !env.data) throw new Error(`HTTP ${r.status}: ${JSON.stringify(env.error)}`);
		conversationId = env.data.conversationId;
		let data: Reply = env.data;
		while (data.state === "PROCESSING" || ["UNDERSTANDING", "EXECUTING", "IDLE"].includes(data.state)) {
			await new Promise((x) => setTimeout(x, 3000));
			const se = (await (await fetch(`${BASE}/v1/conversations/${conversationId}?organizationUuid=${ORG}`, { headers: H })).json()) as Env<{ state: string; messages: { role: string; text: string; attachments?: FileRef[] }[]; confirmation?: Reply["confirmation"] }>;
			if (!se.success || !se.data) throw new Error("не удалось прочитать диалог");
			if (["UNDERSTANDING", "EXECUTING", "IDLE"].includes(se.data.state)) continue;
			const last = [...se.data.messages].reverse().find((m) => m.role === "assistant");
			data = { conversationId, state: se.data.state, text: last?.text ?? "", confirmation: se.data.confirmation ?? null, attachments: last?.attachments };
		}
		console.log(`>>> ${text}${attachments ? ` [${attachments.map((a) => a.fileName).join(", ")}]` : ""}`);
		console.log(`<<< [${data.state}, ${((Date.now() - started) / 1000).toFixed(1)} с]\n${data.text.slice(0, 700)}\n`);
		return data;
	};

	let rc = 0;
	const check = (cond: boolean, what: string) => { console.log(`${cond ? "PASS" : "FAIL"}: ${what}`); if (!cond) rc = 1; };

	const pdf = await readFile(files[0]);
	const r1 = await say("Загрузи выписку", [{ fileName: path.basename(files[0]), mimeType: "application/pdf", content: pdf.toString("base64") }]);
	if (r1.state === "WAITING_CONFIRMATION") await say("да");

	const r3 = await say("Распечатай первое исходящее платёжное поручение из этой выписки в PDF и в Excel");
	const att = r3.attachments ?? [];
	check(att.length >= 2, `получены файлы (${att.map((a) => `${a.fileName} ${a.size} Б`).join("; ")})`);

	for (const a of att) {
		const r = await fetch(`${BASE}${a.url}?organizationUuid=${ORG}`, { headers: H });
		const buf = Buffer.from(await r.arrayBuffer());
		const magic = buf.subarray(0, 4).toString("latin1");
		check(r.status === 200 && buf.length === a.size, `скачан ${a.fileName}: HTTP ${r.status}, ${buf.length} Б, ${r.headers.get("content-type")}, magic=${JSON.stringify(magic)}`);
	}

	// история: файлы видны при переоткрытии диалога
	const se = (await (await fetch(`${BASE}/v1/conversations/${conversationId}?organizationUuid=${ORG}`, { headers: H })).json()) as Env<{ messages: { role: string; attachments?: FileRef[] }[] }>;
	const inHistory = (se.data?.messages ?? []).flatMap((m) => m.attachments ?? []).length;
	check(inHistory >= att.length, `файлы сохранены в истории диалога (${inHistory})`);

	await Promise.all([db.end(), erp.end()]);
	console.log(rc ? "\nЕСТЬ ОШИБКИ" : "\nВСЁ ПРОШЛО");
	return rc;
}

main().then((rc) => process.exit(rc)).catch((e) => { console.error("FATAL:", e instanceof Error ? e.message : e); process.exit(2); });
