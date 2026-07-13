import React from 'react'
import { createRoot } from 'react-dom/client'
import './fonts.css'
import Popup from './Popup'
import Settings from './Settings'

const isSettings = window.location.hash === '#settings'
if (isSettings) document.body.style.background = '#16121F'

createRoot(document.getElementById('root')).render(isSettings ? <Settings /> : <Popup />)
