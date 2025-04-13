import { FC, PropsWithChildren, useState } from 'react';
import styles from "./styles/styles.module.scss"


export const GroupBox: FC<{ align: 'row' | 'col'; gap?: string } & PropsWithChildren> = ({ align, gap, children }) => {

  return (
    <div className={align === 'row' ? styles.GroupBoxRow : styles.GroupBoxColumn} style={gap ? { gap: gap } : undefined}>
      {children}
    </div >
  );
};

export const GroupBoxRow: FC<{ gap?: string } & PropsWithChildren> = ({ gap, children }) => {

  return (
    <div className={styles.RowGroup} style={gap ? { gap: gap } : undefined}>
      {children}
    </div >
  );
};
export const GroupBoxCol: FC<{ gap?: string } & PropsWithChildren> = ({ gap, children }) => {

  return (
    <div className={styles.ColGroup} style={gap ? { gap: gap } : undefined}>
      {children}
    </div >
  );
};
