import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('dita', {
  onCommand(cb) {
    for (const ch of ['rec:start', 'rec:stop', 'rec:cancel', 'rec:phase', 'rec:result', 'rec:cancelled', 'rec:closing', 'rt:texto', 'rt:erro']) {
      ipcRenderer.on(ch, (_e, payload) => cb(ch, payload))
    }
  },
  sendAudio(buf) { ipcRenderer.send('rec:audio', buf) },
  // PCM16 16kHz mono, mandado ENQUANTO o usuário fala (motor Gemini).
  // Canal separado do sendAudio de propósito: aquele é o webm inteiro, no fim.
  sendRealtimeAudio(buf) { ipcRenderer.send('rt:audio', buf) },
  copyText(t) { ipcRenderer.send('rec:copy', t) },
  closePopup() { ipcRenderer.send('rec:close') },
  undo() { ipcRenderer.send('rec:undo') },
  finish() { ipcRenderer.send('rec:finish') },
  cancelHard() { ipcRenderer.send('rec:cancel-hard') },
  getSettings() { return ipcRenderer.invoke('settings:get-all') },
  setSetting(key, value) { return ipcRenderer.invoke('settings:set', key, value) },
  listHistory() { return ipcRenderer.invoke('history:list') },
  motorEstado() { return ipcRenderer.invoke('motor:estado') },
  motorSetEngine(engine) { return ipcRenderer.invoke('motor:set-engine', engine) },
  motorSetChave(chave) { return ipcRenderer.invoke('motor:set-chave', chave) },
  motorLimparChave() { return ipcRenderer.invoke('motor:limpar-chave') }
})
