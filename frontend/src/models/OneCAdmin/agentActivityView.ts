/**
 * Карточка агента: подписи команд и событий журнала (п. 2, 3) — без JSX, ради тестов и Fast Refresh.
 */
import { translate } from "src/i18";

export const commandStateLabel = (s: string): string => ({
	queued: translate("onecCmdQueued"),
	dispatched: translate("onecCmdRunning"),
	done: translate("onecCmdDone"),
	failed: translate("onecCmdFailed"),
	expired: translate("onecCmdExpired"),
	canceled: translate("onecCmdCanceled"),
}[s] ?? s);

export const commandStateTone = (s: string): "wait" | "ok" | "bad" | "off" =>
	s === "queued" || s === "dispatched" ? "wait" : s === "done" ? "ok" : s === "failed" || s === "expired" ? "bad" : "off";

/** События над агентом — словами; незнакомое — как есть (новое событие не должно пропадать из журнала). */
const EVENT_KEYS: Record<string, string> = {
	"agent.create": "onecAuditCreate",
	"agent.rename": "onecAuditRename",
	"agent.rotate_token": "onecAuditRotate",
	"agent.disable": "onecAuditDisable",
	"agent.enable": "onecAuditEnable",
	"agent.delete": "onecAuditDelete",
	"agent.register": "onecAuditRegister",
	"agent.limits": "onecAuditLimits",
	"agent.active_bins": "onecAuditActiveBins",
	"agent.limit_mismatch": "onecAuditLimitMismatch",
	"agent.capabilities.lost": "onecAuditCapsLost",
	"agent.enrollment.approved": "onecAuditEnrollApproved",
	"agent.enrollment.token_delivered": "onecAuditEnrollDelivered",
	"agent.bin_activation.requested": "onecAuditBinRequested",
	"agent.bin_activation.approved": "onecAuditBinApproved",
	"agent.bin_activation.rejected": "onecAuditBinRejected",
	"command.limit_bypass": "onecAuditLimitBypass",
	"agent.instance.assign": "onecAuditInstanceAssign",
	"agent.instance.release": "onecAuditInstanceRelease",
	"agent.instance.released": "onecAuditInstanceReleased",
	"agent.instance.takeover": "onecAuditInstanceTakeover",
	"agent.enrollment.rejected": "onecAuditEnrollRejected",
};

export const auditEventLabel = (event: string): string => (EVENT_KEYS[event] ? translate(EVENT_KEYS[event]) : event);

/** Подробности одной строкой: «имя: X · версия: Y». Вложенное — коротким JSON, пустое — прочерк. */
export function auditDetailsText(details: Record<string, unknown>): string {
	const parts = Object.entries(details ?? {})
		.filter(([, v]) => v !== null && v !== undefined && v !== "")
		.map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
	const text = parts.join(" · ");
	return text.length > 300 ? `${text.slice(0, 299)}…` : text || "—";
}

/** Простые поля сводки бизнес-агента (версия, состояние, …) — списки и лимиты показываются отдельно. */
export function healthScalars(h: Record<string, unknown>): [string, string][] {
	return Object.entries(h)
		.filter(([k, v]) => k !== "bases" && k !== "limits" && (typeof v === "string" || typeof v === "number" || typeof v === "boolean"))
		.map(([k, v]) => [k, String(v)]);
}
