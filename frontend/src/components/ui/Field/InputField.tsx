import { FC, useState } from 'react';
import styles from "./styles.module.scss"


type TProps = {
  label: string
  name: string
}

const InputField: FC<TProps> = ({ label, name }) => {

  return (
    <div className={[styles.rowGroup, styles.FieldWrapper].filter(s => s && s).join(" ")}>
      <label htmlFor={name} className={styles.FieldLabel}>{label}</label>
      <input type="text" name={name} id={name} className={styles.FieldString} autoComplete='off' />
    </div>
  );
};

export default InputField;