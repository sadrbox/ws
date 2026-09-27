// ─────────────────────────────────────────────────────────────────────────────
// Идемпотентность входящих запросов служебных каналов (сервис ИИ, 1С) — добор аудита 26.09, п. 4.
//
// ЗАЧЕМ. Сервис ИИ повторяет посылку итогов проверок после обрыва соединения, а ход из 1С —
// после таймаута; ERP при этом могла первую уже принять, и вторая создавала вторую задачу или
// второй приём находок. Теперь запрос с заголовком Idempotency-Key (или полем idempotencyKey
// в теле) выполняется один раз: ключ захватывается ДО обработки — INSERT под уникальным
// индексом idempotency_keys.key, это и замок между воркерами, — ответ запоминается, и повтор
// получает его как есть (с заголовком Idempotent-Replayed: true).
//
// ПРАВИЛА.
//   • повтор, пока первый запрос ещё обрабатывается, — 409: клиент подождёт и повторит;
//   • ответ 5xx не запоминается, ключ освобождается — повтор пройдёт заново (сбой ERP не
//     должен «прилипать» к ключу); 2xx и 4xx — итог запроса, он и возвращается;
//   • один ключ — один маршрут: тот же ключ на другом маршруте — 422;
//   • незавершённый захват старше STALE_MS (упавший посреди обработки воркер) считается
//     брошенным и перезахватывается; ключи живут IDEMPOTENCY_TTL_DAYS и чистятся планировщиком
//     (сервис ИИ помнит свои ключи сутки — окно ERP шире клиентского);
//   • база недоступна при захвате — запрос идёт как обычный: идемпотентность не должна быть
//     ещё одной точкой отказа канала.
// ─────────────────────────────────────────────────────────────────────────────
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma/prisma-client.js";

export const HEADER = "Idempotency-Key";
export const KEY_MAX = 200;
/** Незавершённый захват старше этого — брошен (самый долгий законный приём — минуты). */
export const STALE_MS = 30 * 60_000;
export const TTL_MS = (() => {
	const n = Number(process.env.IDEMPOTENCY_TTL_DAYS);
	return (Number.isFinite(n) && n > 0 ? n : 7) * 86_400_000;
})();

/** Ключ запроса: заголовок, иначе поле тела; пусто или длиннее KEY_MAX — запрос без ключа. */
export function idempotencyKeyOf(req) {
	const raw = req.get?.(HEADER) ?? req.body?.idempotencyKey;
	const key = typeof raw === "string" ? raw.trim() : "";
	return key && key.length <= KEY_MAX ? key : null;
}

/**
 * Фабрика — ради тестов (подставная база, свой журнал).
 * @param {{ db?: object, log?: { warn?: Function }, now?: () => Date }} [deps]
 */
export function createIdempotency({ db = prisma, log = console, now = () => new Date() } = {}) {
	/** Захват ключа: claimed | replay (с сохранённой строкой) | busy | conflict. */
	async function claim(key, route) {
		for (let attempt = 0; attempt < 2; attempt++) {
			try {
				await db.idempotencyKey.create({ data: { key, route } });
				return { state: "claimed" };
			} catch (e) {
				if (e?.code !== "P2002") throw e;
			}
			const row = await db.idempotencyKey.findUnique({ where: { key } });
			if (!row) continue; // освобождён между попытками — захватываем заново
			if (row.route !== route) return { state: "conflict" };
			if (row.status == null) {
				if (now().getTime() - new Date(row.createdAt).getTime() < STALE_MS) return { state: "busy" };
				await release(key); // брошенный захват упавшего воркера
				continue;
			}
			return { state: "replay", row };
		}
		return { state: "busy" };
	}

	async function remember(key, status, body) {
		try {
			await db.idempotencyKey.update({ where: { key }, data: { status, response: body ?? Prisma.JsonNull, completedAt: now() } });
		} catch (e) {
			log.warn?.(`[idempotency] ответ по ключу не сохранён: ${e?.message || e}`);
		}
	}

	async function release(key) {
		try {
			await db.idempotencyKey.delete({ where: { key } });
		} catch {
			/* уже нет — и не нужно */
		}
	}

	/** Middleware маршрута: `route` — его имя, одинаковое во всех воркерах («POST /bpai/tasks»). */
	function idempotent(route) {
		return async (req, res, next) => {
			const key = idempotencyKeyOf(req);
			if (!key) return next();
			let claimed;
			try {
				claimed = await claim(key, route);
			} catch (e) {
				log.warn?.(`[idempotency] ключ не захвачен (${route}): ${e?.message || e}`);
				return next();
			}
			if (claimed.state === "replay") {
				res.set("Idempotent-Replayed", "true");
				return res.status(claimed.row.status).json(claimed.row.response);
			}
			if (claimed.state === "busy") return res.status(409).json({ success: false, message: "Запрос с этим ключом ещё обрабатывается — повторите позже" });
			if (claimed.state === "conflict") return res.status(422).json({ success: false, message: "Ключ идемпотентности уже использован другим запросом" });

			// Захвачено: ответ обработчика запоминаем (2xx/4xx) или освобождаем ключ (5xx, обрыв без ответа).
			let settled = false;
			const json = res.json.bind(res);
			res.json = (body) => {
				if (!settled) {
					settled = true;
					if (res.statusCode < 500) void remember(key, res.statusCode, body);
					else void release(key);
				}
				return json(body);
			};
			res.on("close", () => {
				if (!settled) {
					settled = true;
					void release(key);
				}
			});
			return next();
		};
	}

	/** Чистка: ключи старше TTL и брошенные захваты старше STALE_MS. Возвращает число удалённых. */
	async function prune(ttlMs = TTL_MS) {
		const t = now().getTime();
		const r = await db.idempotencyKey.deleteMany({
			where: { OR: [{ createdAt: { lt: new Date(t - ttlMs) } }, { status: null, createdAt: { lt: new Date(t - STALE_MS) } }] },
		});
		return r.count;
	}

	return { idempotent, prune, claim, idempotencyKeyOf };
}

const shared = createIdempotency();

export const idempotent = shared.idempotent;
export const pruneIdempotencyKeys = shared.prune;

export default { idempotent, pruneIdempotencyKeys, idempotencyKeyOf, createIdempotency, HEADER, KEY_MAX, STALE_MS, TTL_MS };
