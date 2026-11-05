const { contextBridge, ipcRenderer } = require("electron");

// Settings page API (see src/app/module/settings/index.js)
contextBridge.exposeInMainWorld("appSettings", {
    getAll: () => ipcRenderer.invoke("settings:get-all"),
    set: (key, value) => ipcRenderer.invoke("settings:set", key, value),
    info: () => ipcRenderer.invoke("settings:info"),
    checkForUpdates: () => ipcRenderer.invoke("settings:check-updates"),
    openExternal: (url) => ipcRenderer.invoke("settings:open-external", url),
    windowAction: (action) => ipcRenderer.send("settings:window", action),
    userstyles: {
        list: () => ipcRenderer.invoke("userstyles:list"),
        setEnabled: (file, enabled) => ipcRenderer.invoke("userstyles:set-enabled", file, enabled),
        add: () => ipcRenderer.invoke("userstyles:add"),
        remove: (file) => ipcRenderer.invoke("userstyles:remove", file),
        openFolder: () => ipcRenderer.invoke("userstyles:open-folder"),
    },
});
