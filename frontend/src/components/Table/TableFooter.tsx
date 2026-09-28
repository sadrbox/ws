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
  const { variant, selectable, columns, rows, footerValues } = useTableContext();
  const visibleColumns = useMemo(() => columns.filter(c => c.visible), [columns]);
  // Ячейка под чекбокс — только если колонка отметок есть (как в шапке и colgroup):
  // иначе итоги съезжали на колонку вправо («Сальдо КН» под «Сальдо 1С»).
  const showCheckbox = variant !== 'select' && selectable;

  // Готовое значение источника (footerValues) важнее подсчёта по строкам — см. context.footerValues.
  const valueOf = (col: typeof columns[number]) =>
    footerValues && col.identifier in footerValues ? footerValues[col.identifier] : computeFooterValue(col, rows);
  // Проверяем есть ли хоть одна колонка с footer-итогом
  const hasFooter = visibleColumns.some(c => (c.footer && c.footer !== 'none') || footerValues?.[c.identifier] != null);
  if (!hasFooter) return null;

  return (
    <tfoot>
      <tr>
        {/* Колонка чекбокса */}
        {showCheckbox && <td />}
        {visibleColumns.map(col => {
          const value = valueOf(col);
          return (
            <td key={col.identifier}>
              {/* Итоги — числа, их место справа; подпись («Итого») в текстовой колонке — слева, как текст над ней. */}
              <div className={styles.TableFooterCell} style={col.type === 'number' ? undefined : { justifyContent: 'flex-start' }}>
                {value != null && <span>{value}</span>}
              </div>
            </td>
          );
        })}
      </tr>
    </tfoot>
  );
});
TableFooter.displayName = 'TableFooter';
