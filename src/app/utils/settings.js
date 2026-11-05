// User settings shown in the settings window, stored in the user config.json next to the
// app's other per-user state. Keys are dotted paths ("updates.autoCheck"); unset keys fall
// back to DEFAULTS. Listeners registered with onChange run after a value is saved.
//
// Add a key to DEFAULTS before using it: set() rejects unknown keys and values whose type
// doesn't match the default.
const fs = require('fs');

const DEFAULTS = {
    'general.closeToTray': false,
    'appearance.disabledUserstyles': [], // file names in the userstyles folder
    'appearance.useGtkTheme': true,      // Linux: titlebar and light/dark follow the GTK theme
    'badge.useSystemAccent': true,       // badge color follows the system accent color
    'updates.autoCheck': true,
    'updates.autoDownload': true,        // at startup: download, install and restart
    'updates.autoInstallOnQuit': true,
};

let configPath = null;
let config = {};
const listeners = new Map();

function init(path, userConfig) {
    configPath = path;
    config = userConfig;
}

function getPath(obj, key) {
    return key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function get(key) {
    const value = getPath(config, key);
    return value === undefined ? DEFAULTS[key] : value;
}

function getAll() {
    return Object.fromEntries(Object.keys(DEFAULTS).map((key) => [key, get(key)]));
}

function set(key, value) {
    if (!(key in DEFAULTS)) throw new Error(`Unknown setting: ${key}`);
    if (typeof value !== typeof DEFAULTS[key] || Array.isArray(value) !== Array.isArray(DEFAULTS[key])) {
        throw new Error(`Invalid value for ${key}`);
    }

    const parts = key.split('.');
    const parent = parts.slice(0, -1).reduce((o, k) => (o[k] = o[k] && typeof o[k] === 'object' ? o[k] : {}), config);
    parent[parts[parts.length - 1]] = value;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    for (const listener of listeners.get(key) || []) listener(value);
}

function onChange(key, listener) {
    if (!listeners.has(key)) listeners.set(key, []);
    listeners.get(key).push(listener);
}

module.exports = { DEFAULTS, init, get, getAll, set, onChange };
