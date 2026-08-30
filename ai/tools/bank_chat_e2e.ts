// Сквозной тест выписки через чат на ЖИВОМ сервисе: PDF → распознавание → подтверждение →
// загрузка в 1С через рабочего агента → проведение по подтверждению.
//
//   node --experimental-strip-types --env-file=.env --env-file=.env.local tools/bank_chat_e2e.ts <файл.pdf> [--base http://192.168.1.112:3100] [--org uuid]
//
// JWT подписывается JWT_SECRET (как в chat_e2e). Пользователь — первый с доступом к организации.

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

type Reply = { conversationId: string; state: string; text: string; confirmation?: { tool: string; card: string } | null };
type Env<T> = { success: boolean; data?: T; error?: { code: string; message: string } };

async function main(): Promise<number> {
	if (!files.length) throw new Error("укажите PDF");
	const cfg = loadConfig({ ...process.env, LOG_LEVEL: "warn" });
	const { db, erp } = createPools(cfg.DATABASE_URL, cfg.ERP_DATABASE_URL);
	const u = await erp.query<{ uuid: string; username: string | null }>(
		`SELECT u.uuid, u.username FROM users u JOIN access_rights a ON a."userUuid" = u.uuid
		  WHERE a."organizationUuid" = $1 AND u."deletedAt" IS NULL ORDER BY (a.role = 'admin') DESC, u.id LIMIT 1`, [ORG]);
	if (!u.rows[0]) throw new Error("нет пользователя ERP для организации");
	const token = jwt.sign({ uuid: u.rows[0].uuid }, cfg.JWT_SECRET, { expiresIn: "1h" });
	console.log(`сервис ${BASE}; пользователь ${u.rows[0].username ?? u.rows[0].uuid}\n`);

	let conversationId: string | null = null;
	const say = async (text: string, attachments?: { fileName: string; mimeType: string; content: string }[]) => {
		const started = Date.now();
		const r = await fetch(`${BASE}/v1/chat`, {
			method: "POST",
			headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
			body: JSON.stringify({ conversationId, text, organizationUuid: ORG, ...(attachments ? { attachments } : {}) }),
		});
		const env = (await r.json()) as Env<Reply>;
		if (!env.success || !env.data) throw new Error(`HTTP ${r.status}: ${JSON.stringify(env.error)}`);
		conversationId = env.data.conversationId;
		let data: Reply = env.data;
		// Долгие ходы (вложения, много раундов) сервис уводит в фон: дочитываем из состояния диалога.
		while (data.state === "PROCESSING" || ["UNDERSTANDING", "EXECUTING", "IDLE"].includes(data.state)) {
			await new Promise((x) => setTimeout(x, 3000));
			const sr = await fetch(`${BASE}/v1/conversations/${conversationId}?organizationUuid=${ORG}`, { headers: { authorization: `Bearer ${token}` } });
			const se = (await sr.json()) as Env<{ id: string; state: string; messages: { role: string; text: string }[]; confirmation?: { tool: string; card: string } | null }>;
			if (!se.success || !se.data) throw new Error("не удалось прочитать диалог");
			if (["UNDERSTANDING", "EXECUTING", "IDLE"].includes(se.data.state)) continue;
			const last = [...se.data.messages].reverse().find((m) => m.role === "assistant");
			data = { conversationId, state: se.data.state, text: last?.text ?? "", confirmation: se.data.confirmation ?? null };
		}
		console.log(`>>> ${text || "(вложение)"}${attachments ? ` [${attachments.map((a) => a.fileName).join(", ")}]` : ""}`);
		console.log(`<<< [${data.state}, ${((Date.now() - started) / 1000).toFixed(1)} с]\n${data.text}\n`);
		return data;
	};

	let rc = 0;
	const check = (cond: boolean, what: string) => { console.log(`${cond ? "PASS" : "FAIL"}: ${what}`); if (!cond) rc = 1; };

	const pdf = await readFile(files[0]);
	const r1 = await say("Загрузи выписку", [{ fileName: path.basename(files[0]), mimeType: "application/pdf", content: pdf.toString("base64") }]);
	check(r1.state === "WAITING_CONFIRMATION" && r1.confirmation?.tool === "import_bank_statement", "после PDF — карточка подтверждения загрузки");
	if (r1.state !== "WAITING_CONFIRMATION") return finish(rc, db, erp);

	const r2 = await say("да");
	check(/создан|уже|загруж/i.test(r2.text), "после «да» — отчёт о загрузке");
	check(r2.state !== "WAITING_CONFIRMATION", "документы не проводятся без просьбы");

	const r3 = await say("Проведи все документы из этой выписки");
	check(r3.state === "WAITING_CONFIRMATION" && r3.confirmation?.tool === "post_bank_documents", "запрос проведения — карточка подтверждения");
	if (r3.state === "WAITING_CONFIRMATION") {
		const r4 = await say("да");
		check(/провед/i.test(r4.text), "после «да» — отчёт о проведении");
	}
	return finish(rc, db, erp);
}

async function finish(rc: number, db: { end: () => Promise<void> }, erp: { end: () => Promise<void> }) {
	await Promise.all([db.end(), erp.end()]);
	console.log(rc ? "\nЕСТЬ ОШИБКИ" : "\nВСЁ ПРОШЛО");
	return rc;
}

main().then((rc) => process.exit(rc)).catch((e) => { console.error("FATAL:", e instanceof Error ? e.message : e); process.exit(2); });
