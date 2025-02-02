import { useState, FC } from 'react';
import { EActiveGrid, TModelProps } from './types';
import DataGrid from './DataGrid/index';
import styles from './styles.module.scss';
// import DataGridContextProvider from './DataGrid/DataGridContextProvider';
import { SlSettings } from "react-icons/sl";
import { TbFilter } from "react-icons/tb";
import DataGridSettings from './DataGridSettings';
// import DataGridSettings from './DataGridSettings/index';

type TProps = {
  props: TModelProps;
};

const Grid: FC<TProps> = ({ props }) => {
  const [activeGrid, setActiveGrid] = useState<EActiveGrid>(EActiveGrid.DATA);



  // Переключение между режимами
  const toggleActiveGrid = () => {
    setActiveGrid((prev) => (prev === EActiveGrid.DATA ? EActiveGrid.CONFIG : EActiveGrid.DATA));
  };

  const onClickButtonDataGridFilter = (e: React.UIEvent<HTMLButtonElement>) => {
    e.preventDefault();
    // Логика фильтрации
  };

  return (
    <div className={styles.GridWrapper}>
      <div className={styles.GridPanel}>
        <div className={styles.colGroup} style={{ justifyContent: 'right', gap: '6px' }}>
          <button onClick={toggleActiveGrid} className={styles.Button}>
            <SlSettings size={17} strokeWidth={5} />
          </button>
          <button onClick={onClickButtonDataGridFilter} className={styles.Button}>
            <TbFilter size={17} strokeWidth={1} />
          </button>
        </div>
      </div>
      <hr />
      {activeGrid === EActiveGrid.DATA && <DataGrid props={props} />}
      {activeGrid === EActiveGrid.CONFIG && <DataGridSettings />}
    </div>
  );
};

export default Grid;
