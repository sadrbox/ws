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
//   • ОБРЫВ СОЕДИНЕНИЯ КЛИЕНТОМ КЛЮЧ НЕ ОСВОБОЖДАЕТ (КР-5 аудита 27.09): сервис ИИ рвёт запрос по
//     своему таймауту, а обработчик дорабатывает и создаёт задачу — раньше `close` освобождал ключ,
//     итог не запоминался, и повтор хода из 1С создавал вторую задачу. Теперь итог запоминается в
//     res.json независимо от сокета, и повтор получает его;
//   • ответ уходит клиенту ПОСЛЕ записи итога (запись ждём, сбой записи повторяем один раз): иначе
//     клиент, получив ответ, успевал повторить раньше записи, а несохранённый итог давал 409 на
//     STALE_MS и затем второе выполнение;
//   • ответ 5xx не запоминается, ключ освобождается — повтор пройдёт заново (сбой ERP не
//     должен «прилипать» к ключу); НО если маршрут уже зафиксировал побочный эффект (создал
//     задачу, принял итоги), он ставит `res.locals.idempotencyCommitted = true`, и тогда 5xx
//     запоминается как итог — лучше повторённая ошибка, чем вторая задача; 2xx и 4xx — итог
//     запроса, он и возвращается;
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

	/** Запомнить итог. Сбой связи повторяем один раз: незаписанный итог — это 409 на STALE_MS и второе выполнение. */
	async function remember(key, status, body) {
		for (let attempt = 1; ; attempt++) {
			try {
				await db.idempotencyKey.update({ where: { key }, data: { status, response: body ?? Prisma.JsonNull, completedAt: now() } });
				return true;
			} catch (e) {
				// P2025 — строки нет (захват перезахвачен как брошенный): повторять бессмысленно.
				if (attempt < 2 && e?.code !== "P2025") continue;
				log.warn?.(`[idempotency] ответ по ключу не сохранён: ${e?.message || e}`);
				return false;
			}
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

			// Захвачено: ответ обработчика запоминаем (2xx/4xx, а 5xx — после побочного эффекта) или
			// освобождаем ключ (5xx до побочного эффекта). Обрыв соединения клиентом (`close` без ответа)
			// ключ НЕ освобождает (КР-5 аудита 27.09): обработчик дорабатывает, его итог запомнится здесь
			// же, а упавший посреди обработки воркер покрыт STALE_MS.
			let settled = false;
			const json = res.json.bind(res);
			const settle = (status, body) =>
				status >= 500 && res.locals?.idempotencyCommitted !== true ? release(key) : remember(key, status, body);
			res.json = (body) => {
				if (settled) return json(body);
				settled = true;
				// Ответ — ПОСЛЕ записи итога: получив его, клиент может сразу повторить, и повтор должен
				// застать итог, а не захват. remember/release не бросают.
				void settle(res.statusCode, body).then(() => {
					if (res.headersSent) return; // ответ уже отдан мимо нас (обработчик ошибок) — второй не шлём
					try {
						json(body);
					} catch (e) {
						log.warn?.(`[idempotency] ответ не отправлен (${route}): ${e?.message || e}`);
						if (!res.headersSent) res.status(500).end();
					}
				});
				return res;
			};
			// Ответ ушёл мимо res.json (res.send/res.end): запоминаем статус без тела. `finish` — только у
			// ответа, отданного целиком; обрыв клиентом его не даёт.
			res.on("finish", () => {
				if (!settled) {
					settled = true;
					void settle(res.statusCode, undefined);
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
