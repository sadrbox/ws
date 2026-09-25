/**
 * ПРОВЕРКИ УЧЁТА В БАЗАХ КЛИЕНТОВ — ЧИСТАЯ ЧАСТЬ (E17, СК2.2).
 *
 * Сторона 1С (docs/TASK_EXTENSION_ACCOUNTING_CHECKS_2026-09-25.md) даёт три READ-команды: каталог проверок базы
 * (`LIST_ACCOUNTING_CHECKS`), прогон одной проверки (`RUN_ACCOUNTING_CHECK`) и снимок данных
 * (`GET_ACCOUNTING_SNAPSHOT`). Здесь — решения, которые не зависят ни от базы данных, ни от очереди: пора ли
 * ночному прогону, какой период дать проверке, какие вызовы сделать по организации. Всё это проверяется тестом
 * без стенда — а живой стороны 1С на 25.09 ещё нет вовсе, и другого способа убедиться в правилах нет.
 *
 * Прогонщик с очередью и отправкой в ERP — accountingChecksRunner.ts.
 */

export const LIST_CHECKS = "LIST_ACCOUNTING_CHECKS";
export const RUN_CHECK = "RUN_ACCOUNTING_CHECK";
export const GET_SNAPSHOT = "GET_ACCOUNTING_SNAPSHOT";

/** Типы команд проверок — в очереди, в журнале агента и в сроке хранения (retention.ts). */
export const CHECK_COMMAND_TYPES: readonly string[] = [LIST_CHECKS, RUN_CHECK, GET_SNAPSHOT];

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Ответ 1С без конверта. Агент кладёт в результат команды `data` ответа шлюза; если какая-то сборка положит
 * конверт `{success, data}` целиком — разворачиваем здесь, а не в каждом месте, где читаем ответ.
 */
export function unwrapData(result: unknown): unknown {
	return isRecord(result) && result.success === true && "data" in result ? result.data : result;
}

// ── Каталог ────────────────────────────────────────────────────────────────

export type CatalogCheck = {
	code: string;
	/** `base` — справочники, общие на всю базу: БИН не передаётся и не учитывается. */
	scope: "organization" | "base";
	/** `period` (нужны from/to), `onDate` или `none`; неизвестное — как `period` (см. periodFields). */
	periodKind: string;
	available: boolean;
};

export type CatalogSnapshot = { code: string; periodKind: string; available: boolean };

export type CheckCatalog = {
	apiVersion: string | null;
	checks: CatalogCheck[];
	snapshots: CatalogSnapshot[];
	/** Каталог в том виде, в каком его вернула 1С, — для ERP: версии проверок, параметры, причины недоступности. */
	wire: { apiVersion: string | null; checks: unknown[]; snapshots: unknown[] };
};

const codeOf = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/**
 * Разбор ответа `LIST_ACCOUNTING_CHECKS`. `null` — формы не узнали: тогда по базе ничего не ставим, а не
 * «проверок нет» — это разные ответы, и второй молча выключил бы проверки у клиента.
 *
 * Мягко к мелочам: строка без кода пропускается, повтор кода — тоже (одна проверка — один прогон), `available`
 * без значения считается `true` — контракт требует поле, а лишний прогон дешевле молча пропущенного.
 */
export function parseCatalog(result: unknown): CheckCatalog | null {
	const d = unwrapData(result);
	if (!isRecord(d) || !Array.isArray(d.checks)) return null;
	const rawSnapshots = Array.isArray(d.snapshots) ? d.snapshots : [];
	const apiVersion = typeof d.apiVersion === "string" ? d.apiVersion : null;

	const seen = new Set<string>();
	const checks: CatalogCheck[] = [];
	for (const c of d.checks) {
		if (!isRecord(c)) continue;
		const code = codeOf(c.code);
		if (!code || seen.has(code)) continue;
		seen.add(code);
		checks.push({
			code,
			// Всё, что не `base`, — проверка организации: БИН лишним не бывает, а его отсутствие в многофирменной
			// базе — отказ ORGANIZATION_REQUIRED.
			scope: c.scope === "base" ? "base" : "organization",
			periodKind: typeof c.periodKind === "string" ? c.periodKind : "period",
			available: c.available !== false,
		});
	}
	const seenSnap = new Set<string>();
	const snapshots: CatalogSnapshot[] = [];
	for (const s of rawSnapshots) {
		if (!isRecord(s)) continue;
		const code = codeOf(s.code);
		if (!code || seenSnap.has(code)) continue;
		seenSnap.add(code);
		snapshots.push({ code, periodKind: typeof s.periodKind === "string" ? s.periodKind : "period", available: s.available !== false });
	}
	return { apiVersion, checks, snapshots, wire: { apiVersion, checks: d.checks, snapshots: rawSnapshots } };
}

