/**
 * Пакетные операции по базам (E15/A4): одна команда пользователя → N команд по базам.
 *
 * ЗАЧЕМ ОТДЕЛЬНАЯ СУЩНОСТЬ. «Создать пользователя во всех базах» — это сто независимых
 * подключений к 1С, каждое со своим итогом. Без задания пользователь увидел бы сто
 * несвязанных операций и не понял, где что упало и что повторять.
 *
 * ПРОГРЕСС НЕ ХРАНИМ. Счётчики done/failed считаются запросом по commands.batch_id:
 * дублировать их колонками — значит держать две правды в согласии, а команда может
 * завершиться, истечь по TTL или быть переставлена в очереди.
 */
import { commandCaveat } from "./caveats.ts";
import { humanizeAgentError } from "./errorHints.ts";
import { isAbortable } from "../commands/admin.ts";
import { DEFAULT_LATE_GRACE_SECS, TIMEOUT_STILL_RUNNING } from "../commands/queue.ts";
import { checkOutcome } from "./checkOutcome.ts";

/**
 * Истёкшая выданная команда без ответа, которая ещё держит место (С3): её результат может прийти (С21).
 * То же условие, что OCCUPIES в очереди.
 */
const LATE_WAIT = (a: string, graceParam: string) => `(${a}.state = 'expired' AND ${a}.dispatched_at IS NOT NULL
	AND ${a}.result_status IS NULL AND ${a}.error->>'code' = 'COMMAND_EXPIRED'
	AND ${a}.finished_at > now() - make_interval(secs => ${graceParam}::int))`;
import { randomUUID } from "node:crypto";
import type { Db } from "../db/pool.ts";

export type BatchProgress = {
	id: string;
	type: string;
	total: number;
	done: number;
	failed: number;
	pending: number;
	createdAt: string;
	items: {
		/**
		 * Идентификатор команды — по нему её отменяют, пока она не начата.
		 *
		 * `null` бывает у двух РАЗНЫХ строк, и различает их `state`: `skipped` — команду не
		 * ставили вовсе (некому или нечего), `expired` — ставили, но её след уже вычищен.
		 */
		commandId: string | null;
		baseKey: string | null; state: string; error: { code: string; message: string } | null;
		/** Итог операции одной строкой: путь к выгрузке, адрес публикации. */
		outcome: string | null;
		/** Начатую команду можно прервать: это чтение, и агент умеет отмену (S4). */
		abortable?: boolean;
		/** Выполнено с оговоркой: признак не перечитан или свойства не приняты платформой (П12). */
		warning?: string | null;
		/**
		 * Сколько секунд команда ЖДАЛА очереди (постановка → выдача агенту) и сколько РАБОТАЛА
		 * (выдача → результат). Без этой пары «задание шло 20 минут» ничего не объясняет: почти
		 * всё это время команда могла стоять за чужой операцией по той же базе (С40, 16.09).
		 */
		queuedSecs?: number | null;
		/** Время по этапам успешной команды (агент 12:37, П28): «вход в базу», «запись»… */
		stages?: { name: string; ms: number }[] | null;
		runSecs?: number | null;
		/** Номер попытки (повтор «база занята», С19). */
		attempt?: number;
		/** Повтор стоит на паузе до этого времени (С19). */
		retryAt?: string | null;
		/** Результат пришёл после истечения срока (С21). */
		late?: boolean;
		/** Срок истёк, агент мог продолжать работу — поздний результат ещё может прийти (С21). */
		lateWait?: boolean;
		/** Агент перестал ждать (TIMEOUT), но процесс команды ещё работает (С18). */
		stillRunning?: boolean;
	}[];
	/** Сколько команд задания ещё можно отменить: их никто не начинал. */
	cancelable: number;
	/** Сколько начатых команд задания можно прервать (S4). */
	abortable: number;
};

/**
 * Через сколько считать команду задания потерянной. Команды живут час (`expires_at`) и
 * вычищаются, а задание остаётся навсегда: без этого срока оно вечно показывало бы
 * «выполняется», ожидая того, кого уже нет.
 */
