/**
 * «Состояние сервера 1С» словами — строки для вкладки карточки агента (R1, docs/TASKS_DEV_2026-09-14.md).
 *
 * Ответ `AGENT_HEALTH` — глубокий объект, и половина его полей бывает пустой (у бизнес-агента нет
 * кластера, у старой сборки нет части признаков). Таблица показывает только то, что пришло, а строки,
 * требующие внимания (не готово, нет базы данных, отказ входа в СУБД), отмечает `warn`.
 *
 * Отдельным модулем: строки проверяются тестом, а не-компонентный экспорт в модуле с компонентом
 * ломает Fast Refresh всему файлу.
 */
import { translate } from "src/i18";
import type { AgentHealth, OnecAgent } from "src/services/onec/api";
import { getFormatDate } from "src/utils/datetime";
import { formatDuration } from "./queueStats";

export type HealthRow = { label: string; value: string; warn?: boolean };
export type HealthSection = { title: string; rows: HealthRow[] };

const yesNo = (b: boolean | undefined): string =>
	b === undefined ? "—" : translate(b ? "onecHealthYes" : "onecHealthNo");

const secs = (n: number | undefined): string =>
	typeof n === "number" ? (formatDuration(n) || `0 ${translate("secShort")}`) : "—";

/** Признак отказа входа: агент шлёт текст, признак или объект — показываем как есть. */
const failureText = (v: unknown): string | null => {
	if (!v) return null;
	if (typeof v === "string") return v;
	if (v === true) return translate("onecHealthYes");
	try { return JSON.stringify(v); } catch { return "—"; }
};

const pusher = (rows: HealthRow[]) => (label: string, value: string | null | undefined, warn = false) => {
	if (value === null || value === undefined || value === "") return;
	rows.push(warn ? { label, value, warn } : { label, value });
};

