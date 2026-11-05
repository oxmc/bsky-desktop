// Settings window (src/ui/settings.html). Values live in utils/settings.js; this module
// owns the window and the IPC the page uses.
//
// Frameless with rounded corners everywhere: the page lives in a WebContentsView with a
// border radius inside a transparent window (Linux; Windows 11 and macOS round frameless
// windows themselves). The page draws its own close button.
const { app, BrowserWindow, WebContentsView, ipcMain, shell } = require('electron');
const path = require('path');
const settings = require('../../utils/settings');

const CORNER_RADIUS = 12;
const uiDir = path.join(__dirname, '..', '..', '..', 'ui');

let settingsWindow = null;
let settingsView = null;
let getInfo = () => ({});
let checkForUpdates = async () => ({ code: 'check-failed' });

// info(): extra read-only details for the About/Updates pages
// onCheckForUpdates(): runs an update check, resolves to the updater's result code
function initSettingsWindow({ info, onCheckForUpdates }) {
    getInfo = info;
    checkForUpdates = onCheckForUpdates;

    ipcMain.handle('settings:get-all', () => settings.getAll());
    ipcMain.handle('settings:set', (event, key, value) => settings.set(key, value));
    ipcMain.handle('settings:info', () => ({
        name: app.getName(),
        version: app.getVersion(),
        electron: process.versions.electron,
        chrome: process.versions.chrome,
        platform: process.platform,
        ...getInfo(),
    }));
    ipcMain.handle('settings:check-updates', () => checkForUpdates());
    ipcMain.handle('settings:open-external', (event, url) => {
        if (/^https?:\/\//.test(url)) shell.openExternal(url);
    });
    ipcMain.on('settings:window', (event, action) => {
        if (!settingsWindow || event.sender !== settingsView?.webContents) return;
        if (action === 'close') settingsWindow.close();
    });
}

function openSettingsWindow(parent) {
    if (settingsWindow) {
        settingsWindow.show();
        settingsWindow.focus();
        return settingsWindow;
    }

    const isLinux = process.platform === 'linux';
    settingsWindow = new BrowserWindow({
        width: 780,
        height: 560,
        minWidth: 640,
        minHeight: 420,
        parent,
        show: false,
        title: 'Settings',
        frame: false,
        ...(isLinux ? { transparent: true, backgroundColor: '#00000000' } : {}),
        icon: path.join(uiDir, 'img', 'logo.png'),
    });
    settingsWindow.removeMenu();

    settingsView = new WebContentsView({
        webPreferences: {
            preload: path.join(uiDir, 'preload-settings.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
        },
    });
    settingsWindow.contentView.addChildView(settingsView);

    const layout = () => {
        const { width, height } = settingsWindow.getContentBounds();
        settingsView.setBounds({ x: 0, y: 0, width, height });
        const square = settingsWindow.isMaximized() || settingsWindow.isFullScreen();
        if (isLinux) settingsView.setBorderRadius(square ? 0 : CORNER_RADIUS);
    };
    settingsWindow.on('resize', layout);
    settingsWindow.on('maximize', layout);
    settingsWindow.on('unmaximize', layout);
    layout();

    settingsView.webContents.loadFile(path.join(uiDir, 'settings.html'), { query: { platform: process.platform } });
    settingsView.webContents.once('did-finish-load', () => settingsWindow?.show());
    settingsWindow.on('closed', () => {
        settingsView.webContents.close();
        settingsWindow = null;
        settingsView = null;
    });
    return settingsWindow;
}

// Pushes an update to the settings page, if it is open
function sendToSettings(channel, ...args) {
    if (settingsView && !settingsView.webContents.isDestroyed()) settingsView.webContents.send(channel, ...args);
}

// True when webContents is the settings page (for IPC that only it may use)
function isSettingsSender(webContents) {
    return !!settingsView && !settingsView.webContents.isDestroyed() && webContents === settingsView.webContents;
}

module.exports = { initSettingsWindow, openSettingsWindow, sendToSettings, isSettingsSender };
