import { useState, FC, useEffect, useCallback } from 'react';
import { EActiveGrid, TModelProps } from './types';
import DataGrid from './DataGrid/index';
import styles from './styles.module.scss';
import { SlSettings } from "react-icons/sl";
import { TbFilter } from "react-icons/tb";
import DataGridSettings from './DataGridSettings';
import DataGridFilter from './DataGridFilter';

type TProps = {
  props: TModelProps;
};

const Grid: FC<TProps> = ({ props }) => {
  const [activeGrid, setActiveGrid] = useState<EActiveGrid>(EActiveGrid.DATA);
  const { loadDataGrid } = props.actions;
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Загрузка данных при переключении на режим DATA
  useEffect(() => {
    if (activeGrid === EActiveGrid.DATA) {
      loadDataGrid();
    }
  }, [activeGrid]);

  // Переключение между режимами
  const toggleActiveGrid = useCallback(() => {
    setActiveGrid((prev) => (prev === EActiveGrid.DATA ? EActiveGrid.CONFIG : EActiveGrid.DATA));
  }, []);

  // Обработчик клика по кнопке фильтра
  const onClickButtonDataGridFilter = useCallback((e: React.UIEvent<HTMLButtonElement>) => {
    e.preventDefault();
    // Логика фильтрации
    setIsModalOpen(true);
  }, []);

  return (
    <div className={styles.GridWrapper}>
      <div className={styles.GridPanel}>
        <div className={styles.colGroup}>
          {/* Левая часть панели (можно добавить элементы) */}
        </div>
        <div className={styles.colGroup}>
          <button onClick={toggleActiveGrid} className={styles.Button}>
            <SlSettings size={16} strokeWidth={5} />
          </button>
          <button onClick={onClickButtonDataGridFilter} className={styles.Button}>
            <TbFilter size={17} strokeWidth={2} />
          </button>
        </div>
      </div>
      {activeGrid === EActiveGrid.DATA && <DataGrid props={props} />}
      {activeGrid === EActiveGrid.CONFIG && <DataGridSettings props={props} />}
      <DataGridFilter isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />
    </div>
  );
};

export default Grid;