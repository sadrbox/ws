import { FC, useState } from 'react';
import styles from "../styles.module.scss"
import { useAppContext } from '../AppContextProvider';



const Navbar: FC = () => {

  const { context } = useAppContext();

  const openPane = context?.actions.openPane;

  return (
    <div className={styles.NavbarWrapper}>
      <a href="#" className={styles.NavbarItem} onClick={() => openPane('NavigationPage')}>
        Навигация
      </a>
      <a href="#" className={styles.NavbarItem} onClick={() => openPane('ActivityHistory')}>
        История активности
      </a>
      <a href="#" className={styles.NavbarItem} onClick={() => openPane('ContractFORM')}>
        Форма
      </a>
    </div>
  );
};

export default Navbar;