import { useState, FC, useLayoutEffect, useRef } from 'react';
// import { TGridParams } from './types';
import DataGrid from './DataGrid/index_2';
import styles from "./styles.module.scss"
import GridSetting from './ConfigGrid';

import ContextWrapper, { TContextData, } from './DataGrid/DataGridContextProvider';
// import GridColumnsSetting from './GridSetting';
import DataGridTabHeader from './DataGrid/DataGridHeader';
import DataGridTabBody from './DataGrid/DataGridBody';
import { TOrder } from './types';
import { sortGridRows } from './services';
// import { columns } from '../../../objects/Products/config';
// import GridSetting from '../GridSetting';
// import { createPortal } from 'react-dom';
// import { useAppContext } from 'src/components/app/AppContext';
// import { TTabs } from '../../Tabs/types';

import imgCreateElement from 'src/assets/create-element.png'
import imgDeleteElement from 'src/assets/delete-element.png'
import imgReloadData from 'src/assets/reload-data.png'
import imgFilter from 'src/assets/filter.png'
import { TModelParams } from './types';

type TProps = {
  params: TModelParams
  actions: {
    loadDataGrid: () => void;
  }
}
const Grid: FC<TProps> = ({ params: { rows, columns, initOrder }, params, actions: { loadDataGrid } }) => {


  const [contextDataGrid, setContextDataGrid] = useState<TContextData | undefined>(undefined);
  // const [sortedDataGrid, setSortedDataGrid] = useState<TDataItem[] | undefined>(undefined);
  const [checkedRows, setCheckedRows] = useState<number[]>([])
  const [isAllChecked, setIsAllChecked] = useState<boolean>(false)
  const [activeRow, setActiveRow] = useState<number | null>(null)
  const [sortingRows, seTOrderRows] = useState<TOrder>({
    columnID: (initOrder?.columnID || 'id'),
    direction: (initOrder?.direction || 'asc')
  });

  const [activeWindow, setActiveWindow] = useState<string>('')

  useLayoutEffect(() => {
    if (rows?.length) {
      // const dataGrid = rows;
      const dataGrid = sortGridRows(rows, sortingRows?.columnID, sortingRows?.direction) || [];
      const IDs = dataGrid.map(row => row.id as number) || []; // это надо ?
      setContextDataGrid({
        rows: dataGrid,
        columns,
        IDs,
        actions: {
          loadDataGrid,
        },
        states: {
          activeRow, setActiveRow,
          sortingRows, seTOrderRows,
          checkedRows, setCheckedRows,
          isAllChecked, setIsAllChecked
        }
      })
    } else {
      setContextDataGrid(undefined)
    }
  }, [sortingRows, checkedRows, activeRow, isAllChecked]);

  /////////////////////////////////////////////////////////

  useLayoutEffect(() => {
    if (rows) {
      const IDs = rows.map(row => row.id as number) || []
      if (isAllChecked) {
        setCheckedRows(IDs)
      } else {

        if (checkedRows.length < IDs.length) {
          setCheckedRows((prev) => [...prev])
        } else {
          setCheckedRows([])
        }
      }
    }
  }, [isAllChecked])

  /////////////////////////////////////////////////////////

  useLayoutEffect(() => {
    if (rows) {
      const IDs = rows.map(row => row.id as number) || []

      if (checkedRows.length === IDs.length) {
        // console.log({ checkedRows, IDs })
        setIsAllChecked(true)
        // setCheckedRows((prev) => [...prev])
      } else {
        setIsAllChecked(false)
      }
    }
  }, [checkedRows])

  /////////////////////////////////////////////////////////

  const scrollGridSrollWrapper = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (scrollGridSrollWrapper.current) {
      scrollGridSrollWrapper.current.scrollTo({
        top: scrollGridSrollWrapper.current.scrollHeight,
        behavior: 'instant'
      })
    }
  }, [])

  return (
    <ContextWrapper contextDataGrid={contextDataGrid}>
      <div className={styles.GridWrapper}>
        <div className={styles.TabHeader}>
          <div className={styles.colGroup} style={{ justifyContent: 'left', gap: '5px' }}>
            <div style={{ fontSize: '15px', fontWeight: '600', background: 'none', padding: '4px 4px 4px 4px', borderRadius: '2px' }}>История активности пользователей</div>
          </div>
          <div className={styles.colGroup} style={{ justifyContent: 'right', gap: '5px' }}>
            <button className={[styles.Button].join(' ')} onClick={() => setActiveWindow('GridSetting')}>
              <div className={styles.ImgSetting}></div>
            </button>
          </div>
        </div>
        <div className={styles.GridPanel}>
          <div className={styles.colGroup} style={{ justifyContent: 'left', gap: '5px' }}>
            <button className={styles.Button}>
              <img src={imgCreateElement} /><span>Добавить</span></button>
            <button className={styles.Button}>
              <img src={imgDeleteElement} /> <span>Удалить</span></button>
          </div>
          <div className={styles.colGroup} style={{ justifyContent: 'right', gap: '5px' }}>
            <button onClick={() => loadDataGrid()} className={[styles.Button].join(' ')}>
              <img src={imgReloadData} />
              <span>Обновить</span>
            </button>
            <button className={[styles.Button].join(' ')}>
              <img src={imgFilter} />
            </button>
          </div>
        </div>
        <div ref={scrollGridSrollWrapper} className={styles.GridSrollWrapper}>
          {!activeWindow || activeWindow === 'DataGrid' ? <DataGrid params={params} /> : <GridSetting params={params} actions={{ loadDataGrid }} />}
        </div>
      </div>
    </ContextWrapper >
  );
};

export default Grid;
/*
***Панель управления таблицы будет в этом компоненте, а область будет отображать таблицу, настройти, Отбор и другие элементы формы
--- Панель упаравления
  - Команды
    - Обновить
    - Отбор
    - Настройки
    - 
 
*/