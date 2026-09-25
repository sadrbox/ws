// API пользователей ERP (JWT бэкенда). Первый прирост — только сведения об агентах своей
// организации; диалог с LLM добавится в chat/ следующим циклом и смонтируется сюда же.
//
//   GET /v1/me            кто я с точки зрения AI Service (uuid, активная организация)
//   GET /v1/agents        агенты активной организации и их состояние (1С доступна?)
//   GET /v1/status        сводка для панели: сервис, модель (последняя ошибка), агент и база 1С
//   GET /v1/organization-bases  базы 1С организации: откуда приходят её задачи, заметки и документы
//   POST /v1/chat, GET /v1/conversations/:id — см. chatRouter (если LLM настроена)

import { describeAgentBases, type AgentBasesStore } from "../agents/agentBases.ts";
import { Router } from "express";
import type { Db } from "../db/pool.ts";
import type { Config } from "../config.ts";
import { requireErpUser } from "../auth/index.ts";
import type { AgentService } from "../agents/service.ts";
import type { ChatWorkflow } from "../chat/workflow.ts";
import type { Logger } from "../logger.ts";
import type { FileStore } from "../files/store.ts";
import { chatRouter } from "./chatRouter.ts";
import { llmHealth } from "../llm/health.ts";
import type { CommandQueue } from "../commands/queue.ts";
import type { Audit } from "../audit/index.ts";
import { agentKnowsType } from "../commands/admin.ts";

