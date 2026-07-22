/**
 * TableArea — обёртка <table>: colgroup (ширины колонок) + шапка/тело/итоги.
 *
 * Вынесено из Table/index.tsx (T4). Тонкая обёртка-потребитель контекста; после
 * выноса Header/Body/Footer в файлы её вынос свободен от циклических импортов.
 */
import { memo, useMemo } from 'react';
import { useTableContext } from './context';
import { TableHeader } from './TableHeader';
import { TableBody } from './TableBody';
import { TableFooter } from './TableFooter';
import styles from './Table.module.scss';

export const TableArea = memo(() => {
  const { variant, selectable, columns } = useTableContext();
  const showCheckbox = variant !== 'select' && selectable;
  const visibleColumns = useMemo(() => columns.filter(c => c.visible), [columns]);
  return (
    <>
      <table>
        <colgroup>
          {showCheckbox && <col className={styles.CheckboxCol} />}
          {visibleColumns.map((col, i) => {
            const isLast = i === visibleColumns.length - 1;
            return (
              <col
                key={col.identifier + (isLast ? '-last' : '')}
                style={{
                  width: (isLast ? 'auto' : col.width),
                  minWidth: col.minWidth ?? '150px',
                }}
              />
            );
          })}
        </colgroup>
        <TableHeader />
        <TableBody />
        <TableFooter />
      </table>
    </>
  );
});
TableArea.displayName = 'TableArea';
