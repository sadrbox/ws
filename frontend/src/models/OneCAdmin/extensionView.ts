/**
 * Раздел «Расширение БухПроф-AI», вкладка «Базы с расширением»: строки без JSX (ради тестов и Fast Refresh).
 *
 * ИСТОЧНИК — САМО РАСШИРЕНИЕ, А НЕ КЛАСТЕР (23.09). Первая версия брала список из реестра баз, который ведёт
 * админ-агент и который панель сужает до выбранного кластера: у клиента без админ-агента экран оставался
 * пустым, хотя заявки одобрены и токены выданы. Теперь сервис отдаёт готовую сводку по заявкам, токенам и
 * срезу бизнес-агентов (`GET /v1/onec/extension-bases`), а здесь — только подписи и итоги для человека.
 */
import { translate } from "src/i18";
import type { ExtensionBase } from "src/services/onec/api";

export type ExtensionRow = {
	uuid: string;
	baseKey: string;
	name: string;
	organizationName: string;
	extVersion: string;
	/** Версия со слов заявки, а не от агента: база могла обновиться, и мы об этом не знаем. */
	versionStale: boolean;
	accessLabel: string;
	access: ExtensionBase["access"];
	transportLabel: string;
	agentName: string;
	approvedAt: string | null;
	seenAt: string | null;
	pending: boolean;
};

const accessLabelOf = (a: ExtensionBase["access"]): string => translate(
	a === "active" ? "onecExtAccessActive"
		: a === "rotating" ? "onecExtAccessRotating"
			: a === "revoked" ? "onecExtAccessRevoked" : "onecExtAccessNone",
);

export function extensionRows(items: readonly ExtensionBase[]): ExtensionRow[] {
	return items.map((b) => ({
		uuid: b.baseKey.toLowerCase(),
		baseKey: b.baseKey,
		name: b.name || b.baseKey,
		organizationName: b.organizationName || "—",
		extVersion: b.extVersion,
		versionStale: b.extVersionSource === "registration",
		access: b.access,
		accessLabel: accessLabelOf(b.access),
		// Транспорт знает только агент: пусто — «не сообщал», а не «связи нет».
		transportLabel: b.transport ? translate(b.transport === "http" ? "onecExtTransportHttp" : "onecExtTransportCom") : "—",
		agentName: b.agentName || "—",
		approvedAt: b.approvedAt,
		seenAt: b.seenAt,
		pending: b.pending,
	}));
}

export type ExtensionSummary = {
	bases: number;
	/** С действующим доступом к чату (токен выдан и не отозван). */
	withAccess: number;
	/** Заявки, ждущие решения: база просится, доступа пока нет. */
	pending: number;
	/** Самая свежая встреченная версия — с ней сверяют отстающих. */
	newestVersion: string;
	/** Базы со сборкой старее самой свежей — их и обновляют. */
	outdated: string[];
	/** Баз, о версии которых ничего не известно: это не «старая», а «не видели». */
	unknownVersion: number;
};

/** Сравнение версий числами: «1.10.0» новее «1.9.0», хотя по алфавиту наоборот. */
export function compareVersions(a: string, b: string): number {
	const parts = (v: string) => v.split(".").map((x) => Number.parseInt(x, 10) || 0);
	const [pa, pb] = [parts(a), parts(b)];
	for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
		const d = (pa[i] ?? 0) - (pb[i] ?? 0);
		if (d) return d;
	}
	return 0;
}

export function extensionSummary(rows: readonly ExtensionRow[]): ExtensionSummary {
	const versions = rows.map((r) => r.extVersion).filter(Boolean);
	/*
	 * ЭТАЛОН — САМАЯ СВЕЖАЯ ИЗ ВСТРЕЧЕННЫХ, а не самая частая: пока обновление идёт по клиентам, частой
	 * какое-то время остаётся СТАРАЯ сборка, и «отстающими» оказались бы уже обновлённые базы.
	 */
	const newest = versions.reduce((acc, v) => (compareVersions(v, acc) > 0 ? v : acc), versions[0] ?? "");
	return {
		bases: rows.length,
		withAccess: rows.filter((r) => r.access === "active").length,
		pending: rows.filter((r) => r.pending).length,
		newestVersion: newest,
		outdated: rows.filter((r) => r.extVersion && compareVersions(r.extVersion, newest) < 0).map((r) => r.baseKey),
		unknownVersion: rows.filter((r) => !r.extVersion).length,
	};
}
