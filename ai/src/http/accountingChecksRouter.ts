// Проверки учёта в базах клиентов — операторские маршруты (E17, СК2.2).
//
//   POST /v1/onec/accounting-checks/run    запустить прогон сейчас { baseKey? } → 202 { runId }
//   GET  /v1/onec/accounting-checks/runs   последние 20 прогонов и идущий
//
// ОТДЕЛЬНЫЙ РОУТЕР, А НЕ onecRouter. Права те же, что у панели 1С (право «Администрирование 1С»; запуск —
// с полным доступом), но маршрутам не нужно ничего из её механики: ни кластера и его лимита частоты, ни
// выбора сервера, ни разбора базы в пути. Монтируется в server.ts ПЕРЕД onecRouter на тот же префикс.
//
// ДОСТУП. Смотреть журнал — право «Администрирование 1С»; запускать — только с полным доступом: прогон по всем
// базам клиентов занимает их сеансы и лицензии, как ночная выгрузка (её расписание тоже требует полного доступа,
// onec/access.ts). В многоклиентской установке (ONEC_SERVER_SCOPE=organizations) прогон идёт по базам ВСЕХ
// клиентов, и сводка называет их базы и БИНы — поэтому оба маршрута открыты только администратору BuhProf.

import { Router, type RequestHandler } from "express";
import type { Db } from "../db/pool.ts";
import type { Config } from "../config.ts";
import type { Logger } from "../logger.ts";
import type { Audit } from "../audit/index.ts";
import { requireErpUser } from "../auth/index.ts";
import type { AccountingCheckRunStore, AccountingChecksRunner } from "../onec/accountingChecksRunner.ts";

export function accountingChecksRouter(deps: {
	erp: Db;
	cfg: Pick<Config, "JWT_SECRET" | "ONEC_SERVER_SCOPE">;
	runner: Pick<AccountingChecksRunner, "start" | "running">;
	store: Pick<AccountingCheckRunStore, "list">;
	audit?: Pick<Audit, "write"> | null;
	log: Pick<Logger, "error">;
}) {
	const { erp, cfg, runner, store, log } = deps;
	const audit = deps.audit ?? null;
	const r = Router({ strict: true });

	/** Отказ промиса — ответ 500, а не повисший запрос: express 4 асинхронных отказов не ловит. */
	const wrap = (h: RequestHandler): RequestHandler => (req, res, next) => {
		Promise.resolve(h(req, res, next)).catch((e: unknown) => {
			log.error({ err: e instanceof Error ? e.message : String(e), path: req.path }, "проверки учёта: сбой маршрута");
			if (!res.headersSent) res.status(500).json({ success: false, error: { code: "INTERNAL", message: "Внутренняя ошибка сервиса — повторите позже" } });
		});
	};

	r.use(wrap(requireErpUser(erp, cfg.JWT_SECRET)));
	r.use((req, res, next) => {
		const u = req.erpUser!;
		if (!u.isSuperAdmin && !u.canOnecAdmin) {
			res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Нужно право «Администрирование 1С»" } });
			return;
		}
		if (cfg.ONEC_SERVER_SCOPE === "organizations" && !u.isSuperAdmin) {
			res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Проверки учёта идут по базам всех клиентов — этот раздел открыт администратору BuhProf" } });
			return;
		}
		next();
	});

	r.get("/runs", wrap(async (_req, res) => {
		res.json({ success: true, data: { running: runner.running, items: await store.list(20) } });
	}));

	r.post("/run", wrap(async (req, res) => {
		const u = req.erpUser!;
		if (!u.canOnecWrite) {
			res.status(403).json({ success: false, error: {
				code: "FORBIDDEN_READONLY",
				message: "Доступ только на просмотр: запуск проверок по базам клиентов требует права «Администрирование 1С» с полным доступом",
			} });
			return;
		}
		const raw = (req.body as { baseKey?: unknown } | undefined)?.baseKey;
		if (raw !== undefined && raw !== null && (typeof raw !== "string" || raw.trim().length > 200)) {
			res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "baseKey: имя базы 1С строкой" } });
			return;
		}
		const baseKey = typeof raw === "string" && raw.trim() ? raw.trim() : null;
		const started = await runner.start({ kind: "manual", userUuid: u.uuid, baseKey });
		if (!started.ok) {
			res.status(409).json({ success: false, error: { code: started.code, message: started.message, ...(started.runId ? { details: { runId: started.runId } } : {}) } });
			return;
		}
		// Прогон идёт часами: итог — в журнале (GET /runs), а сбои прогон пишет туда и в лог сам.
		void started.done.catch(() => {});
		await audit?.write({ event: "onec.accounting_checks.run", userUuid: u.uuid, details: { runId: started.runId, baseKey } });
		res.status(202).json({ success: true, data: { runId: started.runId } });
	}));

	return r;
}
