import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'src/App.css'
import App from './0App'
// import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  // <StrictMode>
  // <App />
  <App />
  // </StrictMode>,
)
