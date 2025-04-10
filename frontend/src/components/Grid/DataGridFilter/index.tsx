import { FC, useRef, useEffect, useState } from 'react';
import styles from './styles.module.scss';
import ModalWrapper from '../../Modal/ModalWrapper';
import FieldString from '../../Field/FieldString';
import FieldSelect from '../../Field/FieldSelect';
import { useAppContext } from 'src/components/app/AppContextProvider';

type ModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

const DataGridFilter: FC<ModalProps> = ({ isOpen, onClose }) => {


  return (
    <ModalWrapper isOpen={isOpen} onClose={onClose} title="Настройки фильтра" onSubmit={(values) => console.log('Фильтры:', values)}>
      <div className={styles.rowGroup}>
        <FieldString label="Название" name="name" />
        <FieldString label="Название" name="name" />
        <FieldString label="Название" name="name" />
        <FieldString label="Название" name="name" />
        <FieldSelect label="Тип" name="type" options={[{ value: 'string', label: 'Строка' }, { value: 'number', label: 'Число' }, { value: 'date', label: 'Дата' }]} />
      </div>

    </ModalWrapper >
  );
};

export default DataGridFilter;
