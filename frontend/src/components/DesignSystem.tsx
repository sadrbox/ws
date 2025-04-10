import { FC, PropsWithChildren, useState } from 'react';
import

type TypeGroupBox = {
  align: 'row' | 'col';
  gap ?: string;
}

export const GroupBox: PropsWithChildren<TypeGroupBox> = ({ align, gap, children }) => {


  return (
    <div className={styles.colGroup}>
      {children}
    </div>
  );
};
