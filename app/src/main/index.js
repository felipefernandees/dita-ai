import { app, systemPreferences, ipcMain } from 'electron'
import { createRecorderWindow } from './recorder-window.js'

// Wiring temporário da Task 6: auto-dispara uma gravação de 3s pra validar
// captura de áudio + waveform. Substituído pelo pipeline real na Task 8.
let rec = null

app.whenReady().then(async () => {
  const mic = await systemPreferences.askForMediaAccess('microphone')
  console.log('mic access:', mic)
  rec = createRecorderWindow()
  ipcMain.on('rec:close', () => rec.hide())
  ipcMain.on('rec:audio', (_e, buf) => console.log('audio bytes:', buf.byteLength))
  setTimeout(() => {
    rec.show()
    rec.send('rec:start')
    setTimeout(() => { rec.send('rec:stop'); setTimeout(() => rec.hide(), 1500) }, 3000)
  }, 2500)
})
app.on('window-all-closed', () => {})
