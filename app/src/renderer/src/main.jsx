import React from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/figtree'
import '@fontsource-variable/eb-garamond'
import './tema.css'
import Popup from './Popup'
import Settings from './Settings'

const isSettings = window.location.hash === '#settings'
if (isSettings) document.body.style.background = 'var(--fundo)'

createRoot(document.getElementById('root')).render(isSettings ? <Settings /> : <Popup />)
