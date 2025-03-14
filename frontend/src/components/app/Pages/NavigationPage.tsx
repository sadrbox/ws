import { FC, useState } from 'react';
import styles from './styles.module.scss';
import { useAppContext } from '../AppContextProvider';


const NavigationPage: FC = () => {
  const { context } = useAppContext();
  const { openPane } = context?.actions



  return (
    <div className={styles.PageWrapper}>
      <h1 className={styles.PageTitle}>Навигация</h1>

      <h3>Документы</h3>
      <ul className={styles.PageList}>
        <li onClick={() => openPane('Contracts')}>Договора</li>
        <li onClick={() => openPane('Sales')}>Реализация товара и услуг</li>
        <li onClick={(() => openPane('Receipts'))}>Поступление товара и услуг</li>
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