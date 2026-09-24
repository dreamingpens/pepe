const { contextBridge, ipcRenderer, webUtils } = require('electron')

contextBridge.exposeInMainWorld('pepe', {
  platform: process.platform,
  invoke: (method, data) => ipcRenderer.invoke('pepe:invoke', method, data),
  openFile: (file) => ipcRenderer.invoke('pepe:open-file', webUtils.getPathForFile(file)),
  onEvent(callback) {
    const listener = (_event, value) => callback(value)
    ipcRenderer.on('pepe:event', listener)
    return () => ipcRenderer.removeListener('pepe:event', listener)
  },
  onCommand(callback) {
    const listener = (_event, command) => callback(command)
    ipcRenderer.on('reader:command', listener)
    return () => ipcRenderer.removeListener('reader:command', listener)
  },
})
