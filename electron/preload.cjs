// Bridge between the LightCast console page and the desktop app (no Node access in the page).
const { contextBridge, ipcRenderer, webFrame } = require('electron');

contextBridge.exposeInMainWorld('freecastDesktop', {
  info: () => ipcRenderer.invoke('desktop:info'),
  copyTeamLink: () => ipcRenderer.invoke('desktop:copyTeamLink'),
  copyRemoteCode: () => ipcRenderer.invoke('desktop:copyRemoteCode'),
  pptxToPdf: (bytes) => ipcRenderer.invoke('desktop:pptxToPdf', bytes),
  pptToPptx: (bytes) => ipcRenderer.invoke('desktop:pptToPptx', bytes),
  // Review › Spelling: the system / Chromium spell checker the text boxes already use.
  isMisspelled: (word) => webFrame.isWordMisspelled(String(word)),
  spellSuggestions: (word) => webFrame.getWordSuggestions(String(word)),
  // Paste: PowerPoint's own copy of shapes (exact places, fonts and colours), read by the main process.
  readOfficeClipboard: () => ipcRenderer.invoke('desktop:readOfficeClipboard'),
  openView: (url, displayId) => ipcRenderer.invoke('desktop:openView', url, displayId),
  present: (url) => ipcRenderer.invoke('desktop:present', url),
  endShow: () => ipcRenderer.invoke('desktop:endShow'),
  setOnTop: (on) => ipcRenderer.invoke('desktop:setOnTop', on),
  setAiConfig: (patch) => ipcRenderer.invoke('desktop:setAiConfig', patch),
  setNetworkRemote: (on) => ipcRenderer.invoke('desktop:setNetworkRemote', on),
  setInternetRemote: (on) => ipcRenderer.invoke('desktop:setInternetRemote', on),
  newRemoteLink: () => ipcRenderer.invoke('desktop:newRemoteLink'),
  closeOutputs: () => ipcRenderer.invoke('desktop:closeOutputs'),
  updateState: () => ipcRenderer.invoke('desktop:updateState'),
  checkUpdates: () => ipcRenderer.invoke('desktop:checkUpdates'),
  installUpdate: () => ipcRenderer.invoke('desktop:installUpdate'),
  onUpdate: (cb) => {
    const listener = (_e, st) => cb(st);
    ipcRenderer.on('desktop:update', listener);
    return () => ipcRenderer.removeListener('desktop:update', listener);
  },
  onDisplays: (cb) => {
    const listener = (_e, displays) => cb(displays);
    ipcRenderer.on('desktop:displays', listener);
    return () => ipcRenderer.removeListener('desktop:displays', listener);
  },
});
