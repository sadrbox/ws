import { FC } from 'react';
import styles from "./Field.module.scss"
import { useFieldDirty } from "src/hooks/useDirtyHighlight"


type TProps = {
  label: string
  name: string
}

const InputField: FC<TProps> = ({ label, name }) => {
  const dirty = useFieldDirty(name);

  return (
    <div className={[styles.rowGroup, styles.FieldWrapper].filter(s => s && s).join(" ")} {...dirty}>
      <label htmlFor={name} className={styles.FieldLabel}>{label}</label>
      <div className={styles.FieldInputWrapper}>
        <input type="text" name={name} id={name} className={styles.FieldString} autoComplete='off' />
      </div>
    </div>
  );
};

export default InputField;