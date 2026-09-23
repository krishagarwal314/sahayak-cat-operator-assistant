import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { LanguageProvider } from './lib/i18n'
import { SessionProvider } from './lib/session'
import './styles/index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <LanguageProvider>
        <SessionProvider>
          <App />
        </SessionProvider>
      </LanguageProvider>
    </BrowserRouter>
  </React.StrictMode>,
)
