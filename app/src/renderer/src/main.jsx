import React from 'react'
import { createRoot } from 'react-dom/client'
import Popup from './Popup'
import Settings from './Settings'

const isSettings = window.location.hash === '#settings'
if (isSettings) document.body.style.background = '#f7f5f0'

createRoot(document.getElementById('root')).render(isSettings ? <Settings /> : <Popup />)
