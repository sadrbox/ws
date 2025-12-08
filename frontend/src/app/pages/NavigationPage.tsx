import { Dispatch, FC, SetStateAction, useId } from 'react';
import styles from './styles.module.scss';
import { useAppContextProps } from '../AppContextProvider';
import ListContracts from 'src/models/contracts/list';
import ListActivityHistories from 'src/models/activityhistories/list';
import ListOrganizations from 'src/models/organizations/list';
import ListCounterparties from 'src/models/counterparties/list';
import { Group } from '../../components/UI/index';



export const NavigationPage: FC = () => {
  const context = useAppContextProps();
  const { addPane } = context?.actions;


  return (

    <div className={styles.PageWrapper}>
      <h1 className={styles.PageTitle}>Навигация</h1>
      <h3>Документы</h3>
      <ul className={styles.PageList}>
        <li onClick={() => addPane(<ListOrganizations />)}>Организации</li>
        <li onClick={() => addPane(<ListCounterparties />)}>Контрагенты</li>
        <li onClick={() => addPane(<ListContracts />)}>Договора</li>
        <li onClick={() => addPane(<ListActivityHistories />)}>История активности</li>
        <li>Реализация товара и услуг</li>
        <li>Поступление товара и услуг</li>
        <li>Перемещение ТМЗ</li>
        <li>Приходный кассовый ордер</li>
        <li>Расходный кассовый ордер</li>
      </ul>

      <h3>Касса</h3>
      <ul className={styles.PageList}>
        <li>Приходный кассовый ордер</li>
        <li>Расходный кассовый ордер</li>
      </ul>
    </div >
  );
};

