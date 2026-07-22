/**
 * TableConfigModalForm — модалка настройки колонок таблицы: видимость + порядок
 * (рендерит TableConfigColumns) с сохранением в localStorage по componentName.
 *
 * Вынесено из Table/index.tsx (T4). Потребитель useTableContext; служебные
 * колонки (__*) скрыты из настроек и не сохраняются.
 */
import { type FC, useState, useCallback, useEffect } from 'react';
import { translate } from 'src/i18';
import Modal from '../Modal';
import type { TColumn, TypeModalFormProps } from './types';
import { useTableContext } from './context';
import { normalizeLastColumnWidth } from './services';
import { TableConfigColumns } from './TableConfigColumns';
import styles from './Table.module.scss';

export const TableConfigModalForm: FC<TypeModalFormProps> = ({ method }) => {
  const { columns, componentName, actions } = useTableContext();
  // Служебные колонки (__*) скрываем из настроек и не сохраняем.
  const [columnsConfig, setColumnsConfig] = useState<TColumn[]>(columns.filter(c => !c.identifier.startsWith("__")));

  const onApply = useCallback(() => {
    const normalized = normalizeLastColumnWidth(columnsConfig.filter(c => !c.identifier.startsWith("__")));
    localStorage.setItem(`table_columns_${componentName}`, JSON.stringify(normalized));
    actions?.setColumns?.(normalized);
  }, [columnsConfig, componentName, actions]);

  useEffect(() => { setColumnsConfig(columns.filter(c => !c.identifier.startsWith("__"))); }, [columns]);

  return (
    <Modal title={translate("tableColumns")} method={method} onApply={onApply} className={styles.ColumnsModal}>
      <TableConfigColumns columns={columnsConfig} setColumns={setColumnsConfig} />
    </Modal>
  );
};
