/**
 * Блокировка начала сеансов — словами и видом метки (TASK_SERVICE_ECHO_WRITE_COMMANDS.md, P1).
 *
 * Раньше «Закрыть вход» отвечало «Вход в базу закрыт» тостом — и всё: включена ли блокировка
 * сейчас, панель не знала и не показывала, а обе кнопки стояли всегда. Теперь состояние хранит
 * реестр: прочитанное у кластера или записанное по последней команде панели.
 */
import { translate } from "src/i18";
import type { ChipTone } from "src/components/StateChip";
import type { OnecBase, SessionsLockResult } from "src/services/onec/api";
import { getFormatDate } from "src/utils/datetime";

export type SessionsLockView = {
	/** Известно ли состояние вообще. */
	known: boolean;
	enabled: boolean;
	tone: ChipTone;
	/** Короткая подпись метки. */
	label: string;
	/** Подробности: сообщение, окно, откуда известно. */
	details: string;
};

type LockFields = Pick<OnecBase, "sessionsDenied" | "sessionsDeniedMessage" | "sessionsDeniedFrom" | "sessionsDeniedTo" | "sessionsDeniedSource"
	| "sessionsDeniedActive" | "sessionsDeniedSeenAt" | "sessionsDeniedCodeSet">;

export function sessionsLockView(base: LockFields | null | undefined): SessionsLockView {
	const v = base?.sessionsDenied;
	if (v == null) {
		return { known: false, enabled: false, tone: "unknown", label: translate("onecSessionsLockUnknown"), details: "" };
	}
	const parts: string[] = [];
	if (v && base?.sessionsDeniedMessage) parts.push(base.sessionsDeniedMessage);
	if (v && (base?.sessionsDeniedFrom || base?.sessionsDeniedTo)) {
		parts.push(`${base?.sessionsDeniedFrom ?? "…"} — ${base?.sessionsDeniedTo ?? "…"}`);
	}
	if (v && base?.sessionsDeniedCodeSet) parts.push(translate("onecSessionsLockCodeSet"));
	if (base?.sessionsDeniedSource === "command") parts.push(translate("onecSessionsLockByCommand"));
	/*
	 * ВКЛЮЧЕНА, НО НЕ ДЕЙСТВУЕТ (агент 23:16, `lock.active`). В кластере осталось окно прошлой
	 * блокировки, и вход сейчас открыт. «Вход закрыт» здесь было бы неправдой: человек ушёл бы,
	 * думая, что в базу не войти, а пользователи входили бы посреди работ.
	 */
	const inactive = v && base?.sessionsDeniedActive === false;
	if (inactive) {
		parts.unshift(translate("onecSessionsLockInactiveHint"));
		// «Не действует» — на момент чтения, а оно бывает до 30 мин старым (П17): говорим, когда читали.
		if (base?.sessionsDeniedSeenAt) parts.push(`${translate("onecSessionsLockReadAt")} ${getFormatDate(base.sessionsDeniedSeenAt)}`);
	}
	return {
		known: true,
		enabled: v,
		tone: inactive ? "unknown" : v ? "bad" : "ok",
		label: translate(inactive ? "onecSessionsLockInactive" : v ? "onecSessionsLockOn" : "onecSessionsLockOff"),
		details: parts.join(". "),
	};
}

/**
 * ИТОГ «ЗАКРЫТЬ/ОТКРЫТЬ ВХОД» — ПО ОТВЕТУ, А НЕ ПО ФАКТУ ОТВЕТА (И26 аудита 26.09).
 *
 * Общий разбор для вкладки «Сеансы» и карточки базы: карточка раньше писала «Выполнено», даже
 * когда вход не закрыт. Порядок проверок — как был во «Сеансах» (П10, П30):
 *   - кластер не отдал состояние после записи (`unverified`) — «не проверено», а не «применено»;
 *   - прочитанное состояние не то, что просили — «не применено»;
 *   - включили, а вход не закрыт (осталось окно прошлой блокировки) или прежнее сброшено не всё —
 *     предупреждение словами агента или нашими;
 *   - иначе — успех.
 */
export function lockOutcome(r: SessionsLockResult | null | undefined, enabled: boolean): { tone: "success" | "warning"; text: string } {
	const echo = r?.state?.lock;
	if (r?.unverified?.includes("enabled")) return { tone: "warning", text: r.caveat || translate("onecLockUnverified") };
	if (echo && echo.enabled !== enabled) return { tone: "warning", text: translate("onecLockNotApplied") };
	if (enabled && (r?.warning || echo?.active === false || (r?.reset && r.reset !== "all"))) {
		return {
			tone: "warning",
			text: [
				r?.warning || (echo?.active === false ? translate("onecLockNotActive") : translate("onecLockEnabled")),
				r?.reset && r.reset !== "all" ? (r.note || translate("onecLockResetPartial")) : "",
			].filter(Boolean).join(". "),
		};
	}
	return { tone: "success", text: translate(enabled ? "onecLockEnabled" : "onecLockDisabled") };
}
