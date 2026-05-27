import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import type { TDataItem } from "src/components/Table/types";

interface OptionItem {
	value: string;
	label: string;
}

/**
 * Tracks which options from a fixed set are currently used across SubTable rows.
 * Shared logic for SubTables that enforce uniqueness of a specific field
 * (e.g. "modelName" in "Разрешения", "valueType" in "Предопределённые значения").
 *
 * Pass `handleRowsChange` as `onAllItemsChange` to SubTable — it receives the full
 * merged snapshot (server + pending) and keeps tracking state accurate in all scenarios:
 * add / delete / change / save / reload.
 */
export function useUniqueOptionRows(
	options: readonly OptionItem[],
	fieldKey: string,
	initialRows?: TDataItem[],
) {
	const [rows, setRows] = useState<TDataItem[]>(initialRows ?? []);

	// Sync with initialRows (incl. empty on reopen/reset) to avoid stale usedSet.
	// onAllItemsChange keeps it updated on mutations; initial sync ensures correct after load/save/reopen.
	const prevRef = useRef<TDataItem[] | undefined>(initialRows);
	useEffect(() => {
		if (initialRows !== prevRef.current) {
			prevRef.current = initialRows;
			setRows(initialRows ?? []);
		}
	}, [initialRows]);

	const usedSet = useMemo(
		() =>
			new Set(
				rows
					.filter((r) => (r as any)._pendingAction !== "delete")
					.map((r) => r[fieldKey] as string)
					.filter(Boolean),
			),
		[rows, fieldKey],
	);

	/** True when every option already has a corresponding row */
	const allUsed = useMemo(
		() => options.length > 0 && options.every((o) => usedSet.has(o.value)),
		[options, usedSet],
	);

	/** First option value not yet present in the given rows snapshot (ignores delete markers) */
	const getFirstUnused = useCallback(
		(currentRows: TDataItem[]): string => {
			const used = new Set(
				currentRows
					.filter((r) => (r as any)._pendingAction !== "delete")
					.map((r) => r[fieldKey] as string)
					.filter(Boolean),
			);
			return options.find((o) => !used.has(o.value))?.value ?? "";
		},
		[options, fieldKey],
	);

	/**
	 * Options not yet in currentRows, always including `currentValue` (for the row being edited).
	 * Pass the full ctx.rows and the current row's value — the row itself is handled by currentValue.
	 */
	const getAvailableOptions = useCallback(
		(currentRows: TDataItem[], currentValue?: string): OptionItem[] => {
			const used = new Set(
				currentRows
					.filter((r) => (r as any)._pendingAction !== "delete")
					.map((r) => r[fieldKey] as string)
					.filter(Boolean),
			);
			return options.filter(
				(o) => !used.has(o.value) || o.value === currentValue,
			);
		},
		[options, fieldKey],
	);

	/** Pass as onAllItemsChange to SubTable */
	const handleRowsChange = useCallback((items: TDataItem[]) => {
		setRows(items);
	}, []);

	return {
		allUsed,
		getFirstUnused,
		getAvailableOptions,
		handleRowsChange,
	} as const;
}
