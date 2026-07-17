import { TDataItem } from "src/components/Table/types";
import { getComponentName } from "src/app/getComponentName";
import type { TComponentNode } from "src/app/types";

function getPaneName(component: TComponentNode | string): string {
	if (typeof component === "string") return component;
	return getComponentName(component);
}

function serializePaneUniqValue(value: unknown): string {
	if (value === undefined || value === null || value === "") return "";
	if (
		typeof value === "string" ||
		typeof value === "number" ||
		typeof value === "boolean"
	) {
		return String(value);
	}
	if (value instanceof Date) return value.toISOString();
	if (Array.isArray(value)) {
		return `[${value
			.map((item) => serializePaneUniqValue(item))
			.filter(Boolean)
			.join(",")}]`;
	}
	if (typeof value === "object") {
		const entries = Object.entries(value as Record<string, unknown>)
			.filter(
				([, entryValue]) =>
					entryValue !== undefined && entryValue !== null && entryValue !== "",
			)
			.sort(([a], [b]) => a.localeCompare(b))
			.map(
				([key, entryValue]) => `${key}:${serializePaneUniqValue(entryValue)}`,
			);
		return `{${entries.join("|")}}`;
	}
	return String(value);
}

export function buildPaneUniqId(
	component: TComponentNode | string,
	data?: Partial<TDataItem>,
): string {
	const name = getPaneName(component);

	if (name.endsWith("List")) return name;

	if (data?.uuid || data?.id) return `${name}-${data.uuid ?? data.id}`;

	if ((data as any)?._paneToken) return `${name}-${(data as any)._paneToken}`;

	const signature = Object.entries(data ?? {})
		.filter(
			([, value]) => value !== undefined && value !== null && value !== "",
		)
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([key, value]) => `${key}:${serializePaneUniqValue(value)}`)
		.join("|");

	return signature ? `${name}-${signature}` : name;
}
