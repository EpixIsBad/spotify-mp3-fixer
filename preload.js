const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  scanFolder: (folderPath) => ipcRenderer.invoke('scan-folder', folderPath),
  onScanFile: (callback) => ipcRenderer.on('scan-file', (event, data) => callback(data)),
  onScanFileUpdated: (callback) => ipcRenderer.on('scan-file-updated', (event, data) => callback(data)),
  onScanStarted: (callback) => ipcRenderer.on('scan-started', (event, data) => callback(data)),
  onScanComplete: (callback) => ipcRenderer.on('scan-complete', () => callback()),
  getAlbumArt: (filePath) => ipcRenderer.invoke('get-album-art', filePath),
  fixFiles: (options) => ipcRenderer.invoke('fix-files', options),
  openFolder: (folderPath) => ipcRenderer.invoke('open-folder', folderPath),
  onProgress: (callback) => ipcRenderer.on('progress', (event, data) => callback(data)),
  // Window controls
  windowMinimize: () => ipcRenderer.invoke('window-minimize'),
  windowMaximize: () => ipcRenderer.invoke('window-maximize'),
  windowClose: () => ipcRenderer.invoke('window-close')
});
