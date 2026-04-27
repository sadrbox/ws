import { CSSProperties, FC, PropsWithChildren } from "react";
import styles from "src/styles/main.module.scss";

type TypeGroupProps = {
  style?: CSSProperties;
} & PropsWithChildren;

export const Group: FC<TypeGroupProps> = ({ style, children }) =>
  <div style={style} className={[styles.Group, styles.gap12].filter(Boolean).join(" ")}>{children}</div>;

export const GroupRow: FC<TypeGroupProps> = ({ style, children }) =>
  <div style={style} className={[styles.GroupRow, styles.gap12].filter(Boolean).join(" ")}>{children}</div>;

export const GroupCol: FC<TypeGroupProps> = ({ style, children }) =>
  <div style={style} className={[styles.GroupCol, styles.gap12].filter(Boolean).join(" ")}>{children}</div>;
