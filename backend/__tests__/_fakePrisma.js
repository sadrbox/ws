// Фейковый prisma в памяти для headless-тестов учёта (аудит 27.09, КР-7…КР-16) — без БД.
//
// Чем отличается от простых моков:
//   • select проверяется по схеме (Prisma.dmmf): неизвестное поле — ошибка, как у настоящей
//     Prisma (так и падала предпроверка перемещения, КР-7);
//   • транзакция откатывается журналом отмены, а не снимком таблиц: параллельные транзакции
//     не затирают чужие записи при откате;
//   • pg_advisory_xact_lock — настоящий взаимоисключающий лок на время транзакции (повторный
//     вход своей транзакции разрешён), SET LOCAL запоминается в tx.settings.
// Файл — помощник, а не тест (нет суффикса .test.js).
import { Prisma } from "@prisma/client";

const MODELS = Prisma.dmmf?.datamodel?.models ?? [];
const modelOf = (delegate) => MODELS.find((m) => m.name.toLowerCase() === String(delegate).toLowerCase()) ?? null;
/** Имена делегатов всех моделей схемы (sale, inventoryTransfer, …). */
export const DELEGATES = MODELS.map((m) => m.name[0].toLowerCase() + m.name.slice(1));

const isPlainObject = (v) => v !== null && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v);
const clone = (v) => (v instanceof Date ? new Date(v) : Array.isArray(v) ? v.map(clone) : isPlainObject(v) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clone(x)])) : v);
const val = (x) => (x instanceof Date ? x.getTime() : typeof x === "object" && x !== null && typeof x.toNumber === "function" ? x.toNumber() : x);
const cmp = (a, b) => { const x = val(a); const y = val(b); return x < y ? -1 : x > y ? 1 : 0; };

export function matches(row, where) {
	for (const [k, v] of Object.entries(where ?? {})) {
		if (k === "NOT") { const list = Array.isArray(v) ? v : [v]; if (list.some((w) => matches(row, w))) return false; continue; }
		if (k === "OR") { if (!v.some((w) => matches(row, w))) return false; continue; }
		if (k === "AND") { const list = Array.isArray(v) ? v : [v]; if (!list.every((w) => matches(row, w))) return false; continue; }
		const x = row[k];
		if (v === null) { if (x != null) return false; continue; }
		if (!isPlainObject(v)) { if (x === undefined || cmp(x, v) !== 0) return false; continue; }
		if ("in" in v && !v.in.some((y) => cmp(x, y) === 0)) return false;
		if ("notIn" in v && v.notIn.some((y) => cmp(x, y) === 0)) return false;
		if ("not" in v) {
			if (v.not === null ? x == null : isPlainObject(v.not) ? matches({ [k]: x }, { [k]: v.not }) : cmp(x, v.not) === 0) return false;
		}
		if ("equals" in v && cmp(x, v.equals) !== 0) return false;
		if ("lt" in v && !(x != null && cmp(x, v.lt) < 0)) return false;
		if ("lte" in v && !(x != null && cmp(x, v.lte) <= 0)) return false;
		if ("gt" in v && !(x != null && cmp(x, v.gt) > 0)) return false;
		if ("gte" in v && !(x != null && cmp(x, v.gte) >= 0)) return false;
		if ("contains" in v && !String(x ?? "").toLowerCase().includes(String(v.contains).toLowerCase())) return false;
	}
	return true;
}

function project(delegate, row, select) {
	if (!row || !select) return row;
	const m = modelOf(delegate);
	if (m) {
		const names = new Set(m.fields.map((f) => f.name));
		const unknown = Object.keys(select).filter((f) => select[f] && !names.has(f) && f !== "_count");
		if (unknown.length) {
			throw Object.assign(new Error(`Unknown field \`${unknown[0]}\` for select statement on model \`${m.name}\``), { name: "PrismaClientValidationError" });
		}
	}
	return Object.fromEntries(Object.keys(select).filter((f) => select[f]).map((f) => [f, row[f]]));
}

