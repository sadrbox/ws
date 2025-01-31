import React, { useEffect, useState, FC, Dispatch, SetStateAction, useRef, useLayoutEffect } from 'react'
import styles from "../styles.module.scss"
// import { PiDotsThreeCircleLight } from "react-icons/pi";
// import { IoReloadCircleOutline } from "react-icons/io5";
// import { IoEllipsisHorizontalCircle } from "react-icons/io5";
// import { useContextTodo } from 'src/objects/Todos/Context';
// import DataGridHead from './DataGridHead';
// import DataGridHead from './DataGridBody';
import ContextWrapper, { TContextData, } from './DataGridContextProvider';
import { TModelParams } from '../types';
// import GridColumnsSetting from './GridSetting';
import DataGridTabHeader from './DataGridHeader';
import DataGridTabBody from './DataGridBody';
import { TSorting } from '../types';
import { sortGridRows } from '../services';
// import { columns } from '../../../objects/Products/config';
// import GridSetting from '../GridSetting';
// import { createPortal } from 'react-dom';
// import { useAppContext } from 'src/components/app/AppContext';
// import { TTabs } from '../../Tabs/types';

import imgCreateElement from 'src/assets/create-element.png'
import imgDeleteElement from 'src/assets/delete-element.png'
import imgReloadData from 'src/assets/reload-data.png'
import imgFilter from 'src/assets/filter.png'

type TProps = {
  params: TModelParams;
}


const DataGrid: FC<TProps> = ({ params: { columns, rows } }) => {

  return (
    <table>
      <DataGridTabHeader columns={columns} />
      <DataGridTabBody columns={columns} rows={rows} />
    </table>
  )

}
export default DataGrid;