const LOST_AFTER_MS = 2 * 60 * 60 * 1000;

export class BatchService {
	private readonly db: Db;

	constructor(db: Db) {
		this.db = db;
	}

	async create(input: {
		organizationUuid: string;
		userUuid: string | null;
		type: string;
		payload: Record<string, unknown>;
		total: number;
	}): Promise<string> {
		const id = randomUUID();
		await this.db.query(
			`INSERT INTO command_batches (id, organization_uuid, user_uuid, type, payload, total)
			 VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
			[id, input.organizationUuid, input.userUuid, input.type, JSON.stringify(input.payload), input.total],
		);
		return id;
	}

	/**
	 * ЗАПОМНИТЬ БАЗЫ, ДЛЯ КОТОРЫХ КОМАНДУ НЕ ПОСТАВИЛИ, — иначе задание врёт.
	 *
	 * ЖИВОЙ СЛУЧАЙ (12.09). Операцию запустили при остановленном агенте: задание завели на
	 * одну базу, команду поставить не смогли («нет агента на связи»), и `total` остался
	 * равен единице. Отчёт считал `pending = total − done − failed` и два часа показывал
	 * «В работе: 1» — задание без единой строки, без имени базы и без всякой работы. Хуже
	 * ошибки: ошибка называет себя.
	 *
	 * Теперь отсеянные базы остаются в самом задании — с причиной, по которой их отсеяли, —
	 * и попадают в отчёт строками «не поставлена». Ничего «в работе» у такого задания нет.
	 */
	async noteSkipped(batchId: string, skipped: { baseKey: string; reason: string }[]): Promise<void> {
		if (!skipped.length) return;
		await this.db.query(
			`UPDATE command_batches
			    SET payload = jsonb_set(COALESCE(payload, '{}'::jsonb), '{skipped}', $2::jsonb, true)
			  WHERE id = $1`,
			[batchId, JSON.stringify(skipped)],
		);
	}

	async attach(batchId: string, commandId: string): Promise<void> {
		await this.db.query(`UPDATE commands SET batch_id = $1 WHERE id = $2`, [batchId, commandId]);
	}

	/**
	 * Отчёт по ОДНОМУ заданию.
	 *
	 * Тонкая обёртка над `reports`: логика сборки одна на список и на одиночный отчёт —
	 * иначе экран «Задания» и карточка задания рано или поздно начали бы считать по-разному.
	 */
	async progress(id: string): Promise<BatchProgress | null> {
		const [only] = await this.reports([id]);
		return only ?? null;
	}

	/**
	 * Отчёты по НЕСКОЛЬКИМ заданиям — ПОСТОЯННЫМ числом запросов, а не по запросу на каждое.
	 *
	 * ЗАЧЕМ. Экран «Задания» опрашивается раз в три секунды, пока хоть что-то выполняется.
	 * Прежняя сборка звала отчёт в цикле, и каждый отчёт делал четыре запроса, первый из
	 * которых — UPDATE. Замерено на живой базе: двадцать заданий = 81 запрос и 73 мс, то
	 * есть около двадцати семи запросов и семи ЗАПИСЕЙ в секунду на ровном месте — за то,
	 * что человек смотрит на экран.
	 *
	 * Теперь запросов пять независимо от числа заданий: закрыть просроченные, взять шапки,
	 * взять команды, узнать про учётные записи баз и про способность агента их применять.
	 */
	async reports(ids: string[]): Promise<BatchProgress[]> {
		if (!ids.length) return [];

		// Просроченные команды закрываем ПЕРЕД чтением отчёта: иначе задание, чьи команды
		// никто не забрал, вечно показывает «выполняется». Причину пишем здесь же — после
		// перевода в expired уже не отличить «не забрал» (это про связь) от «забрал и не
		// ответил» (это про базу).
		await this.db.query(
			`UPDATE commands
			    SET state = 'expired', finished_at = now(),
			        error = COALESCE(error, jsonb_build_object(
			          'code', CASE WHEN state = 'queued' THEN 'COMMAND_QUEUE_TIMEOUT' ELSE 'COMMAND_EXPIRED' END,
			          'message', CASE WHEN state = 'queued'
			            -- Не дождалась очереди — не «агент не на связи» (С2): это закрывает expireOrphaned.
			            THEN 'Команда не дождалась своей очереди у агента: он был занят другими командами. Повторите позже или разделите задание на части.'
			            ELSE 'Агент забрал команду, но не ответил за отведённое ей время. Проверьте базу и журнал агента.'
			          END))
			  WHERE batch_id = ANY($1::uuid[]) AND state IN ('queued','dispatched') AND expires_at < now()`,
			[ids],
		);

		const heads = await this.db.query<{
			id: string; type: string; total: number; created_at: Date;
			payload: { skipped?: { baseKey?: string; reason?: string }[] } | null;
		}>(
			`SELECT id, type, total, created_at, payload FROM command_batches WHERE id = ANY($1::uuid[])`, [ids],
		);
		if (!heads.rows.length) return [];

		const cmds = await this.db.query<{
			batch_id: string; id: string; base_key: string | null; state: string;
			error: { code: string; message: string } | null; outcome: string | null;
			type: string; can_abort: boolean | null; can_abort_check: boolean | null; repair: string | null;
			caveat_result: Record<string, unknown> | null;
			attempt: number | null; retry_at: Date | null; late: boolean | null; late_wait: boolean | null;
			queued_secs: number | null; run_secs: number | null;
			check_result: { issues?: unknown; repaired?: unknown; repairMode?: unknown; skipped?: unknown } | null;
			still_running: boolean | null;
		}>(
			// Путь и адрес — единственное, что имеет смысл показать из результата: остальное
			// у изменяющих команд это `{ok:true}`. Полный result в отчёт не тащим.
			// Тип команды и способность агента — для признака «можно прервать» (S4).
			`SELECT c.batch_id, c.id, c.base_key, c.state, c.error,
			        EXTRACT(EPOCH FROM (COALESCE(c.dispatched_at, c.finished_at, now()) - c.created_at))::int AS queued_secs,
			        CASE WHEN c.dispatched_at IS NOT NULL
			             THEN EXTRACT(EPOCH FROM (COALESCE(c.finished_at, now()) - c.dispatched_at))::int END AS run_secs,
			        COALESCE(c.result->>'path', c.result->>'url') AS outcome,
			        -- Оговорки записи пользователя (П12): только эти два поля, а не весь ответ.
			        -- Оговорки успеха по типу команды (С41) и время по этапам (П28): только эти поля, не весь ответ.
			        CASE WHEN c.state = 'done'
			             THEN jsonb_build_object('unverified', c.result->'unverified', 'skipped', c.result->'skipped',
			                                     'warning', c.result->'warning', 'requestedName', c.result->'requestedName',
			                                     'name', c.result->'name', 'stages', c.result->'stages')
			        END AS caveat_result,
			        c.type, COALESCE(a.capabilities ? 'agent.cancel', false) AS can_abort,
			        COALESCE(a.capabilities ? 'agent.cancel.check', false) AS can_abort_check,
			        c.payload->>'repair' AS repair, c.attempt, c.late,
			        CASE WHEN c.state = 'queued' AND c.available_at > now() THEN c.available_at END AS retry_at,
			        ${LATE_WAIT("c", "$2")} AS late_wait,
			        ${TIMEOUT_STILL_RUNNING("c")} AS still_running,
			        -- Итог проверки базы (С17): только числа и пропущенное, не весь отчёт.
			        CASE WHEN c.type = 'IB_CHECK' AND c.state = 'done'
			             THEN jsonb_build_object('issues', c.result->'issues', 'repaired', c.result->'repaired',
			                                     'repairMode', c.result->'repairMode', 'skipped', c.result->'skipped')
			        END AS check_result
			   FROM commands c LEFT JOIN agents a ON a.id = c.agent_id
			  -- Повторённая при занятой базе (С10) — не строка отчёта: её место заняла новая попытка.
			  WHERE c.batch_id = ANY($1::uuid[]) AND c.retried_by IS NULL ORDER BY c.batch_id, c.created_at`,
			[ids, DEFAULT_LATE_GRACE_SECS],
		);

		// Контекст входа в базу: у каких баз задана своя учётная запись и умеет ли её
		// применять хоть один админ-агент. Без этого отказ «проверьте служебного
		// администратора» выглядит одинаково и когда учётная запись неверна, и когда её
		// просто не применили — а это разные дела: во втором случае чинят агента.
		const keys = [...new Set(cmds.rows.map((r) => r.base_key).filter((k): k is string => !!k))];
		const authUsers = keys.length
			? (await this.db.query<{ key: string; user_name: string }>(
				`SELECT b.key, c.user_name FROM base_credentials c JOIN bases b ON b.id = c.base_id
				  WHERE b.key = ANY($1::text[])`, [keys],
			)).rows
			: [];
		const authByKey = new Map(authUsers.filter((x) => x.user_name).map((x) => [x.key, x.user_name]));
		const supports = authByKey.size > 0 && (await this.db.query<{ ok: boolean }>(
			`SELECT EXISTS (
			   SELECT 1 FROM agents WHERE role = 'admin' AND capabilities ? 'ib.auth'
			 ) AS ok`,
		)).rows[0]?.ok === true;

		const byBatch = new Map<string, typeof cmds.rows>();
		for (const r of cmds.rows) {
			const list = byBatch.get(r.batch_id);
			if (list) list.push(r); else byBatch.set(r.batch_id, [r]);
		}

		const order = new Map(ids.map((id, i) => [id, i]));
		return heads.rows
			.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
			.map((head) => {
				const items: BatchProgress["items"] = (byBatch.get(head.id) ?? []).map((r) => {
				const check = checkOutcome(r.check_result);
				return {
					commandId: r.id as string | null,
					baseKey: r.base_key,
					state: r.state,
					// Ошибку 1С/COM дополняем подсказкой «что чинить»: сырой HRESULT в отчёте
					// задания не говорит пользователю ничего, а искать его в логах на
					// Windows-машине дорого.
					error: humanizeAgentError(r.error, r.base_key
						? { baseAuthUser: authByKey.get(r.base_key) ?? null, agentSupportsBaseAuth: supports }
						: {}),
					outcome: check?.outcome ?? r.outcome,
					abortable: isAbortable(r.state, r.type,
						{ canCancel: r.can_abort === true, canCancelCheck: r.can_abort_check === true },
						{ repair: r.repair === "true" }),
					warning: commandCaveat(r.type, r.caveat_result) ?? check?.warning ?? null,
					stages: Array.isArray(r.caveat_result?.stages) ? r.caveat_result.stages as { name: string; ms: number }[] : null,
					attempt: r.attempt ?? 1,
					retryAt: r.retry_at ? new Date(r.retry_at).toISOString() : null,
					queuedSecs: r.queued_secs ?? null,
					runSecs: r.run_secs ?? null,
					...(r.late ? { late: true } : {}),
					...(r.late_wait ? { lateWait: true } : {}),
					...(r.still_running ? { stillRunning: true } : {}),
				};
				});

				/*
				 * ОТСЕЯННЫЕ БАЗЫ — ОТДЕЛЬНЫЕ СТРОКИ, а не молчаливая разница в счётчике.
				 * Команду для них не ставили вовсе: некому (агента нет на связи), нечем (нет
				 * способности) или незачем (база не годится). Каждая такая строка называет
				 * базу и причину — задание перестаёт выглядеть «работающим» без работы.
				 */
				for (const sk of head.payload?.skipped ?? []) {
					items.push({
						commandId: null,
						baseKey: sk.baseKey ?? null,
						state: "skipped",
						outcome: null,
						error: { code: "NOT_QUEUED", message: sk.reason || "Команда не поставлена" },
					});
				}

				// Команд может НЕ ХВАТАТЬ: они живут час и вычищаются, а задание остаётся. Без
				// этого такое задание вечно показывало «выполняется 1 из 1» — хотя ждать уже
				// некого.
				const ageMs = Date.now() - head.created_at.getTime();
				const missing = head.total - items.length;
				if (missing > 0 && ageMs > LOST_AFTER_MS) {
					/*
					 * ДВЕ РАЗНЫЕ ПРИЧИНЫ, и путать их нельзя. Если у задания есть хоть одна
					 * команда, недостающие когда-то были и вычищены по сроку. Если команд нет
					 * НИ ОДНОЙ — их, скорее всего, и не ставили: так выглядят задания, начатые
					 * при остановленном агенте до того, как отсеянные базы стали записываться
					 * (живой случай 12.09; пять таких записей осталось в базе).
					 */
					const neverQueued = (byBatch.get(head.id) ?? []).length === 0;
					for (let i = 0; i < missing; i++) {
						items.push({
							commandId: null,
							baseKey: null,
							state: neverQueued ? "skipped" : "expired",
							outcome: null,
							error: neverQueued
								? { code: "NOT_QUEUED", message: "Команда не была поставлена в очередь: сведений о ней нет." }
								: { code: "COMMAND_LOST", message: "Команда не найдена: срок её жизни истёк. Повторите операцию." },
						});
					}
				}

				const done = items.filter((i) => i.state === "done").length;
				// expired и canceled считаем неуспехом: команда не выполнена, и если она нужна —
				// повторять её придётся так же. Отмену при этом видно отдельной подписью строки.
				const failed = items.filter((i) =>
					i.state === "failed" || i.state === "expired"
					|| i.state === "canceled" || i.state === "skipped").length;
				return {
					id: head.id, type: head.type, total: head.total,
					done, failed, pending: Math.max(0, head.total - done - failed),
					// Отменить можно только не начатое: см. queue.cancel.
					cancelable: items.filter((i) => i.state === "queued").length,
					// Прервать можно начатое чтение у агента с agent.cancel: см. isAbortable.
					abortable: items.filter((i) => i.abortable === true).length,
					createdAt: head.created_at.toISOString(), items,
				};
			});
	}

	/**
	 * Команды задания, которые не удались. `expired` считаем неуспехом наравне с `failed`:
	 * команда не выполнена, и повторять её нужно так же.
	 *
	 * `baseKeys` СУЖАЕТ повтор до названных баз. Это не оптимизация, а честность: в панели
	 * отмечают КОНКРЕТНЫЕ базы задания, и повтор обязан касаться их, а не всех неуспешных
	 * заодно. Раньше отметка на повтор не влияла вовсе — человек отмечал одну базу из
	 * десяти, а команда уходила во все десять. Без списка поведение прежнее: повторить всё.
	 */
	async failedCommands(
		batchId: string, baseKeys?: string[],
	): Promise<{ base_key: string | null; type: string; payload: Record<string, unknown> }[]> {
		const narrow = baseKeys?.length ? baseKeys : null;
		const r = await this.db.query<{ base_key: string | null; type: string; payload: Record<string, unknown> }>(
			`SELECT base_key, type, payload FROM commands
			  WHERE batch_id = $1 AND state IN ('failed', 'expired') AND retried_by IS NULL
			    AND ($2::text[] IS NULL OR base_key = ANY($2::text[]))
			    -- Истёкшая, но, возможно, ещё работающая у агента — не повторять поверх неё (С21).
			    AND NOT ${LATE_WAIT("commands", "$3")}
			    -- TIMEOUT, а процесс команды ещё работает (С18): повтор лёг бы поверх него.
			    AND NOT ${TIMEOUT_STILL_RUNNING("commands")}
			  ORDER BY created_at`,
			[batchId, narrow, DEFAULT_LATE_GRACE_SECS],
		);
		return r.rows;
	}

	/** Последние задания организации — для вкладки «Задания». Шесть запросов на любой размер. */
	async list(organizationUuid: string, limit = 20): Promise<BatchProgress[]> {
		const r = await this.db.query<{ id: string }>(
			`SELECT id FROM command_batches WHERE organization_uuid = $1 ORDER BY created_at DESC LIMIT $2`,
			[organizationUuid, limit],
		);
		return this.reports(r.rows.map((row) => row.id));
	}
}
