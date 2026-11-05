const { autoUpdater } = require('electron-updater');
const { app, shell } = require('electron');
const log4js = require('log4js');
const os = require('os');
const packageJson = require('../../../../package.json');
const { getInstallType } = require('./installType');
const zipUpdater = require('./zipUpdater');
const settings = require('../../utils/settings');

const logger = log4js.getLogger('updater');
let _setupDone = false;
let _updateCheckInterval = null;

// How this install updates: electron-updater handles AppImage (swaps the AppImage),
// deb/rpm/pacman (downloads the package, installs it through pkexec), NSIS and mac.
// Portable zips go through zipUpdater instead.
const installType = getInstallType();
const useZipUpdater = installType === 'zip';

let _feedUrl = null;
let _channel = 'latest';
let _headers = {};
let _tempDir = os.tmpdir();
let _zipUpdate = null;   // { version, url, sha512, size } from the last check
let _zipStaging = null;  // extracted folder ready to swap in

// The splash window is destroyed once the main window shows; later checks must skip it
function sendTo(view, channel, payload) {
    if (!view || view.isDestroyed?.()) return;
    const contents = view.webContents;
    if (contents && !contents.isDestroyed()) contents.send(channel, payload);
}

function notifySplash(title, subtitle) {
    sendTo(global.splash, 'ui:progtext', { title, subtitle });
}

// Splash progress bar; the splash takes a 0-1 fraction
function splashProgress(percent) {
    notifySplash('Downloading update', `${percent}% complete`);
    sendTo(global.splash, 'ui:progbar', { reason: 'update', prog: percent / 100 });
}

// In-page toast (src/ui/rend/register-handles.js)
function notifyPage(title, message) {
    sendTo(global.PageView, 'ui:notif', { title, message });
}

function setup(config) {
    if (_setupDone) return;
    _setupDone = true;

    // Feed/channel come from config.js; the user-facing toggles from the settings window
    const updateConfig = {
        ...((config.user_settings || {}).updates || {}),
        autoCheck: settings.get('updates.autoCheck'),
        autoDownload: settings.get('updates.autoDownload'),
        autoInstallOnQuit: settings.get('updates.autoInstallOnQuit'),
    };
    const provider = updateConfig.provider || 'generic';
    const userAgent = `${packageJson.name}-updater/${packageJson.version} (${os.platform()} ${os.arch()}; Electron ${process.versions.electron}; ${installType})`;
    _channel = updateConfig.channel || 'latest';
    _headers = { 'User-Agent': userAgent };
    _tempDir = (config.paths || {}).updateDir || os.tmpdir();
    logger.log(`Install type: ${installType}, provider: ${provider}`);

    // electron-updater appends the platform/arch itself (latest-linux.yml,
    // latest-linux-arm64.yml, latest-mac.yml, latest.yml), so only the base channel goes here.
    if (provider === 'github') {
        autoUpdater.setFeedURL({
            provider: 'github',
            owner: updateConfig.owner,
            repo: updateConfig.repo,
            channel: _channel,
            requestHeaders: _headers
        });
    } else {
        _feedUrl = updateConfig.feedUrl || `${(config.app || {}).serverUrl}/update/`;
        autoUpdater.setFeedURL({
            provider: 'generic',
            url: _feedUrl,
            channel: _channel,
            requestHeaders: _headers
        });
    }

    // Downloads are started here (startupUpdate, periodic checks), never by electron-updater
    // itself, so a download can't start twice
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = updateConfig.autoInstallOnQuit !== false;
    autoUpdater.disableWebInstaller = true;
    autoUpdater.disableDifferentialDownload = true;

    if (!app.isPackaged) {
        autoUpdater.forceDevUpdateConfig = true;
    }

    autoUpdater.on('checking-for-update', () => {
        logger.log('Checking for updates...');
        notifySplash('Checking for updates...', 'Awaiting response');
    });

    autoUpdater.on('update-available', (info) => {
        logger.log(`Update available: ${info.version}`);
        notifySplash('Update available', `Version ${info.version}`);
    });

    autoUpdater.on('update-not-available', () => {
        logger.log('No update available');
        notifySplash('Checking for updates...', 'Up to date!');
    });

    autoUpdater.on('error', (err) => {
        logger.error('Update error:', err.message);
        notifySplash('Update check failed', 'Continuing...');
    });

    autoUpdater.on('download-progress', (progress) => {
        const percent = Math.round(progress.percent);
        logger.log(`Download progress: ${percent}%`);
        splashProgress(percent);
    });

    autoUpdater.on('update-downloaded', (info) => {
        logger.log(`Update downloaded: ${info.version}`);
        notifyPage('Update Ready', `v${info.version} will install on restart`);
    });

    // Start periodic checks
    const interval = updateConfig.checkInterval || 3600000;
    const setPeriodicChecks = (enabled) => {
        clearInterval(_updateCheckInterval);
        _updateCheckInterval = enabled ? setInterval(async () => {
            if (!app.isPackaged) return;
            const result = await checkForUpdates();
            // Downloaded in the background; installs when the app quits
            if (result.code === 'update-available' && settings.get('updates.autoDownload')) {
                notifyPage('Update Available', `Version ${result.info.latest} is downloading`);
                await downloadUpdate();
            }
        }, interval) : null;
    };
    setPeriodicChecks(updateConfig.autoCheck !== false);

    settings.onChange('updates.autoCheck', setPeriodicChecks);
    settings.onChange('updates.autoInstallOnQuit', (value) => {
        autoUpdater.autoInstallOnAppQuit = value;
    });
}

