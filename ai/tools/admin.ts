// Административная CLI для AI Service. Ключ берётся из окружения (AGENT_ADMIN_KEY через
// --env-file=.env), адрес — из PUBLIC_URL или --url. Секреты в вывод не попадают: токен
// нового агента пишется прямо в файл конфигурации агента, если указан --agent-toml.
//
//   node --experimental-strip-types --env-file=.env tools/admin.ts agents
//   node ... tools/admin.ts create-agent --org <uuid> --name "..." [--agent-toml <путь>]
//   node ... tools/admin.ts rotate --agent <id> [--agent-toml <путь>]
//   node ... tools/admin.ts disable|enable --agent <id>
//   node ... tools/admin.ts command --agent <id> --type HEALTH [--payload '{...}'] [--request-id <uuid>]

import { readFile, writeFile } from "node:fs/promises";

const argv = process.argv.slice(2);
const cmd = argv[0] ?? "help";
const opt = new Map<string, string>();
for (let i = 1; i < argv.length; i += 2) opt.set(argv[i].replace(/^--/, ""), argv[i + 1] ?? "");

const base = (opt.get("url") ?? process.env.PUBLIC_URL ?? "http://127.0.0.1:3100").replace(/\/$/, "");
const key = process.env.AGENT_ADMIN_KEY ?? "";
if (!key) {
	console.error("AGENT_ADMIN_KEY не задан (запускайте с --env-file=.env)");
	process.exit(2);
}

type Envelope<T> = { success: boolean; data?: T; error?: { code: string; message: string } };

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
	const r = await fetch(base + path, {
		method,
		headers: { "content-type": "application/json", "x-admin-key": key },
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	const env = (await r.json()) as Envelope<T>;
	if (!env.success || env.data === undefined) {
		throw new Error(`${method} ${path} → HTTP ${r.status} ${env.error?.code ?? ""}: ${env.error?.message ?? ""}`);
	}
	return env.data;
}

/** Вписывает id/токен/адрес в agent.toml, не показывая токен. */
async function patchAgentToml(path: string, agentId: string | null, token: string): Promise<void> {
	let toml = await readFile(path, "utf8");
	if (agentId) toml = toml.replace(/^id\s*=.*$/m, `id = "${agentId}"`);
	toml = toml
		.replace(/^(\[cloud\][\s\S]*?^url\s*=).*$/m, `$1 "${base}"`)
		.replace(/^(\[cloud\][\s\S]*?^token\s*=).*$/m, `$1 "${token}"`);
	await writeFile(path, toml, "utf8");
	console.log(`agent.toml обновлён: ${path} (cloud.url = ${base}, токен записан)`);
}

type AgentView = { id: string; name: string; organizationUuid: string; status: string; online: boolean; onec: { reachable: boolean; version: string | null }; lastSeenAt: string | null; disabled: boolean };

async function main(): Promise<void> {
	switch (cmd) {
		case "agents": {
			const d = await call<{ items: AgentView[] }>("GET", "/admin/v1/agents");
			if (!d.items.length) console.log("агентов нет");
			for (const a of d.items) {
				console.log(`${a.id}  ${a.online ? "ONLINE " : "offline"}  1С:${a.onec.reachable ? "да" : "нет"}${a.onec.version ? " v" + a.onec.version : ""}  ${a.name || "-"}  org=${a.organizationUuid}${a.disabled ? "  [ОТКЛЮЧЁН]" : ""}  seen=${a.lastSeenAt ?? "-"}`);
			}
			break;
		}
		case "create-agent": {
			const org = opt.get("org");
			if (!org) throw new Error("--org обязателен");
			const d = await call<{ agent: AgentView; token: string }>("POST", "/admin/v1/agents", { organizationUuid: org, name: opt.get("name") ?? "" });
			console.log(`агент создан: ${d.agent.id} (org ${org})`);
			const tomlPath = opt.get("agent-toml");
			if (tomlPath) await patchAgentToml(tomlPath, d.agent.id, d.token);
			else console.log("токен (показан один раз):", d.token);
			break;
		}
		case "rotate": {
			const id = opt.get("agent");
			if (!id) throw new Error("--agent обязателен");
			const d = await call<{ token: string }>("POST", `/admin/v1/agents/${id}/rotate-token`);
			const tomlPath = opt.get("agent-toml");
			if (tomlPath) await patchAgentToml(tomlPath, id, d.token);
			else console.log("новый токен (показан один раз):", d.token);
			break;
		}
		case "disable":
		case "enable": {
			const id = opt.get("agent");
			if (!id) throw new Error("--agent обязателен");
			await call("POST", `/admin/v1/agents/${id}/${cmd}`);
			console.log(`агент ${id}: ${cmd === "disable" ? "отключён" : "включён"}`);
			break;
		}
		case "command": {
			const id = opt.get("agent");
			const type = opt.get("type");
			if (!id || !type) throw new Error("--agent и --type обязательны");
			const payload = opt.has("payload") ? JSON.parse(opt.get("payload")!) : {};
			const c = await call<{ id: string }>("POST", "/admin/v1/commands", { agentId: id, type, payload, requestId: opt.get("request-id") });
			const r = await call<{ state: string; result: unknown; error: unknown }>("GET", `/admin/v1/commands/${c.id}?wait=90`);
			console.log(JSON.stringify(r, null, 2));
			break;
		}
		default:
			console.log("команды: agents | create-agent --org <uuid> [--name] [--agent-toml] | rotate --agent <id> [--agent-toml] | disable|enable --agent <id> | command --agent <id> --type <TYPE> [--payload json] [--request-id uuid]");
	}
}

main().catch((e) => {
	console.error("ошибка:", e instanceof Error ? e.message : e);
	process.exit(1);
});
