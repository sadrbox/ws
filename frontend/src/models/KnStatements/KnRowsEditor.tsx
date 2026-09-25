/**
 * Строки выписки лицевого счёта КН: загрузка из файла (xlsx/xls/csv) или ручной ввод.
 *
 * Файл разбирает knSheet.mapKnSheet: заголовки ищутся по синонимам, строки итогов и строки без
 * суммы пропускаются — сколько пропущено, говорим сразу, чтобы человек сверил с файлом.
 */
import { FC, useCallback, useRef, useState } from "react";
import { Button } from "src/components/Button";
import IconButton from "src/components/IconButton/IconButton";
import { Field } from "src/components/Field";
import Notice, { type NoticeItem } from "src/components/Notice";
import { readWorkbookAoa } from "src/utils/sheetIO";
import { translate } from "src/i18";
import { emptyKnRow, mapKnSheet, type KnDraftRow } from "./knSheet";
import styles from "./KnStatements.module.scss";

interface Props {
	rows: KnDraftRow[];
	onChange: (rows: KnDraftRow[]) => void;
	disabled?: boolean;
	namePrefix: string;
}

export const KnRowsEditor: FC<Props> = ({ rows, onChange, disabled = false, namePrefix }) => {
	const fileRef = useRef<HTMLInputElement>(null);
	const [notices, setNotices] = useState<NoticeItem[]>([]);

	const update = useCallback((index: number, patch: Partial<KnDraftRow>) => {
		onChange(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
	}, [rows, onChange]);

	const readFile = useCallback(async (file: File) => {
		try {
			const result = mapKnSheet(readWorkbookAoa(await file.arrayBuffer()));
			if (result.noHeader) {
				setNotices([{ type: "error", text: translate("knImportNoHeader") }]);
				return;
			}
			if (!result.rows.length) {
				setNotices([{ type: "error", text: translate("knImportNoRows") }]);
				return;
			}
			onChange(result.rows);
			const done = translate("knImportDone").replace("{n}", String(result.rows.length));
			setNotices([
				{ type: "success", text: done },
				...(result.skipped ? [{ type: "warning" as const, text: translate("knImportSkipped").replace("{n}", String(result.skipped)) }] : []),
			]);
		} catch {
			// Файл не читается как книга (повреждён, не тот формат) — это про данные, а не про систему.
			setNotices([{ type: "error", text: translate("knImportFailed") }]);
		}
	}, [onChange]);

	return (
		<div className={styles.Editor}>
			<div className={styles.Toolbar}>
				<input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className={styles.FileInput}
					onChange={(e) => {
						const file = e.target.files?.[0];
						e.target.value = ""; // тот же файл можно выбрать повторно
						if (file) void readFile(file);
					}} />
				<Button icon="download" disabled={disabled} onClick={() => fileRef.current?.click()}>{translate("knImportFile")}</Button>
				<Button icon="plus" disabled={disabled} onClick={() => onChange([...rows, emptyKnRow()])}>{translate("knAddRow")}</Button>
				{rows.length > 0 && <Button disabled={disabled} onClick={() => { onChange([]); setNotices([]); }}>{translate("clear")}</Button>}
			</div>
			<Notice inline items={notices} />
			<div className={`${styles.Row} ${styles.Head}`}>
				<span className={styles.Num}>#</span>
				<span>{translate("kbk")}</span>
				<span>{translate("name")}</span>
				<span>{translate("knBalance")}</span>
				<span />
			</div>
			{rows.length === 0 && <div className={styles.Empty}>{translate("knNoRowsYet")}</div>}
			{rows.map((r, i) => (
				<div key={r.key} className={styles.Row}>
					<span className={styles.Num}>{i + 1}</span>
					<Field name={`${namePrefix}_kbk${i}`} value={r.kbk} disabled={disabled} maxLength={20} onChange={(e) => update(i, { kbk: e.target.value })} />
					<Field name={`${namePrefix}_knName${i}`} value={r.name} disabled={disabled} onChange={(e) => update(i, { name: e.target.value })} />
					<Field name={`${namePrefix}_knBalance${i}`} value={r.balance} disabled={disabled} onChange={(e) => update(i, { balance: e.target.value })} />
					<IconButton icon="trash" size="sm" disabled={disabled} onClick={() => onChange(rows.filter((_, k) => k !== i))}
						title={translate("knRemoveRow")} aria-label={translate("knRemoveRow")} />
				</div>
			))}
		</div>
	);
};
KnRowsEditor.displayName = "KnRowsEditor";

export default KnRowsEditor;
