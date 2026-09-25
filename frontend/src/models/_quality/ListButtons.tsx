/**
 * Кнопки «Добавить» / «Удалить» списков E17 — вместо кнопок таблицы (см. useQualityListActions:
 * встроенные включает право на модель, которого у справочников качества нет).
 */
import { type FC, type ReactNode } from "react";
import { Button } from "src/components/Button";
import { translate } from "src/i18";
import type { TDataItem } from "src/components/Table/types";

interface Props {
	canAdd: boolean;
	canDelete: boolean;
	/** Отмеченные строки (для «Удалить»). */
	selected?: TDataItem[];
	onAdd: () => void;
	onDelete?: (rows: TDataItem[]) => Promise<void> | void;
	/** Прочие контролы тулбара списка (отборы) — после кнопок записи. */
	children?: ReactNode;
}

export const QualityListButtons: FC<Props> = ({ canAdd, canDelete, selected = [], onAdd, onDelete, children }) => (
	<>
		{canAdd && <Button onClick={onAdd}>{translate("add")}</Button>}
		{canDelete && onDelete && (
			<Button onClick={() => void onDelete(selected)} disabled={!selected.length}
				title={!selected.length ? translate("selectRowsFirst") : undefined}>
				{translate("delete")}
			</Button>
		)}
		{children}
	</>
);

export default QualityListButtons;