function sortRows(rows, orderBy) {
	const list = (Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : []).flatMap((o) => Object.entries(o));
	if (!list.length) return rows;
	return [...rows].sort((a, b) => {
		for (const [f, dir] of list) {
			if (isPlainObject(dir)) continue;
			const c = cmp(a[f], b[f]);
			if (c !== 0) return dir === "desc" ? -c : c;
		}
		return 0;
	});
}

/** Ошибка Postgres так, как её отдаёт Prisma 7 + adapter-pg. */
export const pgError = (code, message) => Object.assign(new Error(`Raw query failed. Code: \`${code}\`. Message: \`${message}\``), {
	name: "PrismaClientKnownRequestError",
	code: "P2010",
	meta: { driverAdapterError: { name: "DriverAdapterError", cause: { originalCode: code, originalMessage: message, kind: "postgres", code } } },
});

/**
 * @param {object} seed — { delegate: rows[] }
 * @param {object} [opts]
 * @param {object} [opts.overrides] — { "saleItem.findMany": (args, db) => rows } — свои реализации
 * @param {(sql: string, args: any[]) => any} [opts.onRaw] — $queryRawUnsafe/$executeRawUnsafe (кроме локов и SET)
 * @param {(key: string, txc: object) => Error|null|Promise<Error|null>} [opts.onLock] — перед локом: вернуть
 *        ошибку — лок «не дождался»; промис — задержка (чтобы транзакции переплелись)
 * @param {boolean} [opts.latency] — каждый запрос уступает ход (setImmediate), как настоящий
 *        ввод-вывод: параллельные запросы переплетаются, и гонки воспроизводятся
 */
