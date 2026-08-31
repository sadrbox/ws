// Сквозной тест поступления товаров и услуг через чат на живом сервисе: «оформи поступление от
// поставщика … услуга … 1 × 100 ₸» → карточка подтверждения create_purchase → «да» → документ
// создан в 1С → печать приходной накладной в PDF по просьбе.
//
//   node --experimental-strip-types --env-file=.env --env-file=.env.local tools/purchase_chat_e2e.ts [--base URL] [--org uuid] [--supplier «Банк ЦентрКредит»] [--product хранилище]

import jwt from "jsonwebtoken";
import { loadConfig } from "../src/config.ts";
import { createPools } from "../src/db/pool.ts";

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i++) if (process.argv[i].startsWith("--")) args.set(process.argv[i].slice(2), process.argv[++i]);
const BASE = args.get("base") ?? "http://192.168.1.112:3100";
const ORG = args.get("org") ?? "a1410911-7421-45da-9632-7e4fc48e91c2";
const SUPPLIER = args.get("supplier") ?? "Банк ЦентрКредит";
const PRODUCT = args.get("product") ?? "хранилище";

type FileRef = { fileId: string; fileName: string; mimeType: string; size: number; url: string };
type Reply = { conversationId: string; state: string; text: string; attachments?: FileRef[]; confirmation?: { tool: string; card: string } | null };
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
		if (r.status === 429) {
			// Лимит ходов чата (RATE_LIMITED): ждём Retry-After и повторяем — это не ошибка сценария.
			const wait = Number((env.error as { retryAfterSec?: number } | undefined)?.retryAfterSec ?? 60) + 1;
			console.log(`лимит запросов, ждём ${wait} с`);
			await new Promise((x) => setTimeout(x, wait * 1000));
			return say(text);
		}
		if (!env.success || !env.data) throw new Error(`HTTP ${r.status}: ${JSON.stringify(env.error)}`);
		conversationId = env.data.conversationId;
		let data: Reply = env.data;
		while (data.state === "PROCESSING" || ["UNDERSTANDING", "EXECUTING", "IDLE"].includes(data.state)) {
			await new Promise((x) => setTimeout(x, 3000));
			const sr = await fetch(`${BASE}/v1/conversations/${conversationId}?organizationUuid=${ORG}`, { headers: H });
			const se = (await sr.json()) as Env<{ state: string; messages: { role: string; text: string; attachments?: FileRef[] }[]; confirmation?: { tool: string; card: string } | null }>;
			if (!se.success || !se.data) throw new Error("не удалось прочитать диалог");
			if (["UNDERSTANDING", "EXECUTING", "IDLE"].includes(se.data.state)) continue;
			const last = [...se.data.messages].reverse().find((m) => m.role === "assistant");
			data = { conversationId, state: se.data.state, text: last?.text ?? "", attachments: last?.attachments ?? [], confirmation: se.data.confirmation ?? null };
		}
		console.log(`>>> ${text}\n<<< [${data.state}, ${((Date.now() - started) / 1000).toFixed(1)} с]\n${data.text}\n${(data.attachments ?? []).map((a) => `   📎 ${a.fileName} (${a.size} Б)`).join("\n")}\n`);
		return data;
	};
	let rc = 0;
	const check = (cond: boolean, what: string) => { console.log(`${cond ? "PASS" : "FAIL"}: ${what}`); if (!cond) rc = 1; };

	const r1 = await say(`Оформи поступление от поставщика «${SUPPLIER}» по организации ТОО «ПРЕКАСТ КЗ» (БИН 221140044855): «${PRODUCT}», 1 шт по 100 тенге, накладная поставщика № 77 от 25.08.2026`);
	check(r1.state === "WAITING_CONFIRMATION" && r1.confirmation?.tool === "create_purchase", "запрос поступления — карточка подтверждения create_purchase");
	if (r1.state !== "WAITING_CONFIRMATION") return finish(rc, db, erp);

	const r2 = await say("да");
	check(/поступлени/i.test(r2.text) && /\d/.test(r2.text), "после «да» — документ создан, в ответе номер и сумма");
	check(r2.state !== "WAITING_CONFIRMATION", "документ не проводится без просьбы");

	const r3 = await say("Пришли приходную накладную в PDF");
	const files = r3.attachments ?? [];
	check(files.length === 1 && files[0].fileName.toLowerCase().endsWith(".pdf") && files[0].size > 1000, `PDF накладной: ${files.map((a) => `${a.fileName} ${a.size} Б`).join("; ") || "нет вложения"}`);
	return finish(rc, db, erp);
}

async function finish(rc: number, db: { end: () => Promise<void> }, erp: { end: () => Promise<void> }) {
	await Promise.all([db.end(), erp.end()]);
	console.log(rc ? "\nЕСТЬ ОШИБКИ" : "\nВСЁ ПРОШЛО");
	return rc;
}

main().then((rc) => process.exit(rc)).catch((e) => { console.error("FATAL:", e instanceof Error ? e.message : e); process.exit(2); });
