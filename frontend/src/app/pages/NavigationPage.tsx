import { FC, useState } from 'react';
import styles from './styles.module.scss';
import { useAppContextProps } from '../AppContextProvider';
import Organizations from 'src/models/Organizations';
import Counterparties from 'src/models/Counterparties';
import Contracts from 'src/models/Contracts';
// import { useAppContext } from '../AppContextProvider';


const NavigationPage: FC = () => {
  const context = useAppContextProps();
  const { openPane } = context?.actions



  return (
    <div className={styles.PageWrapper}>
      <h1 className={styles.PageTitle}>Навигация</h1>

      <h3>Документы</h3>
      <ul className={styles.PageList}>
        <li onClick={() => openPane(<Organizations />)}>Организации</li>
        <li onClick={() => openPane(<Counterparties />)}>Контрагенты</li>
        <li onClick={() => openPane(<Contracts />)}>Договора</li>
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

export default NavigationPage;