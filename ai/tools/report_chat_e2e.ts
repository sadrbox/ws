// Сквозной тест отчётов через чат на живом сервисе: «сформируй ОСВ по счёту 1030 … в Excel»
// → файл вложением, скачивается по ссылке.
//
//   node --experimental-strip-types --env-file=.env --env-file=.env.local tools/report_chat_e2e.ts [--base URL] [--org uuid]

import jwt from "jsonwebtoken";
import { loadConfig } from "../src/config.ts";
import { createPools } from "../src/db/pool.ts";

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i++) if (process.argv[i].startsWith("--")) args.set(process.argv[i].slice(2), process.argv[++i]);
const BASE = args.get("base") ?? "http://192.168.1.112:3100";
const ORG = args.get("org") ?? "a1410911-7421-45da-9632-7e4fc48e91c2";

type FileRef = { fileId: string; fileName: string; mimeType: string; size: number; url: string };
type Reply = { conversationId: string; state: string; text: string; attachments?: FileRef[] };
type Env<T> = { success: boolean; data?: T; error?: { code: string; message: string } };

async function main(): Promise<number> {
	const cfg = loadConfig({ ...process.env, LOG_LEVEL: "warn" });
	const { db, erp } = createPools(cfg.DATABASE_URL, cfg.ERP_DATABASE_URL);
	const u = await erp.query<{ uuid: string }>(`SELECT u.uuid FROM users u JOIN access_rights a ON a."userUuid" = u.uuid WHERE a."organizationUuid" = $1 AND u."deletedAt" IS NULL ORDER BY (a.role = 'admin') DESC, u.id LIMIT 1`, [ORG]);
	const token = jwt.sign({ uuid: u.rows[0].uuid }, cfg.JWT_SECRET, { expiresIn: "1h" });
	const H = { authorization: `Bearer ${token}` };
	let conversationId: string | null = null;
	const say = async (text: string): Promise<Reply> => {
		const started = Date.now();
		const r = await fetch(`${BASE}/v1/chat`, { method: "POST", headers: { ...H, "content-type": "application/json" }, body: JSON.stringify({ conversationId, text, organizationUuid: ORG }) });
		const env = (await r.json()) as Env<Reply>;
		if (!env.success || !env.data) throw new Error(`HTTP ${r.status}: ${JSON.stringify(env.error)}`);
		conversationId = env.data.conversationId;
		let data: Reply = env.data;
		while (data.state === "PROCESSING" || ["UNDERSTANDING", "EXECUTING", "IDLE"].includes(data.state)) {
			await new Promise((x) => setTimeout(x, 3000));
			const se = (await (await fetch(`${BASE}/v1/conversations/${conversationId}?organizationUuid=${ORG}`, { headers: H })).json()) as Env<{ state: string; messages: { role: string; text: string; attachments?: FileRef[] }[] }>;
			if (!se.success || !se.data) throw new Error("не удалось прочитать диалог");
			if (["UNDERSTANDING", "EXECUTING", "IDLE"].includes(se.data.state)) continue;
			const last = [...se.data.messages].reverse().find((m) => m.role === "assistant");
			data = { conversationId, state: se.data.state, text: last?.text ?? "", attachments: last?.attachments };
		}
		console.log(`>>> ${text}\n<<< [${data.state}, ${((Date.now() - started) / 1000).toFixed(1)} с]\n${data.text.slice(0, 600)}\n`);
		return data;
	};
	let rc = 0;
	const check = (c: boolean, what: string) => { console.log(`${c ? "PASS" : "FAIL"}: ${what}`); if (!c) rc = 1; };

	const r1 = await say("Сформируй оборотно-сальдовую ведомость по счёту 1030 за 17–25 августа 2026 по организации ТОО «ПРЕКАСТ КЗ» (БИН 221140044855) в Excel");
	const a1 = r1.attachments ?? [];
	check(a1.length === 1 && a1[0].fileName.endsWith(".xlsx"), `ОСВ по счёту: файл ${a1.map((a) => `${a.fileName} ${a.size} Б`).join("; ")}`);
	const r2 = await say("Теперь карточку счёта 1030 за тот же период в PDF");
	const a2 = r2.attachments ?? [];
	check(a2.length === 1 && a2[0].fileName.endsWith(".pdf"), `карточка счёта: файл ${a2.map((a) => `${a.fileName} ${a.size} Б`).join("; ")}`);
	for (const a of [...a1, ...a2]) {
		const r = await fetch(`${BASE}${a.url}?organizationUuid=${ORG}`, { headers: H });
		const buf = Buffer.from(await r.arrayBuffer());
		check(r.status === 200 && buf.length === a.size, `скачан ${a.fileName}: ${r.status}, ${buf.length} Б, ${r.headers.get("content-type")}`);
	}
	await Promise.all([db.end(), erp.end()]);
	console.log(rc ? "\nЕСТЬ ОШИБКИ" : "\nВСЁ ПРОШЛО");
	return rc;
}
main().then((rc) => process.exit(rc)).catch((e) => { console.error("FATAL:", e instanceof Error ? e.message : e); process.exit(2); });
