/**
 * Редактор пунктов шаблона чек-листа: упорядоченные строки «текст — проверка — пункт стандарта».
 *
 * Привязка к проверке учёта не декоративна: пункт с проверкой нельзя отметить «ок», пока по
 * ней у клиента открыты ошибки (СК3.2), а «ок» при находке за тот же период — кандидат по
 * п. 27 (СК3.3). Поэтому рядом с полем — подсказка, а пункт стандарта подставляется сам.
 */
import { FC, useCallback, useMemo } from "react";
import { Button } from "src/components/Button";
import IconButton from "src/components/IconButton/IconButton";
import { Field, FieldSelect } from "src/components/Field";
import { translate } from "src/i18";
import { checkOptions } from "src/services/quality/checkCatalog";
import type { StandardItem } from "src/services/quality/api";
import { STANDARD_ITEMS_COUNT, emptyDraft, moveDraft, withCheck, type TemplateItemDraft } from "./templateItems";
import styles from "./ChecklistTemplates.module.scss";

interface Props {
	items: TemplateItemDraft[];
	onChange: (items: TemplateItemDraft[]) => void;
	disabled?: boolean;
	/** Справочник пунктов стандарта фирмы (подписи); пусто — просто номера 1…40. */
	standardItems?: StandardItem[];
	/** Префикс имён полей (formUid формы). */
	namePrefix: string;
}

export const ChecklistItemsEditor: FC<Props> = ({ items, onChange, disabled = false, standardItems = [], namePrefix }) => {
	const checks = useMemo(() => checkOptions(translate("checklistTplNoCheck")), []);
	const numbers = useMemo(() => {
		const titled = new Map(standardItems.map((s) => [s.number, s.title]));
		const opts = [{ value: "", label: translate("checklistTplNoStandardItem") }];
		for (let n = 1; n <= STANDARD_ITEMS_COUNT; n++) {
			const title = titled.get(n);
			opts.push({ value: String(n), label: title ? `${n}. ${title}` : String(n) });
		}
		return opts;
	}, [standardItems]);

	const update = useCallback((index: number, patch: (d: TemplateItemDraft) => TemplateItemDraft) => {
		onChange(items.map((d, i) => (i === index ? patch(d) : d)));
	}, [items, onChange]);

	return (
		<div className={styles.Editor}>
			<div className={`${styles.Row} ${styles.Head}`}>
				<span className={styles.Num}>#</span>
				<span>{translate("checklistTplItemText")}</span>
				<span>{translate("checklistTplItemCheck")}</span>
				<span>{translate("checklistTplItemStandard")}</span>
				<span />
			</div>
			{items.length === 0 && <div className={styles.Empty}>{translate("checklistTplNoItems")}</div>}
			{items.map((d, i) => (
				<div key={d.key} className={styles.Row}>
					<span className={styles.Num}>{i + 1}</span>
					<Field name={`${namePrefix}_itemText${i}`} value={d.text} disabled={disabled}
						onChange={(e) => update(i, (x) => ({ ...x, text: e.target.value }))} />
					<FieldSelect name={`${namePrefix}_itemCheck${i}`} value={d.checkCode} options={checks} disabled={disabled}
						onChange={(e) => update(i, (x) => withCheck(x, e.target.value))} />
					<FieldSelect name={`${namePrefix}_itemStd${i}`} value={d.standardItemNumber} options={numbers} disabled={disabled}
						onChange={(e) => update(i, (x) => ({ ...x, standardItemNumber: e.target.value }))} />
					<span className={styles.RowActions}>
						<Button size="sm" disabled={disabled || i === 0} onClick={() => onChange(moveDraft(items, i, -1))}
							title={translate("checklistTplMoveUp")} aria-label={translate("checklistTplMoveUp")}>↑</Button>
						<Button size="sm" disabled={disabled || i === items.length - 1} onClick={() => onChange(moveDraft(items, i, 1))}
							title={translate("checklistTplMoveDown")} aria-label={translate("checklistTplMoveDown")}>↓</Button>
						<IconButton icon="trash" size="sm" disabled={disabled} onClick={() => onChange(items.filter((_, k) => k !== i))}
							title={translate("checklistTplRemoveItem")} aria-label={translate("checklistTplRemoveItem")} />
					</span>
				</div>
			))}
			<div className={styles.Footer}>
				<Button icon="plus" disabled={disabled} onClick={() => onChange([...items, emptyDraft()])}>{translate("checklistTplAddItem")}</Button>
				<span className={styles.Hint}>{translate("checklistTplCheckHint")}</span>
			</div>
		</div>
	);
};
ChecklistItemsEditor.displayName = "ChecklistItemsEditor";

export default ChecklistItemsEditor;
