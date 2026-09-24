const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('pepe', {
  platform: process.platform,
  onCommand(callback) {
    const listener = (_event, command) => callback(command)
    ipcRenderer.on('reader:command', listener)
    return () => ipcRenderer.removeListener('reader:command', listener)
  },
})
