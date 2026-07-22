/**
 * TableFooter — строка итогов таблицы (<tfoot>). Показывается, если хотя бы у одной
 * видимой колонки задан footer-итог; значение считает computeFooterValue.
 *
 * Вынесено из Table/index.tsx (T4). Чистый потребитель контекста (useTableContext) —
 * рендерит только примитивы, поэтому вынос безопасен (context.tsx развязал цикл).
 */
import { memo, useMemo } from 'react';
import { useTableContext } from './context';
import { computeFooterValue } from './services';
import styles from './Table.module.scss';

export const TableFooter = memo(() => {
  const { columns, rows } = useTableContext();
  const visibleColumns = useMemo(() => columns.filter(c => c.visible), [columns]);

  // Проверяем есть ли хоть одна колонка с footer-итогом
  const hasFooter = visibleColumns.some(c => c.footer && c.footer !== 'none');
  if (!hasFooter) return null;

  return (
    <tfoot>
      <tr>
        {/* Колонка чекбокса */}
        <td />
        {visibleColumns.map(col => {
          const value = computeFooterValue(col, rows);
          return (
            <td key={col.identifier}>
              <div className={styles.TableFooterCell}>
                {value !== null && <span>{value}</span>}
              </div>
            </td>
          );
        })}
      </tr>
    </tfoot>
  );
});
TableFooter.displayName = 'TableFooter';
