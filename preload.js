const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  googleSearch: (phrase, version) => ipcRenderer.invoke('google-search', { phrase, version }),
  openVoiceBridge: () => ipcRenderer.send('open-voice-bridge'),
  openExternal: (url) => ipcRenderer.send('open-external', url),
  onVoiceBridgeTranscript: (callback) => {
    ipcRenderer.removeAllListeners('voice-bridge-transcript');
    ipcRenderer.on('voice-bridge-transcript', (event, data) => callback(data));
  },
  onVoiceBridgeState: (callback) => {
    ipcRenderer.removeAllListeners('voice-bridge-state');
    ipcRenderer.on('voice-bridge-state', (event, data) => callback(data));
  },
  setAlwaysOnTop: (flag) => ipcRenderer.send('set-always-on-top', flag),
  toggleCompactSize: (isCompact) => ipcRenderer.send('toggle-compact-size', isCompact),
  minimizeWindow: () => ipcRenderer.send('window-minimize'),
  maximizeWindow: () => ipcRenderer.send('window-maximize'),
  closeWindow: () => ipcRenderer.send('window-close'),
  generateAIContent: (prompt) => ipcRenderer.invoke('generate-ai-content', { prompt }),
  onFocusSearch: (callback) => {
    ipcRenderer.removeAllListeners('focus-search');
    ipcRenderer.on('focus-search', () => callback());
  },
  onWindowFocus: (callback) => {
    ipcRenderer.removeAllListeners('window-focus');
    ipcRenderer.on('window-focus', () => callback());
  },
  onWindowBlur: (callback) => {
    ipcRenderer.removeAllListeners('window-blur');
    ipcRenderer.on('window-blur', () => callback());
  },
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  checkForUpdates: (manual = true) => ipcRenderer.invoke('check-for-updates', manual),
  downloadUpdate: (url) => ipcRenderer.invoke('download-update', url),
  installUpdate: (silent = true) => ipcRenderer.invoke('install-update', silent),
  getUpdateSettings: () => ipcRenderer.invoke('get-update-settings'),
  saveUpdateSettings: (settings) => ipcRenderer.invoke('save-update-settings', settings),
  onUpdateStatus: (callback) => {
    ipcRenderer.removeAllListeners('update-status');
    ipcRenderer.on('update-status', (event, data) => callback(data));
  }
});