// ── Даты — по часам сервера ────────────────────────────────────────────────
//
// «Сегодня» и «прошлый месяц» — местные, как у расписания обслуживания: сервер стоит там же, где клиенты, и
// граница месяца по UTC сдвинула бы ночной прогон 1-го числа в чужой месяц.

const pad = (n: number): string => String(n).padStart(2, "0");

/** Дата YYYY-MM-DD по местному времени. */
export const localDate = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Первое число месяца со сдвигом (`-1` — прошлый месяц). */
const monthStart = (d: Date, shift = 0): Date => new Date(d.getFullYear(), d.getMonth() + shift, 1);
/** Последнее число месяца со сдвигом. */
const monthEnd = (d: Date, shift = 0): Date => new Date(d.getFullYear(), d.getMonth() + shift + 1, 0);

// ── Когда пора ─────────────────────────────────────────────────────────────

/**
 * Сколько минут после назначенного времени прогон ещё можно начать.
 *
 * ЗАЧЕМ ОКНО. Без него сервис, поднятый после ночного простоя в 10 утра, тут же пошёл бы по базам всех клиентов —
 * в рабочее время, занимая их сеансы и лицензии. С окном перезапуск в 02:40 прогон догоняет, а днём — нет:
 * пропущенную ночь можно добрать ручным запуском.
 *
 * ПРОВЕРИТЬ ПОТОМ: три часа — оценка, а не замер. Прогон всех баз может не уложиться до утра (при двух базах
 * одновременно и ~20 проверках по 20 с — около 7 минут на организацию); окно ограничивает только СТАРТ, самого
 * прогона оно не останавливает. Если прогон начнёт заходить в рабочий день — нужен ещё и предел окончания.
 */
export const CHECKS_WINDOW_MINUTES = 180;

/**
 * Дата окна, в которое попадает `now`, или `null` — вне окна. Окно, перешедшее через полночь (запуск в 23:30),
 * принадлежит дню, когда началось: так прогон в 00:10 не считается «завтрашним» и не повторяется.
 */
export function checksWindowDate(now: Date, at: string, windowMinutes = CHECKS_WINDOW_MINUTES): string | null {
	const [h, m] = at.split(":").map(Number);
	const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0, 0);
	const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, h, m, 0, 0);
	for (const start of [today, yesterday]) {
		const t = now.getTime() - start.getTime();
		if (t >= 0 && t < windowMinutes * 60_000) return localDate(start);
	}
	return null;
}

/**
 * Пора ли ночному прогону: `now` — в окне после `at`, а прогона за это окно ещё не было. `lastRunDate` — дата
 * окна последнего планового прогона (как её вернул checksWindowDate), `null` — не запускался.
 */
export function isChecksDue(lastRunDate: string | null, now: Date, at: string, windowMinutes = CHECKS_WINDOW_MINUTES): boolean {
	const day = checksWindowDate(now, at, windowMinutes);
	return day !== null && day !== lastRunDate;
}

// ── Периоды ────────────────────────────────────────────────────────────────

/**
 * Поля периода для проверки по её `periodKind`.
 *
 *   period — с первого числа ПРОШЛОГО месяца по сегодня: прошлый месяц ещё открыт до сдачи отчётности, и ошибка
 *            в нём — та, которую бухгалтер ещё может исправить; текущий месяц — то, что копится сейчас;
 *   onDate — остатки на сегодня;
 *   none   — справочники, периода нет.
 * Неизвестное значение — как `period`: `from`/`to` устраивают и проверку периода, и проверку на дату (onDate
 * по контракту берётся из `to`), а лишний отказ PERIOD_REQUIRED хуже.
 *
 * ПРОВЕРИТЬ ПОТОМ: выбор периода. «Прошлый месяц + текущий» и «на сегодня» — решение сервиса по умолчанию; когда
 * у ERP появятся сроки отработки и отчётные периоды клиентов, период может понадобиться свой на проверку или на
 * клиента (например, квартал для сверок).
 */
export function periodFields(periodKind: string, now: Date): Record<string, string> {
	if (periodKind === "none") return {};
	if (periodKind === "onDate") return { onDate: localDate(now) };
	return { from: localDate(monthStart(now, -1)), to: localDate(now) };
}

