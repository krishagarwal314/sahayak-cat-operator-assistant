import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { LanguageProvider } from './lib/i18n'
import { SessionProvider } from './lib/session'
import { SpeechProvider } from './lib/speechContext'
import './styles/index.css'
import { installAudioUnlock } from './lib/audio'

installAudioUnlock()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <LanguageProvider>
        <SessionProvider>
          <SpeechProvider>
            <App />
          </SpeechProvider>
        </SessionProvider>
      </LanguageProvider>
    </BrowserRouter>
  </React.StrictMode>,
)