async function checkZipForUpdates() {
    if (!_feedUrl) {
        logger.warn('Portable zip updates need the generic provider feedUrl');
        return { code: 'check-failed', msg: 'No update feed configured' };
    }
    logger.log('Checking for updates (zip)...');
    notifySplash('Checking for updates...', 'Awaiting response');
    try {
        _zipUpdate = await zipUpdater.check(_feedUrl, _channel, _headers);
    } catch (err) {
        logger.error('Update error:', err.message);
        notifySplash('Update check failed', 'Continuing...');
        return { code: 'check-failed', msg: 'Failed to check for updates' };
    }
    if (!_zipUpdate) {
        logger.log('No update available');
        notifySplash('Checking for updates...', 'Up to date!');
        return { code: 'no-update', msg: 'Already up to date' };
    }

    logger.log(`Update available: ${_zipUpdate.version}`);
    const selfUpdate = zipUpdater.canSelfUpdate();
    notifyPage('Update Available', selfUpdate
        ? `Version ${_zipUpdate.version} is available`
        : `Version ${_zipUpdate.version} is available, download it to update`);
    return { code: 'update-available', msg: 'Update available', info: { latest: _zipUpdate.version, current: app.getVersion(), selfUpdate } };
}

async function checkForUpdates() {
    if (useZipUpdater) return checkZipForUpdates();
    try {
        const result = await autoUpdater.checkForUpdates();
        if (!result) return { code: 'no-update', msg: 'No update available' };
        const latestVersion = result.updateInfo.version;
        const currentVersion = app.getVersion();
        if (latestVersion !== currentVersion) {
            return { code: 'update-available', msg: 'Update available', info: { latest: latestVersion, current: currentVersion } };
        }
        return { code: 'no-update', msg: 'Already up to date' };
    } catch (err) {
        logger.error('Failed to check for updates:', err.message);
        return { code: 'check-failed', msg: 'Failed to check for updates' };
    }
}

async function downloadZipUpdate() {
    if (!_zipUpdate) return { code: 'no-update', msg: 'No update available' };

    // Can't replace the install folder ourselves: hand the zip to the user instead
    if (!zipUpdater.canSelfUpdate()) {
        logger.log(`Install folder not writable, opening download: ${_zipUpdate.url}`);
        await shell.openExternal(_zipUpdate.url);
        return { code: 'manual', msg: 'Opened download link' };
    }

    try {
        _zipStaging = await zipUpdater.download(_zipUpdate, _tempDir, _headers, (p) => {
            splashProgress(Math.round(p * 100));
        });
        logger.log(`Update downloaded: ${_zipUpdate.version}`);
        notifyPage('Update Ready', `v${_zipUpdate.version} will install on restart`);
        return { code: 'downloaded', msg: 'Update downloaded' };
    } catch (err) {
        logger.error('Failed to download update:', err.message);
        return { code: 'download-failed', msg: 'Failed to download update', err };
    }
}

async function downloadUpdate() {
    if (useZipUpdater) return downloadZipUpdate();
    try {
        await autoUpdater.downloadUpdate();
        return { code: 'downloaded', msg: 'Update downloaded' };
    } catch (err) {
        logger.error('Failed to download update:', err.message);
        return { code: 'download-failed', msg: 'Failed to download update', err };
    }
}

function quitAndInstall() {
    if (useZipUpdater) {
        if (_zipStaging) zipUpdater.install(_zipStaging, _tempDir);
        else logger.warn('quitAndInstall called with no downloaded zip update');
        return;
    }
    // silent (no installer UI), and start the new version afterwards
    autoUpdater.quitAndInstall(true, true);
}

// Startup check, run while the splash is showing. With automatic downloads on, an update
// is downloaded right away (progress on the splash), installed, and the app restarts into
// the new version; otherwise startup just continues.
async function startupUpdate() {
    const result = await checkForUpdates();
    if (result.code !== 'update-available') return result;
    if (!app.isPackaged || !settings.get('updates.autoDownload') || (useZipUpdater && !result.info.selfUpdate)) {
        notifyPage('Update Available', `Version ${result.info.latest} is available`);
        return result;
    }

    global.isUpdating = true;
    logger.log(`Downloading update ${result.info.latest} at startup`);
    splashProgress(0);
    const download = await downloadUpdate();
    if (download.code !== 'downloaded') {
        global.isUpdating = false;
        notifySplash('Update failed', 'Continuing...');
        return download;
    }

    logger.log(`Installing update ${result.info.latest} and restarting`);
    notifySplash('Installing update', `Restarting into version ${result.info.latest}...`);
    setTimeout(quitAndInstall, 500);
    return { code: 'installing', msg: 'Installing update', info: result.info };
}

module.exports = { setup, checkForUpdates, startupUpdate, downloadUpdate, quitAndInstall, installType };