/**
 * Периоды снимка. Обычно — одним вызовом по правилу periodFields. Снимок `documents` (динамика ввода
 * первички, п. 19) — двумя: прошлый месяц и текущий, каждый ЦЕЛИКОМ. Сервис сравнивает ночные снимки между
 * собой, и период обязан быть одним и тем же каждую ночь — иначе в разнице смешались бы «ввели документы» и
 * «период вырос на день». Прошлый месяц снимается, пока идёт текущий: его первичку доносят до сдачи отчётности,
 * и именно эту динамику ERP и должна видеть.
 *
 * ПРОВЕРИТЬ ПОТОМ: два вызова `documents` за ночь (прошлый и текущий месяц целиком) — предложение сервиса; ERP
 * может решить, что прошлый месяц нужен только до даты сдачи отчётности.
 */
export function snapshotPeriods(code: string, periodKind: string, now: Date): Record<string, string>[] {
	if (code === "documents") {
		return [
			{ from: localDate(monthStart(now, -1)), to: localDate(monthEnd(now, -1)) },
			{ from: localDate(monthStart(now)), to: localDate(monthEnd(now)) },
		];
	}
	return [periodFields(periodKind, now)];
}

// ── План вызовов по организации ────────────────────────────────────────────

export type PlannedCall =
	| { kind: "check"; code: string; scope: "organization" | "base"; payload: Record<string, unknown> }
	| { kind: "snapshot"; code: string; payload: Record<string, unknown> };

/**
 * Что спросить у базы по одной организации: доступные проверки организации с её БИН, проверки базы (если эта
 * организация ими «владеет» — см. ниже), затем снимки. Недоступные (`available: false`) не ставятся: 1С уже
 * сказала, что к этой базе проверка неприменима, и причина лежит в каталоге, который уходит в ERP.
 *
 * `withBase` — проверки со `scope: "base"` идут один раз на базу, а результаты в ERP адресуются организации.
 * Какой — решает прогонщик (п. 11 реестра, решено 25.09): первой ОБСЛУЖИВАЕМОЙ фирмой организации базы в порядке
 * среза агента, а пока обслуживание не настроено — первой известной ERP. Справочник многофирменной базы общий, и
 * его находки должны лечь на того, кого фирма ведёт: у необслуживаемой организации нет ответственного бухгалтера,
 * и задача по дублям повисла бы без исполнителя.
 *
 * ПРОВЕРИТЬ ПОТОМ: пороги (`params`) не передаются — действуют умолчания расширения. Пороги на клиента (СК2.2)
 * появятся вместе с настройкой в ERP.
 */
export function planOrganization(
	catalog: Pick<CheckCatalog, "checks" | "snapshots">,
	bin: string,
	opts: { now: Date; limit: number; withBase: boolean; withSnapshots: boolean },
): PlannedCall[] {
	const calls: PlannedCall[] = [];
	for (const c of catalog.checks) {
		if (!c.available) continue;
		if (c.scope === "base" && !opts.withBase) continue;
		calls.push({
			kind: "check", code: c.code, scope: c.scope,
			payload: {
				check: c.code,
				// Проверке базы БИН не нужен: она его «не требует и не учитывает» (контракт, правило 4).
				...(c.scope === "organization" ? { organizationBin: bin } : {}),
				...periodFields(c.periodKind, opts.now),
				limit: opts.limit,
			},
		});
	}
	if (opts.withSnapshots) {
		for (const s of catalog.snapshots) {
			if (!s.available) continue;
			for (const period of snapshotPeriods(s.code, s.periodKind, opts.now)) {
				calls.push({ kind: "snapshot", code: s.code, payload: { snapshot: s.code, organizationBin: bin, ...period } });
			}
		}
	}
	return calls;
}

// ── Отказы ─────────────────────────────────────────────────────────────────

/**
 * ОТКАЗЫ «БАЗА ИЛИ АГЕНТ НЕ ОТВЕЧАЮТ» — после такого остальные проверки этой базы не ставятся.
 *
 * Внутри базы проверки идут по одной, и каждая может ждать очереди и выполнения до своего предела. Если агент
 * пропал или база повисла, двадцать оставшихся проверок прождали бы по двадцать минут каждая — и прогон одной
 * базы съел бы всю ночь и утро. Отказ по существу (1С ответила: нет прав, неверный параметр, проверка не уложилась
 * в свой предел) — не повод: база жива, следующая проверка может пройти.
 */
