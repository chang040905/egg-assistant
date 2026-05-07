const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  loadConversations: () => ipcRenderer.invoke('load-conversations'),
  saveConversations: (data) => ipcRenderer.invoke('save-conversations', data),
  loadModels: () => ipcRenderer.invoke('load-models'),
  saveModels: (data) => ipcRenderer.invoke('save-models', data),
  loadSettings: () => ipcRenderer.invoke('load-settings'),
  saveSettings: (data) => ipcRenderer.invoke('save-settings', data),
  windowMinimize: () => ipcRenderer.invoke('window-minimize'),
  windowMaximize: () => ipcRenderer.invoke('window-maximize'),
  windowClose: () => ipcRenderer.invoke('window-close'),
  windowIsMaximized: () => ipcRenderer.invoke('window-is-maximized'),
  // 拖拽
  dragStart: (pos) => ipcRenderer.invoke('drag-start', pos),
  dragMove: (pos) => ipcRenderer.invoke('drag-move', pos),
  dragEnd: () => ipcRenderer.invoke('drag-end'),
});
