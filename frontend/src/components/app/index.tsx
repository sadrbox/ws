import React, { useEffect, useState } from 'react'
import Tabs from '../ui/Tabs'
import AppContext, { TContextParams } from './AppContext'

import { TContextInstance } from "./AppContext"
import Products from 'src/models/Products'
import { isArray } from 'lodash'
import { TTabs } from '../ui/Tabs/types';
import { getMockTabs } from '../ui/Tabs/dev'


export const App = () => {
  const [context, setContext] = useState<TContextParams>(null)
  const [tabs, setTabs] = useState<TTabs[]>([])

  useEffect(() => { setContext({ tabs }) }, [tabs])

  // useEffect(() => {
  //   const fetchDataTabs = async () => {
  //     try {
  //       const dataTabs = await getMockTabs();
  //       setTabs(dataTabs)
  //     }
  //     catch (e) {
  //       console.log(e)
  //     }
  //   }

  //   fetchDataTabs();
  // }, [])

  // const state: TContextInstance = {
  //   context, setContext
  // }

  function addNewTabItem() {

    const newTab = {
      id: '29384uhf23',
      label: 'Frollo',
      active: true,
      description: 'jsdfkjasdf'
    }

    // setContext((prev) => {
    //   const tabs: TTabs[] = (isArray(prev?.tabs) ? prev?.tabs : []);
    //   return { tabs: [newTab, ...tabs] }
    // })
    setTabs((prev) => (isArray(prev) ? [...prev, newTab] : []))
  }

  return (
    <>
      <AppContext state={{ context, setContext }}>
        <button type="button" onClick={() => addNewTabItem()}>Добавить вкладку</button>
        <Tabs />
        <br></br>
        <div style={{ margin: "5px" }}>
          <Products />
        </div>
      </AppContext>
    </>
  )
}