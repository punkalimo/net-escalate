import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import InterfaceHealthCenter from './components/InterfaceHealthCenter.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
    <InterfaceHealthCenter />
  </StrictMode>,
)
