/**
 * Блокировка начала сеансов — словами и видом метки (TASK_SERVICE_ECHO_WRITE_COMMANDS.md, P1).
 *
 * Раньше «Закрыть вход» отвечало «Вход в базу закрыт» тостом — и всё: включена ли блокировка
 * сейчас, панель не знала и не показывала, а обе кнопки стояли всегда. Теперь состояние хранит
 * реестр: прочитанное у кластера или записанное по последней команде панели.
 */
import { translate } from "src/i18";
import type { ChipTone } from "src/components/StateChip";
import type { OnecBase } from "src/services/onec/api";

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
	| "sessionsDeniedActive">;

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
	if (base?.sessionsDeniedSource === "command") parts.push(translate("onecSessionsLockByCommand"));
	/*
	 * ВКЛЮЧЕНА, НО НЕ ДЕЙСТВУЕТ (агент 23:16, `lock.active`). В кластере осталось окно прошлой
	 * блокировки, и вход сейчас открыт. «Вход закрыт» здесь было бы неправдой: человек ушёл бы,
	 * думая, что в базу не войти, а пользователи входили бы посреди работ.
	 */
	const inactive = v && base?.sessionsDeniedActive === false;
	if (inactive) parts.unshift(translate("onecSessionsLockInactiveHint"));
	return {
		known: true,
		enabled: v,
		tone: inactive ? "unknown" : v ? "bad" : "ok",
		label: translate(inactive ? "onecSessionsLockInactive" : v ? "onecSessionsLockOn" : "onecSessionsLockOff"),
		details: parts.join(". "),
	};
}
