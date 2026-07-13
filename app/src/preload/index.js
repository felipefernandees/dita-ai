import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('dita', {
  onCommand(cb) {
    for (const ch of ['rec:start', 'rec:stop', 'rec:cancel', 'rec:phase', 'rec:result']) {
      ipcRenderer.on(ch, (_e, payload) => cb(ch, payload))
    }
  },
  sendAudio(buf) { ipcRenderer.send('rec:audio', buf) },
  copyText(t) { ipcRenderer.send('rec:copy', t) },
  closePopup() { ipcRenderer.send('rec:close') },
  getSettings() { return ipcRenderer.invoke('settings:get-all') },
  setSetting(key, value) { return ipcRenderer.invoke('settings:set', key, value) }
})
