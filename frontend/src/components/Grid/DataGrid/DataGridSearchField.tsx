import { forwardRef, InputHTMLAttributes } from 'react';
import styles from "../styles.module.scss";

type TProps = {
  name: string;
} & InputHTMLAttributes<HTMLInputElement>;

const DataGridSearchField = forwardRef<HTMLInputElement, TProps>(({ name, style }, ref) => (
  <input type="text" name={name} ref={ref} className={styles.FieldSearch} style={style} />
));

export default DataGridSearchField;