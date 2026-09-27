/**
 * Организации баз, ждущие одобрения (Б11 аудита 26.09) — правила отображения без JSX.
 *
 * Отдельно от компонентов — ради тестов и Fast Refresh.
 */
import { translate } from "src/i18";
import type { ErpOrganization, PendingBaseOrganization } from "src/services/onec/api";

/** Ключ списка ожидающих: его читает вкладка и счётчик у её заголовка, перечитывает решение. */
export const BASE_ORGS_PENDING_KEY = ["onec", "base-organizations", "PENDING"] as const;

/** Строка таблицы — одна на пару «база + БИН»: у одной базы БИН один раз, у разных баз он может совпасть. */
export const pendingOrgKey = (o: Pick<PendingBaseOrganization, "baseId" | "bin">): string => `${o.baseId}:${o.bin}`;

/** База словами: ключ реестра и имя, если оно другое; базы в реестре уже нет — прочерк. */
export function baseText(o: Pick<PendingBaseOrganization, "baseKey" | "baseName">): string {
	if (!o.baseKey) return "—";
	return o.baseName && o.baseName !== o.baseKey ? `${o.baseKey} — ${o.baseName}` : o.baseKey;
}

/** Организация для подтверждения и тоста: «Имя» (БИН) — база. */
export const baseOrgTitle = (o: PendingBaseOrganization): string =>
	`«${o.name || "—"}» (${o.bin}) — ${o.baseKey ?? o.baseId.slice(0, 8)}`;

export type PendingOrgRow = {
	uuid: string; bin: string; organizationName: string; onecBase: string; onecServer: string;
	onecReqErpOrg: string; reqReceived: string;
	/** Организация ERP с этим БИН есть — ей и адресуются задачи и заметки. */
	__erp: boolean;
};

/**
 * Строки таблицы. Главное для решения — есть ли в ERP организация с этим БИН: задачи и заметки адресуются ей,
 * а чужой БИН обычно не совпадает ни с одной. БИН организации ERP берём по цифрам: он может быть с пробелами.
 */
export function pendingOrgRows(items: readonly PendingBaseOrganization[], erpOrgs: readonly ErpOrganization[]): PendingOrgRow[] {
	const byBin = new Map<string, ErpOrganization>();
	for (const o of erpOrgs) {
		const bin = String(o.bin ?? "").replace(/\D/g, "");
		if (bin) byBin.set(bin, o);
	}
	return items.map((o) => {
		const erp = byBin.get(o.bin) ?? null;
		return {
			uuid: pendingOrgKey(o),
			bin: o.bin,
			organizationName: o.name || "—",
			onecBase: baseText(o),
			onecServer: o.server || "—",
			onecReqErpOrg: erp ? `${erp.name} — ${translate("onecReqBinMatch")}` : translate("onecReqOrgMissing"),
			reqReceived: o.requestedAt,
			__erp: !!erp,
		};
	});
}
