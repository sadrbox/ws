// import './App.css'
import { useState } from 'react'
import PrintPageViewer from './components/ui/PrintPageViewer'
// import A4Page from './components/ui/PrintPageViewer'
import ActivityHistory from './models/ActivityHistory'
import ActivityHistoryView from './models/ActivityHistory/view'
import AppContext, { TAppContextData } from './components/app/AppContext'
// import Products from './objects/Products'

function App() {

  // const [contextState, setContextState] = useState<TAppContextData | undefined>(undefined);

  return (
    // <AppContext state={undefined}>
    <>
      <ActivityHistory />
      {/* <div>
          <PrintPageViewer>
            <ActivityHistoryView id={195} />
          </PrintPageViewer>
        </div> */}
    </>
    // </AppContext>
  )
}

export default App