export function healthSections(h: AgentHealth): HealthSection[] {
	const out: HealthSection[] = [];

	const a = h.agent;
	if (a) {
		const rows: HealthRow[] = [];
		const push = pusher(rows);
		push(translate("onecHealthBuild"), a.build || a.version);
		push(translate("onecHealthState"), a.state);
		if (typeof a.uptimeSecs === "number") push(translate("onecHealthUptime"), secs(a.uptimeSecs));
		push(translate("onecHealthInstance"), a.instance);
		push(translate("onecHealthService"), a.serviceName);
		if (a.ibReady !== undefined) push(translate("onecHealthIbReady"), yesNo(a.ibReady), a.ibReady === false);
		if (typeof a.maxParallel === "number") push(translate("onecHealthParallel"), String(a.maxParallel));
		if (a.persistentBridge !== undefined) push(translate("onecHealthBridge"), yesNo(a.persistentBridge));
		if (typeof a.commandTimeoutSecs === "number" || typeof a.longCommandTimeoutSecs === "number") {
			push(translate("onecHealthTimeouts"), `${secs(a.commandTimeoutSecs)} / ${secs(a.longCommandTimeoutSecs)}`);
		}
		push(translate("onecHealthLastError"), a.lastError, true);
		if (rows.length) out.push({ title: translate("onecHealthAgent"), rows });
	}

	const readiness = h.readiness?.items ?? [];
	if (readiness.length) {
		out.push({
			title: translate("onecHealthReadiness"),
			rows: readiness.map((i) => ({
				label: i.key,
				value: `${yesNo(i.ok)}${i.note ? ` — ${i.note}` : ""}`,
				...(i.ok ? {} : { warn: true }),
			})),
		});
	}

	const c = h.cluster;
	if (c) {
		const rows: HealthRow[] = [];
		const push = pusher(rows);
		push(translate("onecHealthPlatform"), c.platform);
		if (Array.isArray(c.clusters)) {
			push(translate("onecHealthClusters"),
				c.clusters.map((x) => `${x.name || "—"} (${x.host || "?"}:${x.port || "?"})`).join(", "));
		} else if (c.clusters?.error) {
			push(translate("onecHealthClusters"), c.clusters.error, true);
		}
		if (c.bases) {
			push(translate("onecHealthBases"), `${c.bases.known ?? "—"} / ${c.bases.dbChecked ?? "—"}`);
			const missing = c.bases.dbMissing ?? [];
			if (missing.length) push(translate("onecHealthDbMissing"), `${missing.length}: ${missing.join(", ")}`, true);
		}
		if (c.publications) {
			push(translate("onecHealthPublications"), [
				String(c.publications.found ?? 0),
				translate(c.publications.complete ? "onecHealthComplete" : "onecHealthPartial"),
				typeof c.publications.ageSecs === "number" ? secs(c.publications.ageSecs) : "",
			].filter(Boolean).join(" · "), c.publications.complete === false);
		}
		/*
		 * ЧТЕНИЕ БЛОКИРОВОК (П11). По нему разбирается, почему в срезе баз мало строк с блокировкой
		 * (А6): прочитано меньше, чем баз, или часть баз на паузе после отказа — это не «блокировок
		 * нет», а «не знаем».
		 */
		if (c.locks) {
			const l = c.locks;
			const behind = typeof l.known === "number" && typeof l.fresh === "number" && l.fresh < l.known;
			push(translate("onecHealthLocks"), [
				`${translate("onecHealthLocksRead")}: ${l.fresh ?? "—"} / ${l.known ?? "—"}`,
				`${translate("onecHealthLocksEnabled")}: ${l.enabled ?? 0}`,
				`${translate("onecHealthLocksPaused")}: ${l.paused ?? 0}`,
			].join(" · "), behind || (l.paused ?? 0) > 0);
			if (l.lastRefusal) {
				const r = l.lastRefusal;
				push(translate("onecHealthLocksRefusal"),
					`${[r.base, r.reason].filter(Boolean).join(" — ")}${r.at ? ` (${getFormatDate(r.at)})` : ""}`, true);
			}
		}
		if (c.dbPassword !== undefined) push(translate("onecHealthDbPassword"), yesNo(c.dbPassword), c.dbPassword === false);
		push(translate("onecHealthDbLoginFailure"), failureText(c.dbLoginFailure), true);
		push(translate("onecHealthQueryLoginFailure"), failureText(c.queryLoginFailure), true);
		const clients = c.dbmsClients ?? [];
		if (clients.length) {
			push(translate("onecHealthDbmsClients"),
				clients.map((x) => `${x.name} — ${x.path || translate("onecHealthNotFound")}`).join("; "));
		}
		if (rows.length) out.push({ title: translate("onecHealthCluster"), rows });
	}

	if (h.commands && (typeof h.commands.done === "number" || typeof h.commands.failed === "number")) {
		const failed = h.commands.failed ?? 0;
		out.push({
			title: translate("onecHealthCommands"),
			rows: [{ label: translate("onecHealthDone"), value: `${h.commands.done ?? 0} / ${failed}`, ...(failed > 0 ? { warn: true } : {}) }],
		});
	}

	return out;
}

const FEATURE_KEY: Record<string, string> = {
	abort: "onecFeatureAbort",
	roles: "onecFeatureRoles",
	commandStats: "onecFeatureStats",
	health: "onecFeatureHealth",
	log: "onecFeatureLog",
	selftest: "onecFeatureSelftest",
};

/** Чего нет в сборке агента — словами (R3). Незнакомый ключ показывается как есть. */
export const featureLabels = (keys: string[] | undefined): string[] =>
	(keys ?? []).map((k) => (FEATURE_KEY[k] ? translate(FEATURE_KEY[k]) : k));

/** Сборка для списка и карточки: «2026-09-14 23:16 · Устарел». */
export const agentBuildLabel = (a: Pick<OnecAgent, "build" | "buildOutdated">): string =>
	a.build ? (a.buildOutdated ? `${a.build} · ${translate("onecAgentOutdated")}` : a.build) : "—";