export function fakeDb(seed = {}, { overrides = {}, onRaw = null, onLock = null, latency = false } = {}) {
	const tables = clone(seed);
	let nextId = 10_000;
	let nextTx = 1;
	const table = (m) => (tables[m] ??= []);
	const locks = new Map(); // key → { tx, count, waiters: [] }
	const log = { sql: [], locks: [], transactions: 0 };

	async function acquire(txc, key) {
		for (;;) {
			const l = locks.get(key);
			if (!l) { locks.set(key, { tx: txc.id, waiters: [] }); txc.locks.add(key); return; }
			if (l.tx === txc.id) return;
			await new Promise((r) => l.waiters.push(r));
		}
	}
	function releaseAll(txc) {
		for (const key of txc.locks) {
			const l = locks.get(key);
			locks.delete(key);
			for (const w of l?.waiters ?? []) w();
		}
		txc.locks.clear();
	}

	const createRow = (m, data) => {
		const id = data.id ?? ++nextId;
		const row = { id, uuid: data.uuid ?? `${m}-${id}` };
		if (modelOf(m)?.fields.some((f) => f.name === "deletedAt")) row.deletedAt = null;
		for (const [k, v] of Object.entries(data)) {
			if (v === undefined) continue;
			if (isPlainObject(v) && ("create" in v || "connect" in v)) continue; // вложенные записи не моделируем
			row[k] = clone(v);
		}
		return row;
	};

	function delegate(m, txc) {
		const undo = (fn) => { if (txc) txc.undo.push(fn); };
		const api = {
			findUnique: async ({ where, select } = {}) => clone(project(m, table(m).find((r) => matches(r, where)) ?? null, select)),
			findFirst: async ({ where, select, orderBy } = {}) => clone(project(m, sortRows(table(m).filter((r) => matches(r, where)), orderBy)[0] ?? null, select)),
			findMany: async ({ where, select, orderBy, take, cursor, skip } = {}) => {
				let rows = sortRows(table(m).filter((r) => matches(r, where)), orderBy);
				if (cursor) { const i = rows.findIndex((r) => matches(r, cursor)); rows = i >= 0 ? rows.slice(i) : []; }
				if (skip) rows = rows.slice(skip);
				if (take !== undefined) rows = rows.slice(0, take);
				return clone(rows.map((r) => project(m, r, select)));
			},
			count: async ({ where } = {}) => table(m).filter((r) => matches(r, where)).length,
			create: async ({ data, select }) => {
				const row = createRow(m, data);
				table(m).push(row);
				undo(() => { tables[m] = table(m).filter((r) => r !== row); });
				return clone(project(m, row, select));
			},
			createMany: async ({ data }) => {
				for (const d of data) {
					const row = createRow(m, d);
					table(m).push(row);
					undo(() => { tables[m] = table(m).filter((r) => r !== row); });
				}
				return { count: data.length };
			},
			update: async ({ where, data, select }) => {
				const row = table(m).find((r) => matches(r, where));
				if (!row) throw Object.assign(new Error("Record to update not found"), { code: "P2025" });
				const before = clone(row);
				undo(() => { for (const k of Object.keys(row)) delete row[k]; Object.assign(row, before); });
				for (const [k, v] of Object.entries(data)) if (v !== undefined) row[k] = clone(v);
				return clone(project(m, row, select));
			},
			updateMany: async ({ where, data }) => {
				const rows = table(m).filter((r) => matches(r, where));
				for (const row of rows) {
					const before = clone(row);
					undo(() => { for (const k of Object.keys(row)) delete row[k]; Object.assign(row, before); });
					for (const [k, v] of Object.entries(data)) if (v !== undefined) row[k] = clone(v);
				}
				return { count: rows.length };
			},
			upsert: async ({ where, create, update }) => {
				const row = table(m).find((r) => matches(r, where));
				return row ? api.update({ where, data: update }) : api.create({ data: create });
			},
			delete: async ({ where }) => {
				const row = table(m).find((r) => matches(r, where));
				if (!row) throw Object.assign(new Error("Record to delete does not exist"), { code: "P2025" });
				tables[m] = table(m).filter((r) => r !== row);
				undo(() => { table(m).push(row); });
				return clone(row);
			},
			deleteMany: async ({ where } = {}) => {
				const gone = table(m).filter((r) => matches(r, where));
				tables[m] = table(m).filter((r) => !gone.includes(r));
				undo(() => { table(m).push(...gone); });
				return { count: gone.length };
			},
			aggregate: async ({ where, _sum = {}, _max = {}, _min = {} } = {}) => {
				const rows = table(m).filter((r) => matches(r, where));
				const nums = (f) => rows.map((r) => r[f]).filter((x) => x != null);
				return {
					_sum: Object.fromEntries(Object.keys(_sum).map((f) => [f, rows.length ? rows.reduce((s, r) => s + (Number(r[f]) || 0), 0) : null])),
					_max: Object.fromEntries(Object.keys(_max).map((f) => [f, nums(f).sort(cmp).pop() ?? null])),
					_min: Object.fromEntries(Object.keys(_min).map((f) => [f, nums(f).sort(cmp)[0] ?? null])),
				};
			},
			groupBy: async ({ by, where, _sum = {}, _max = {} }) => {
				const g = new Map();
				for (const r of table(m).filter((x) => matches(x, where))) {
					const k = by.map((f) => String(r[f])).join("|");
					const cur = g.get(k) ?? { ...Object.fromEntries(by.map((f) => [f, r[f] ?? null])), _sum: Object.fromEntries(Object.keys(_sum).map((f) => [f, 0])), _max: Object.fromEntries(Object.keys(_max).map((f) => [f, null])) };
					for (const f of Object.keys(_sum)) cur._sum[f] += Number(r[f]) || 0;
					for (const f of Object.keys(_max)) if (r[f] != null && (cur._max[f] == null || cmp(r[f], cur._max[f]) > 0)) cur._max[f] = r[f];
					g.set(k, cur);
				}
				return [...g.values()];
			},
		};
		for (const [path, fn] of Object.entries(overrides)) {
			const [mm, method] = path.split(".");
			if (mm === m) api[method] = (args) => fn(args, db, txc);
		}
		if (latency) {
			for (const [k, fn] of Object.entries(api)) api[k] = async (args) => { await yieldTurn(); return fn(args); };
		}
		return api;
	}
	const yieldTurn = () => new Promise((r) => setImmediate(r));

	async function raw(txc, sql, args) {
		if (latency) await yieldTurn();
		log.sql.push(sql);
		if (/pg_advisory_xact_lock/i.test(sql)) {
			if (!txc) throw new Error("advisory xact lock вне транзакции");
			const key = args.map(String).join(":");
			const err = await onLock?.(key, txc);
			if (err) throw err;
			log.locks.push(key);
			await acquire(txc, key);
			return 1;
		}
		const set = /^\s*SET\s+LOCAL\s+(\w+)\s*=\s*(.+?)\s*$/i.exec(sql);
		if (set) { if (txc) txc.settings[set[1]] = set[2]; return 0; }
		return onRaw ? onRaw(sql, args, txc) : 0;
	}

	function client(txc) {
		return new Proxy({}, {
			get: (_t, p) => {
				if (p === "then") return undefined;
				if (p === "$executeRawUnsafe" || p === "$queryRawUnsafe") return (sql, ...args) => raw(txc, sql, args);
				if (p === "$transaction" && !txc) {
					return async (fn) => {
						const t = { id: nextTx++, undo: [], locks: new Set(), settings: {} };
						log.transactions++;
						try {
							const r = await fn(client(t));
							releaseAll(t);
							return r;
						} catch (e) {
							for (const u of t.undo.reverse()) u();
							releaseAll(t);
							throw e;
						}
					};
				}
				if (p === "_tables") return tables;
				if (p === "_log") return log;
				if (p === "_settings") return txc?.settings;
				if (typeof p !== "string" || p.startsWith("$")) return undefined;
				return delegate(p, txc);
			},
		});
	}
	const db = client(null);
	return db;
}