const UNRESPONSIVE = new Set([
	// Сервис не дождался ответа (см. прогонщик): команда осталась в очереди или у агента.
	"NO_ANSWER",
	"COMMAND_QUEUE_TIMEOUT", "COMMAND_EXPIRED", "AGENT_OFFLINE", "AGENT_RESTARTED", "AGENT_STOPPING",
	// Оператор отменил или прервал команду — его воля распространяется и на остальные проверки базы.
	"COMMAND_CANCELED", "COMMAND_ABORTED",
	// Очередь не приняла команду: сбой своей же базы данных, повторять тут же бессмысленно.
	"ENQUEUE_FAILED",
]);

export const isUnresponsive = (code: string): boolean => UNRESPONSIVE.has(code);

// ── «База не проверена» ────────────────────────────────────────────────────

/**
 * Код «проверки» в посылке, которая говорит ERP, что базу этой ночью проверить не удалось (п. 21 реестра, решено
 * 25.09). Подчёркивание — чтобы не спутать с настоящей проверкой из каталога 1С: у тех коды вида `stock.negative`.
 *
 * ЗАЧЕМ ПОСЫЛКА, А НЕ ТОЛЬКО ЖУРНАЛ СЕРВИСА. Без неё ERP узнаёт лишь о базах, где каталог получен, и молчание
 * базы выглядит на панели главбуха как «находок нет» — ровно наоборот: не проверено ничего. ERP хранит строку
 * `_catalog` как прогон с отказом и показывает «база не проверена».
 */
export const CATALOG_CHECK = "_catalog";

/**
 * Почему базу нельзя проверить, не спрашивая её: сборка агента перечисляет свои типы команд, и проверок среди них
 * нет. Команд такому агенту не ставим (отказ до очереди — тот же вывод без минуты ожидания), а ERP сообщаем.
 */
export const CAPABILITY_MISSING = {
	code: "CAPABILITY_MISSING",
	message: `Агент BuhProf этой базы не умеет проверки учёта (нет команд ${LIST_CHECKS} и ${RUN_CHECK}) — обновите агента`,
} as const;

/** Отказ команды, как его отдаёт прогонщик: код и текст 1С или агента, HTTP-статус ответа 1С, если он был. */
export type CommandFailure = { code: string; message: string; onecHttpStatus?: number | null };

/**
 * «БАЗА НЕ УМЕЕТ ПРОВЕРКИ» — ответ стороны, которая не знает команд проверок, а не сбой.
 *
 * Код зависит от того, ЧТО старое (ответ 1С, docs/TASK_SERVICE_ACCOUNTING_CHECKS_2026-09-25.md, раздел 7в):
 *   — агент без команд проверок, или агент 2026-09-25 21:58 и новее при расширении старше 1.7.0 — `UNKNOWN_COMMAND`;
 *   — агент сборок 25.09 11:56–21:58 при расширении старше 1.7.0: по HTTP IIS отвечает на незнакомый маршрут
 *     страницей 404, и агент отдаёт `ONEC_BAD_RESPONSE` с `onecHttpStatus: 404`; по COM шлюз расширения отвечает
 *     `NOT_FOUND` «…нет среди бизнес-операций».
 * Других источников таких ответов у команд проверок нет (там же), поэтому два последних — не сбой, а «не умеет».
 * Без них база со старым расширением выглядела бы на панели главбуха упавшей, а не устаревшей.
 */
export function isCapabilityMissing(error: CommandFailure): boolean {
	if (error.code === "UNKNOWN_COMMAND") return true;
	if (error.code === "ONEC_BAD_RESPONSE" && error.onecHttpStatus === 404) return true;
	return error.code === "NOT_FOUND" && /нет среди бизнес-операций/i.test(error.message);
}

/**
 * Причина «база не проверена» — в том виде, в каком её увидит ERP.
 *
 * ERP показывает CAPABILITY_MISSING нейтрально: «проверки недоступны — обновите агента/расширение». Это не упущение
 * бухгалтера, и красить его как «база не проверена» значит звать к базе человека, который ничего не исправит.
 * Агент старой сборки (без перечня типов) до очереди не отказывает, а отвечает по сети — причина та же, поэтому и
 * код тот же (см. isCapabilityMissing); исходный код остаётся в тексте и в журнале прогонов сервиса.
 */
export function uncheckedReason(error: CommandFailure): { code: string; message: string } {
	if (isCapabilityMissing(error)) {
		return {
			code: CAPABILITY_MISSING.code,
			message: `База не знает команды проверок учёта (${error.code}: ${error.message}) — обновите агента BuhProf и расширение BuhProf-AI в базе (проверки есть с версии 1.7)`,
		};
	}
	return { code: error.code, message: error.message };
}
