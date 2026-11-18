import { contextBridge, ipcRenderer } from "electron";

/**
 * The one thing the app's page may ask the desktop app for: let the person choose a folder. It returns only the path
 * they picked (or null). No other Node or Electron feature reaches the page.
 */
contextBridge.exposeInMainWorld("argusDesktop", {
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke("argus:pick-folder"),
});