/**
 * Подставить фейк вместо настоящего prisma (роутеры импортируют его напрямую): методы
 * делегатов ВСЕХ моделей схемы + $transaction/$executeRawUnsafe/$queryRawUnsafe. Любое
 * обращение мимо фейка ушло бы в базу — поэтому подменяется всё. pool — прямой pg-пул из
 * prisma-client.js (им проверяются ссылки при удалении): отвечает пусто. Возвращает откат.
 */
export function installFake(prisma, db, { pool = null } = {}) {
	const saved = [];
	const set = (target, key, value) => { saved.push([target, key, target[key]]); target[key] = value; };
	if (pool) set(pool, "query", async () => ({ rows: [] }));
	const METHODS = ["findUnique", "findFirst", "findMany", "count", "create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany", "aggregate", "groupBy"];
	for (const d of DELEGATES) {
		const target = prisma[d];
		if (!target) continue;
		const fake = db[d];
		for (const mth of METHODS) set(target, mth, (args) => fake[mth](args));
	}
	for (const k of ["$transaction", "$executeRawUnsafe", "$queryRawUnsafe"]) set(prisma, k, db[k]);
	return () => { for (const [t, k, v] of saved.reverse()) t[k] = v; };
}

/** Поднять роутер в express на случайном порту; call(method, path, body). */
export async function withApp(express, router, user, fn) {
	const app = express();
	app.use(express.json());
	app.use((req, _res, next) => { req.user = user ? { ...user } : undefined; next(); });
	app.use("/", router);
	const server = app.listen(0);
	await new Promise((r) => server.once("listening", r));
	try {
		const base = `http://127.0.0.1:${server.address().port}`;
		const call = async (method, path, body) => {
			const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
			return { status: r.status, body: await r.json().catch(() => ({})) };
		};
		return await fn(call);
	} finally {
		server.close();
	}
}
