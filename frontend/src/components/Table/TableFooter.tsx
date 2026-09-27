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
  const { variant, selectable, columns, rows } = useTableContext();
  const visibleColumns = useMemo(() => columns.filter(c => c.visible), [columns]);
  // Ячейка под чекбокс — только если колонка отметок есть (как в шапке и colgroup):
  // иначе итоги съезжали на колонку вправо («Сальдо КН» под «Сальдо 1С»).
  const showCheckbox = variant !== 'select' && selectable;

  // Проверяем есть ли хоть одна колонка с footer-итогом
  const hasFooter = visibleColumns.some(c => c.footer && c.footer !== 'none');
  if (!hasFooter) return null;

  return (
    <tfoot>
      <tr>
        {/* Колонка чекбокса */}
        {showCheckbox && <td />}
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