export function userRouter(deps: {
	erp: Db; cfg: Config; agents: AgentService; workflow: ChatWorkflow | null; log: Logger; files: FileStore; version: string;
	/** База сервиса: реестр баз 1С и их организаций (ПН4). Нет — список баз организации не отдаём. */
	db?: Db;
	/** Срез баз бизнес-агентов (C12): список агентов показывает их базы и лимит. Нет — без баз. */
	agentBases?: Pick<AgentBasesStore, "listMany">;
	/**
	 * Очередь команд агенту: нужна для чисел из 1С в карточке организации (ПН9). Без неё маршрут отвечает
	 * «не включено» — сервис без агентов эти числа взять неоткуда.
	 */
	queue?: Pick<CommandQueue, "enqueue" | "waitResult">;
	audit?: Pick<Audit, "write">;
}) {
	const { erp, cfg, agents, workflow, log, files, version, agentBases } = deps;
	const queue = deps.queue ?? null;
	const audit = deps.audit ?? null;
	const db = deps.db ?? erp;
	const r = Router();
	r.use(requireErpUser(erp, cfg.JWT_SECRET));
	if (workflow) r.use(chatRouter({ workflow, log, maxAttachmentBytes: cfg.CHAT_ATTACHMENT_MAX_MB * 1048576, chatPerMin: cfg.RATE_LIMIT_CHAT_PER_MIN, attachmentsPerMin: cfg.RATE_LIMIT_ATTACHMENTS_PER_MIN }));

	r.get("/me", (req, res) => {
		const u = req.erpUser!;
		res.json({ success: true, data: { uuid: u.uuid, organizationUuid: u.organizationUuid, isOrgAdmin: u.isOrgAdmin, isSuperAdmin: u.isSuperAdmin } });
	});

	// Файл диалога (печатная форма, отчёт): только своей организации, пока не истёк срок хранения.
	r.get("/files/:id", async (req, res) => {
		const u = req.erpUser!;
		const requested = typeof req.query.organizationUuid === "string" ? req.query.organizationUuid : null;
		const org = requested && (u.isSuperAdmin || u.allowedOrgUuids.includes(requested)) ? requested : u.organizationUuid;
		const f = org && /^[0-9a-f-]{36}$/i.test(req.params.id) ? await files.get(req.params.id, org) : null;
		if (!f) {
			res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Файл не найден или срок его хранения истёк" } });
			return;
		}
		res.setHeader("Content-Type", f.mimeType);
		res.setHeader("Content-Length", String(f.size));
		res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(f.fileName)}`);
		res.setHeader("Cache-Control", "private, max-age=3600");
		res.end(f.content);
	});

	/*
	 * БАЗЫ 1С ОРГАНИЗАЦИИ (ПН4 плана PLAN_TASKS_NOTES_PANEL_SERVICE_2026-09-22).
	 *
	 * ЗАЧЕМ. В карточке организации видно её договоры, склады и кассы — а откуда приходят задачи, заметки
	 * и документы из 1С, не видно нигде. Разбор «эта задача откуда?» начинался с похода к администратору.
	 *
	 * ЧТО СЧИТАЕТСЯ БАЗОЙ ОРГАНИЗАЦИИ — две разные связи, и обе нужны:
	 *   — базе выдан токен чата для этой организации (`base_tokens.organization_uuid`): так база
	 *     попадает в ERP вообще;
	 *   — база назвала БИН этой организации в своём списке (`base_organizations`): многофирменная база
	 *     ведёт несколько организаций одним токеном, и по БИН адресуются задачи.
	 * Первая связь без второй — база подключена, но эту организацию не ведёт; вторая без первой —
	 * называет БИН, но чат ей не выдан. Обе видны как есть, догадки тут ни к чему.
	 *
	 * Доступ — по организации, а не по праву «Администрирование 1С»: это сведения о своей организации,
	 * и смотрит их бухгалтер в её карточке.
	 */
	r.get("/organization-bases", async (req, res) => {
		const u = req.erpUser!;
		const requested = typeof req.query.organizationUuid === "string" ? req.query.organizationUuid.trim() : "";
		const org = requested || u.organizationUuid;
		if (!org) {
			res.status(409).json({ success: false, error: { code: "ORGANIZATION_REQUIRED", message: "У пользователя не выбрана активная организация" } });
			return;
		}
		if (!u.isSuperAdmin && !u.allowedOrgUuids.includes(org)) {
			res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Эта организация не в вашем доступе" } });
			return;
		}
		// БИН берём у ERP, а не у клиента: по присланному БИН можно было бы посмотреть чужие базы.
		const o = await erp.query<{ bin: string | null }>(`SELECT bin FROM organizations WHERE uuid = $1`, [org]);
		const bin = (o.rows[0]?.bin ?? "").trim();
		const rows = await db.query<{
			key: string; name: string | null; server_name: string | null; disabled_at: Date | null;
			tokens: string; revoked: string; bin: string | null; org_name: string | null; declared_at: Date | null; last_seen: Date | null;
		}>(
			`SELECT b.key, b.name, s.name AS server_name, b.disabled_at,
			        count(t.id) FILTER (WHERE t.revoked_at IS NULL AND (t.accepted_until IS NULL OR t.accepted_until > now())) AS tokens,
			        count(t.id) FILTER (WHERE t.revoked_at IS NOT NULL) AS revoked,
			        o.bin, o.name AS org_name, o.updated_at AS declared_at, b.last_seen_at AS last_seen
			   FROM bases b
			   JOIN servers s ON s.id = b.server_id
			   LEFT JOIN base_tokens t ON t.base_id = b.id AND t.organization_uuid = $1
			   -- base_organizations.base_id — text (миграция 040), bases.id — uuid: без приведения Postgres
			   -- откажется сравнивать их вовсе.
			   LEFT JOIN base_organizations o ON o.base_id = b.id::text AND $2 <> '' AND o.bin = $2
			  WHERE t.id IS NOT NULL OR o.bin IS NOT NULL
			  GROUP BY b.key, b.name, s.name, b.disabled_at, o.bin, o.name, o.updated_at, b.last_seen_at
			  ORDER BY b.key`,
			[org, bin],
		);
		res.json({ success: true, data: { bin: bin || null, items: rows.rows.map((x) => ({
			baseKey: x.key,
			name: x.name || x.key,
			serverName: x.server_name,
			disabled: !!x.disabled_at,
			// Токен чата этой организации: есть действующий, есть только отозванные, или нет вовсе.
			chat: Number(x.tokens) > 0 ? "active" : Number(x.revoked) > 0 ? "revoked" : "none",
			declaredBin: x.bin,
			declaredAt: x.declared_at,
			lastSeenAt: x.last_seen,
		})) } });
	});

	/**
	 * ЧИСЛА ИЗ 1С В КАРТОЧКЕ ОРГАНИЗАЦИИ (ПН9): задолженность контрагентов и остатки по счетам.
	 *
	 * ЗДЕСЬ, А НЕ В `/v1/onec`: весь тот раздел закрыт правом «Администрирование 1С», а эти числа смотрит
	 * бухгалтер в карточке СВОЕЙ организации. Доступ — по организации, как у списка баз выше.
	 *
	 * НЕ КЭШИРУЕТСЯ (решение владельца, 22.09). Кэш означал бы третью версию правды рядом с 1С и панелью;
	 * вместо него в ответе `readAt` — на какой миг числа верны.
	 *
	 * ЖДЁМ ДОЛЬШЕ ОБЫЧНОГО. Ответ на «сколько нам должны» 1С считает по регистрам, и двадцати секунд, что
	 * отведены командам панели, ей часто мало. Ждём `ORG_FINANCE_TIMEOUT_SECS` (по умолчанию 60): пустая
	 * карточка с «1С не ответила» у базы, которая просто думает, — худший из возможных ответов.
	 *
	 * ДВЕ КОМАНДЫ ПАРАЛЛЕЛЬНО и независимо: долги могли не дасться, а остатки дались — показываем, что есть.
	 */
	r.post("/organization-finance", async (req, res) => {
		const u = req.erpUser!;
		const body = (req.body ?? {}) as { organizationUuid?: unknown; onDate?: unknown };
		const requested = typeof body.organizationUuid === "string" ? body.organizationUuid.trim() : "";
		const org = requested || u.organizationUuid;
		if (!org) {
			res.status(409).json({ success: false, error: { code: "ORGANIZATION_REQUIRED", message: "У пользователя не выбрана активная организация" } });
			return;
		}
		if (!u.isSuperAdmin && !u.allowedOrgUuids.includes(org)) {
			res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Эта организация не в вашем доступе" } });
			return;
		}
		if (!queue) {
			res.status(503).json({ success: false, error: { code: "AGENTS_DISABLED", message: "Служба агентов 1С не настроена — чисел из 1С нет" } });
			return;
		}
		// БИН берём у ERP, а не у клиента: по присланному БИН можно было бы спросить чужую базу.
		const o = await erp.query<{ bin: string | null; name: string | null }>(`SELECT bin, name FROM organizations WHERE uuid = $1`, [org]);
		const bin = (o.rows[0]?.bin ?? "").trim();
		const orgName = o.rows[0]?.name ?? null;
		if (!/^\d{12}$/.test(bin)) {
			res.status(409).json({ success: false, error: { code: "ORG_BIN_REQUIRED", message: "У организации не указан БИН — по нему находится её база 1С" } });
			return;
		}
		const target = await agents.resolveBusiness(org, { bin });
		if (target.kind === "refused") {
			res.status(409).json({ success: false, error: { code: target.code, message: target.message } });
			return;
		}
		if (target.kind !== "agent") {
			res.status(409).json({ success: false, error: { code: "AGENT_OFFLINE", message: `Базу организации «${orgName ?? bin}» некому спросить: агент BuhProf не на связи или база с этим БИН ему неизвестна` } });
			return;
		}
		if (!agentKnowsType(target.agent, "GET_DEBTS")) {
			res.status(409).json({ success: false, error: { code: "CAPABILITY_MISSING", message: "Агент BuhProf этой базы не умеет читать задолженность и остатки — обновите агента" } });
			return;
		}
		const onDate = typeof body.onDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.onDate)
			? body.onDate
			: new Date().toISOString().slice(0, 10);
		const waitMs = cfg.ORG_FINANCE_TIMEOUT_SECS * 1000;
		const ask = async (type: string, payload: Record<string, unknown>) => {
			const cmd = await queue.enqueue({
				agentId: target.agent.id, organizationUuid: target.agent.organizationUuid, baseKey: target.baseKey,
				type, payload, userUuid: u.uuid, ttlSeconds: Math.max(cfg.ORG_FINANCE_TIMEOUT_SECS * 2, 120),
			});
			await audit?.write({ event: "onec.finance", organizationUuid: org, userUuid: u.uuid, agentId: target.agent.id, commandId: cmd.id, details: { type, bin } });
			const done = await queue.waitResult(cmd.id, waitMs);
			if (!done || done.state === "queued" || done.state === "dispatched") {
				// Команда жива и, скорее всего, выполнится — но ответ нужен сейчас: честно говорим, что ждём.
				return { ok: false as const, error: { code: "TIMEOUT", message: `1С не ответила за ${cfg.ORG_FINANCE_TIMEOUT_SECS} с — повторите чтение` } };
			}
			if (done.state !== "done") {
				const e = done.error ?? { code: "COMMAND_FAILED", message: "1С не выполнила команду" };
				return { ok: false as const, error: { code: e.code, message: e.message } };
			}
			return { ok: true as const, data: done.result ?? null };
		};
		const [debts, balances] = await Promise.all([
			ask("GET_DEBTS", { onDate, kind: "both", organizationBin: bin, limit: 20 }),
			ask("GET_BALANCES", { onDate, organizationBin: bin }),
		]);
		res.json({ success: true, data: {
			onDate, bin, baseKey: target.baseKey, agentId: target.agent.id,
			readAt: new Date().toISOString(), debts, balances,
		} });
	});

	r.get("/agents", async (req, res) => {
		const org = req.erpUser!.organizationUuid;
		if (!org) {
			res.status(409).json({ success: false, error: { code: "ORGANIZATION_REQUIRED", message: "У пользователя не выбрана активная организация" } });
			return;
		}
		const list = await agents.visibleTo(org);
		// Роль и базы (C12): у многобазового бизнес-агента «на связи» ещё не значит, что нужная база доступна.
		const slices = agentBases ? await agentBases.listMany(list.filter((a) => a.role === "business").map((a) => a.id)) : new Map();
		const items = list.map((a) => {
			const view = a.role === "business" && slices.has(a.id) ? describeAgentBases(slices.get(a.id) ?? [], a.limits) : null;
			return {
				id: a.id, name: a.name, role: a.role, status: a.status, online: a.online, onec: a.onec, version: a.version, lastSeenAt: a.lastSeenAt,
				...(view ? {
					limits: view.limits, usage: view.usage,
					bases: view.bases.map((b) => ({ key: b.key, status: b.status, transport: b.transport, overLimit: b.overLimitService || b.overLimit === true })),
				} : {}),
			};
		});
		res.json({ success: true, data: { items } });
	});

	// Панель статуса в чате: одна сводка вместо трёх запросов. Агент и база — по активной
	// организации; модель — по последнему обращению к провайдеру (см. llm/health.ts).
	r.get("/status", async (req, res) => {
		const org = req.erpUser!.organizationUuid;
		// Статус чата — про бизнес-агентов (C12, C13): документы проводят они; админ-агент на связи чату не помогает.
		const list = org ? (await agents.visibleTo(org)).filter((a) => a.role === "business") : [];
		const items = list.map((a) => ({ id: a.id, name: a.name, online: a.online, onec: a.onec, version: a.version, lastSeenAt: a.lastSeenAt }));
		const a = items.find((x) => x.online && x.onec.reachable) ?? items.find((x) => x.online) ?? items[0] ?? null;
		res.json({
			success: true,
			data: {
				service: { version, chat: workflow !== null, model: cfg.LLM_MODEL },
				llm: llmHealth(),
				agent: a ? { configured: true, online: a.online, name: a.name, version: a.version, lastSeenAt: a.lastSeenAt } : { configured: false, online: false, name: null, version: null, lastSeenAt: null },
				/*
				 * ЧТО ЗА ВЕРСИЯ — ЗАВИСИТ ОТ РОЛИ АГЕНТА (25.09).
				 *
				 * Поле `onec.version` агент шлёт одно, а смысл у него разный: админ-агент
				 * разговаривает с кластером и рапортует версию ПЛАТФОРМЫ (8.3.25.1257),
				 * бизнес-агент говорит с базой через шлюз расширения и рапортует версию
				 * РАСШИРЕНИЯ buhprof_api (1.6.1). Панель показывала это одной подписью «База
				 * 1С», и разбираться, что именно перед тобой, приходилось ровно в тот момент,
				 * когда что-то сломалось.
				 *
				 * Здесь выбираются только бизнес-агенты (см. выше), поэтому `kind` — всегда
				 * `extension`; поле отдаём явно, чтобы панель не догадывалась, а читала.
				 * Когда агент начнёт слать версии раздельно (задача стороны 1С), сюда придёт
				 * настоящее значение, а панель менять не придётся.
				 */
				onec: {
					reachable: a?.online === true && a.onec.reachable,
					version: a?.onec.version ?? null,
					kind: "extension" as const,
				},
				organizationSelected: Boolean(org),
				at: new Date().toISOString(),
			},
		});
	});

	return r;
}
