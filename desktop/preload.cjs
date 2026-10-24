const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('prosotaDesktop', {
  identity: () => ipcRenderer.invoke('desktop:identity'),
  signOut: () => ipcRenderer.invoke('desktop:logout'),
  openSettings: () => ipcRenderer.invoke('desktop:open-settings'),
  backup: () => ipcRenderer.invoke('desktop:backup'),
  restore: () => ipcRenderer.invoke('desktop:restore'),
  openPowerBI: (name, bytes) => ipcRenderer.invoke('desktop:powerbi', name, bytes),
  readSettings: () => ipcRenderer.invoke('desktop:settings'),
  saveSettings: value => ipcRenderer.invoke('desktop:save-settings', value),
})
