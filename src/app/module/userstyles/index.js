// Userstyles (UserCSS .css files in the user's userstyles folder) applied to the main
// page (config.urls.main). The compiled CSS is sent to the page preload (src/ui/preload.js),
// which keeps it in a <style> after every other stylesheet - like the Stylus extension,
// which most userstyles are written for; insertCSS would order it before the page's own CSS. Sent on every page load and again whenever one is added, removed or toggled.
const { BrowserWindow, dialog, ipcMain, shell } = require('electron');
const log4js = require('log4js');
const path = require('path');
const fs = require('fs');
const userStyles = require('../../utils/userStyles');
const settings = require('../../utils/settings');

const logger = log4js.getLogger('userstyles');
const DISABLED_KEY = 'appearance.disabledUserstyles';

let stylesDir = null;
let SITE = null; // hostname the userstyles must target, e.g. example.com
let pageContents = null;
let applying = Promise.resolve();

function cssFiles() {
    if (!fs.existsSync(stylesDir)) return [];
    return fs.readdirSync(stylesDir).filter((file) => file.endsWith('.css')).sort();
}

function isEnabled(file) {
    return !settings.get(DISABLED_KEY).includes(file);
}

// Parse + compile one file. Returns { file, name, version, author, description, css, error }
async function load(file) {
    const info = { file, name: file.replace(/\.(user\.)?css$/, '') };
    try {
        const parsed = userStyles.parseCSS(fs.readFileSync(path.join(stylesDir, file), 'utf-8'));
        const { metadata } = parsed;
        Object.assign(info, {
            name: metadata.name || info.name,
            version: metadata.version,
            author: typeof metadata.author === 'object' ? metadata.author?.name : metadata.author,
            description: metadata.description,
        });
        const compiled = await userStyles.compileStyle(parsed.css, metadata);
        if (compiled.error) info.error = compiled.error.message;
        else if (!compiled.sites?.[SITE]) info.error = `Doesn't apply to ${SITE}`;
        else info.css = compiled.sites[SITE];
    } catch (error) {
        info.error = error.message;
    }
    return info;
}

async function list() {
    const styles = await Promise.all(cssFiles().map(load));
    return styles.map(({ css, ...style }) => ({ ...style, enabled: isEnabled(style.file) }));
}

// Send the currently enabled userstyles to the page, replacing what it had
function apply() {
    applying = applying.then(async () => {
        if (!pageContents || pageContents.isDestroyed()) return;
        const css = [];
        for (const style of await Promise.all(cssFiles().filter(isEnabled).map(load))) {
            if (style.error) {
                logger.warn(`Userstyle ${style.name}: ${style.error}`);
                continue;
            }
            css.push(style.css);
            logger.info(`Applied userstyle: ${style.name}`);
        }
        if (!pageContents.isDestroyed()) pageContents.send('userstyles:apply', css);
    }).catch((error) => logger.error('Failed to apply userstyles', error));
    return applying;
}

function setEnabled(file, enabled) {
    const disabled = settings.get(DISABLED_KEY).filter((f) => f !== file);
    if (!enabled) disabled.push(file);
    settings.set(DISABLED_KEY, disabled);
    return apply();
}

async function add(win) {
    const options = {
        title: 'Add Userstyle',
        filters: [{ name: 'Userstyles', extensions: ['css'] }],
        properties: ['openFile', 'multiSelections'],
    };
    const { canceled, filePaths } = await (win ? dialog.showOpenDialog(win, options) : dialog.showOpenDialog(options));
    if (canceled) return [];
    fs.mkdirSync(stylesDir, { recursive: true });
    for (const source of filePaths) fs.copyFileSync(source, path.join(stylesDir, path.basename(source)));
    await apply();
    return filePaths.map((p) => path.basename(p));
}

async function remove(file) {
    // Only files directly inside the userstyles folder
    if (path.basename(file) !== file || !cssFiles().includes(file)) return;
    await shell.trashItem(path.join(stylesDir, file));
    settings.set(DISABLED_KEY, settings.get(DISABLED_KEY).filter((f) => f !== file));
    await apply();
}

// site: hostname a userstyle must have a section for (from config.urls.main)
function initUserstyles({ dir, site, webContents }) {
    stylesDir = dir;
    SITE = site;
    pageContents = webContents;
    webContents.on('did-finish-load', apply);

    ipcMain.handle('userstyles:list', () => list());
    ipcMain.handle('userstyles:set-enabled', (event, file, enabled) => setEnabled(file, enabled));
    ipcMain.handle('userstyles:add', () => add(BrowserWindow.getFocusedWindow()));
    ipcMain.handle('userstyles:remove', (event, file) => remove(file));
    ipcMain.handle('userstyles:open-folder', () => {
        fs.mkdirSync(stylesDir, { recursive: true });
        return shell.openPath(stylesDir);
    });
}

module.exports = { initUserstyles, apply };
