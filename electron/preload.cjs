// The only bridge between the page and the desktop shell: saving or printing the document, and
// revealing a saved file. Nothing from Node is exposed to the renderer.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('bandbuilder', {
  desktop: true,
  savePdf: (suggestedName) => ipcRenderer.invoke('pdf:save', suggestedName),
  print: () => ipcRenderer.invoke('pdf:print'),
  reveal: (filePath) => ipcRenderer.invoke('shell:reveal', filePath),
  /** Fired by File > Save PDF in the application menu. */
  onSavePdfRequested: (handler) => {
    const listener = () => handler()
    ipcRenderer.on('menu:save-pdf', listener)
    return () => ipcRenderer.off('menu:save-pdf', listener)
  },
})
