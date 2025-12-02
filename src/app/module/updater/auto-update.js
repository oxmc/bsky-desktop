const childProcess = require('child_process');
const { app } = require('electron');
const log4js = require('log4js');
const SemVer = require('semver');
const axios = require('axios');
const path = require('path');
const os = require('os');
const fs = require('fs');

// Load config.js
const packageJson = require('../../../../package.json');
const initConfig = require('../../config');
config = initConfig(app, packageJson);

// import the asarUpdater module
const asarUpdater = require('./asarUpdater');

// Get system information
const SystemInfo = require('../../utils/sysInfo');

// Get the current system platform
const sys = new SystemInfo();

// Detect the app install type
const installType = require('./installType');

// Setup the logger
const logger = log4js.getLogger("bskydesktop-updater");

// System architecture / Platform
const systemArch = sys.isARM64() ? 'arm64' : sys.isX64() ? '64' : sys.isX86() ? '86' : 'unknown';
const systemPlatform = sys.isWin() ? 'win' : sys.isMac() ? 'mac' : sys.isLinux() ? 'linux' : 'unknown';

// Download url: (arch, platform, installer)
const updateUrl = config.app.serverUrl + '/update';
const asarUpdateUrl = updateUrl + '/core';
const downloadUrl = config.app.serverUrl + '/dl';

// Default axios instance
const axiosInstance = axios.create({
    timeout: 15000,
    headers: {
        'User-Agent': `BskyDesktop/${app.getVersion()} (${systemPlatform}-${systemArch})`,
        "x-platform": systemPlatform,
        "x-arch": systemArch
    }
});

// Installer path and type (used to save the installer)
var installerPath = '';
var installerType = '';

async function detectInstallerType() {
    let installerType = 'unknown';

    // First check if the app is paclaged
    if (!app.isPackaged) {
        logger.warn('App is not packaged, cannot detect installer type.');
        return 'unpackaged';
    }

    try {
        // Check if system is Windows
        if (sys.isWin()) {
            logger.log('Checking for Windows installer type...');
            const res = await installType.getUninstallEntries({ DisplayName: 'PuppyJam' });

            //console.log(res);

            // Ensure result is valid before checking properties
            if (res.length > 0) {
                installerType = res[0].WindowsInstaller === 'MSI' ? 'msi' : 'exe';
            } else {
                // Default to exe if no installer type is found
                installerType = 'exe';
            }
        }

        // Check if system is macOS
        if (sys.isMac()) {
            const res = await installType.checkAppInstallationMethod();

            switch (res.type) {
                case 'MAS':
                    installerType = 'mas';
                    break;
                case 'PKG':
                    installerType = 'pkg';
                    break;
                case 'ZIP/DMG':
                    installerType = 'dmg';
                    break;
            }
        }
    } catch (err) {
        logger.error('Failed to detect installer type:', err);
    }

    return installerType;
}

// Asar updater
function asarUpdate() {
    asarUpdater.init();

    // updater events:
    asarUpdater.on('available', (task) => {
        //console.log('Update availible for', task)
        logger.log("Update availible for", task.name);
        global.PageView.webContents.send('ui:notif', JSON.stringify({ title: 'Update', message: 'An update is available' }));
        if (global.splash) global.splash.webContents.send('ui:progtext', { title: 'Update Available', subtitle: 'An update is available! Downloading...' });
        global.isUpdating = true;
    });
    asarUpdater.on('not-available', (task) => {
        //console.log('not-available', task);
        logger.log("No Updates Available for", task);
    });
    asarUpdater.on('progress', (task, p) => {
        console.log(task.name, p);
        if (global.splash) global.splash.webContents.send('ui:progtext', { title: 'Downloading Update', subtitle: 'Downloading update...' });
        if (global.splash) global.splash.webContents.send('ui:progbar', { reason: 'update', prog: p });
    });
    asarUpdater.on('downloaded', (task) => {
        //console.log('downloaded', task);
        logger.log("Downloaded Update for,", task.name);
        global.PageView.webContents.send('ui:notif', JSON.stringify({ title: 'Update Downloaded', message: 'Restarting to apply update...' }));
        if (global.splash) global.splash.webContents.send('ui:progtext', { title: 'Update Downloaded', subtitle: 'Restarting to apply update...' });
    });
    asarUpdater.on('completed', (manifest, tasks) => {
        console.log('completed', manifest, tasks);
        if (tasks.length === 0) {
            setTimeout(() => {
                logger.log("Quitting and Installing Update");
                asarUpdater.quitAndInstall();
            }, 5000);
        };
        //app.quit()
    });
    asarUpdater.on('error', (err) => {
        //console.error(err);
        logger.error(err);
        //app.quit()
    });

    // Set the feed URL (only works in packaged app):
    if (app.isPackaged) {
        logger.log("Setting Feed URL for app.asar");
        asarUpdater.setFeedURL(path.join(global.paths.app_root), asarUpdateUrl);
    };

    //Check for updates:
    logger.log("Checking for Updates");
    if (app.isPackaged) {
        const UPDATE_CHECK = 1000 * 60 * 60 * 4 // 4 hours
        setInterval(() => {
            asarUpdater.checkForUpdates();
        }, UPDATE_CHECK);
        asarUpdater.checkForUpdates();
    } else {
        logger.warn("Not checking for updates as app is not packaged");
    };
}

// Check for updates
async function checkForUpdates() {
    return new Promise((resolve, reject) => {
        // Current system information
        logger.log('Current system information:', sys.platform, sys.getVersion(), sys.arch);

        // Check if the current system is Windows
        if (sys.isWin()) {
            // Check if the system is before Windows 10
            if (sys.earlierThan('10.0.0')) {
                // Windows 10 and above are supported, but windows 7 and 8 are not supported
                logger.error('Windows 7 and 8 are not supported, please upgrade to Windows 10 or above, not updating...');
                resolve({ err: 'old-os', msg: 'Windows 7 and 8 are not supported, please upgrade to Windows 10 or above, not updating...' });
            } else {
                // Check for updates, and if there are updates, download and install them
                logger.log('Checking for updates (win)...');
                axiosInstance.get(asarUpdateUrl).then((res) => {
                    //console.log(res.data);
                    const latestVersion = res.data.version;
                    const currentVersion = app.getVersion();
                    if (SemVer.gt(latestVersion, currentVersion)) {
                        //logger.log('Update available:', latestVersion);
                        global.PageView.webContents.send('ui:notif', JSON.stringify({ title: 'Update', message: 'An update is available' }));
                        if (global.splash) global.splash.webContents.send('ui:progtext', { title: 'Update Available', subtitle: 'An update is available! Downloading...' });
                        resolve({ code: 'update-available', msg: 'An update is available.', info: { latest: latestVersion, current: currentVersion, response: res.data } });
                    } else {
                        //logger.log('No updates available.');
                        resolve({ code: 'no-update', msg: 'No updates available.' });
                    }
                }).catch((err) => {
                    logger.error('Failed to check for updates:', err);
                    resolve({ code: 'check-failed', msg: 'Failed to check for updates.' });
                });
            }
        }

        // Check if the current system is macOS
        if (sys.isMac()) {
            // Check the current version of macOS, and whether we can use the pkg installer
            if (sys.laterThan('10.0.0')) {
                // Check for updates, and if there are updates, download and install them
                logger.log('Checking for updates (mac)...');

                // Check for updates
                axiosInstance.get(asarUpdateUrl).then((res) => {
                    //console.log(res.data);
                    const latestVersion = res.data.version;
                    const currentVersion = app.getVersion();
                    if (SemVer.gt(latestVersion, currentVersion)) {
                        //logger.log('Update available:', latestVersion);
                        global.PageView.webContents.send('ui:notif', JSON.stringify({ title: 'Update', message: 'An update is available' }));
                        if (global.splash) global.splash.webContents.send('ui:progtext', { title: 'Update Available', subtitle: 'An update is available! Downloading...' });
                        resolve({ code: 'update-available', msg: 'An update is available.', info: { latest: latestVersion, current: currentVersion, response: res.data } });
                    } else {
                        //logger.log('No updates available.');
                        resolve({ code: 'no-update', msg: 'No updates available.' });
                    }
                }).catch((err) => {
                    logger.error('Failed to check for updates:', err);
                    resolve({ code: 'check-failed', msg: 'Failed to check for updates.' });
                });
            } else {
                // macOS versions before 10 are not supported
                logger.error('macOS versions before 10 are not supported, not updating...');
                resolve({ err: 'old-os', msg: 'macOS versions before 10 are not supported, not updating...' });
            }
        }

        // Check if the current system is Linux
        if (sys.isLinux()) {
            // Check for updates, and if there are updates, download and install them (no system version check)
            // Linux versions use AppImage, so we instead need to check for a new asar file so that the app can
            // load the new asar instead of the packaged one (or even just delete the old appimage and download a new one)
            logger.log('Checking for updates (linux)...');
            asarUpdate();
        }
    }).catch((err) => {
        logger.error('Failed to check for updates:', err);
    });
}

// Download the update installer
async function downloadUpdate() {
    return new Promise(async (resolve, reject) => {
        // download the update installer
        //logger.log('Downloading update...');

        // Create the update directory if it doesn't exist
        if (!fs.existsSync(global.paths.updateDir)) {
            fs.mkdirSync(global.paths.updateDir);
        }

        // Get the installer name
        var installerName = '';
        switch (systemPlatform) {
            case 'win':
                installerName = `bsky-desktop-${sys.platform}-${systemArch}.exe`;
                break;
            case 'mac':
                installerName = `bsky-desktop-${sys.platform}-${systemArch}.dmg`;
                break;
            case 'linux':
                installerName = `bsky-desktop-${sys.platform}-${systemArch}.AppImage`;
                break;
            default:
                installerName = `bsky-desktop-${sys.platform}-${systemArch}.bin`;
                break;
        }
        installerPath = path.join(global.paths.updateDir, installerName);

        // Detect the installer type
        installerType = await detectInstallerType();
        //installerType = 'exe'; // For testing purposes
        //logger.info('Installer type:', installerType);

        // if the installer type is unknown, return an error
        if (installerType === 'unknown') {
            //logger.error('Failed to detect installer type:', installerType);
            reject({ code: 'unknown-installer', msg: 'Failed to detect installer type.', err: installerType });
            return;
        }

        // If the installer type is unpackaged, return and continue
        if (installerType === 'unpackaged') {
            //logger.warn('App is not packaged, cannot download update.');
            reject({ code: 'unpackaged', msg: 'App is not packaged, cannot download update.' });
            return;
        }

        // download the installer as a stream
        const installerStream = fs.createWriteStream(installerPath);

        // download the installer
        axiosInstance({
            method: 'get',
            url: downloadUrl,
            responseType: 'stream',
            headers: {
                "x-installMethod": installerType
            }
        }).then((res) => {
            // pipe the installer stream to the installer file
            res.data.pipe(installerStream);

            // close the installer stream
            installerStream.on('finish', () => {
                installerStream.close();
                // resolve the promise
                resolve({ code: 'downloaded', msg: 'Update downloaded successfully.', path: installerPath });
            });

            // handle errors
            installerStream.on('error', (err) => {
                //logger.error('Failed to download and save update:', err);
                reject({ code: 'download-save-failed', msg: 'Failed to download and save update.', err: err });
            });

            // handle close
            installerStream.on('close', () => {
                //logger.log('Installer stream closed.');
            });
        }).catch((err) => {
            logger.error('Failed to download and save update:', err);
            reject({ code: 'download-failed', msg: 'Failed to download update.', err: err });
        });
    }).catch((err) => {
        //logger.error('Failed to download update:', err);
        return { code: 'download-failed', msg: 'Failed to download update.', err: err };
    });
}

async function installUpdate(installer) {
    return new Promise((resolve, reject) => {
        try {
            // Current system information
            //logger.log('Current system information:', sys.platform, sys.getVersion(), sys.arch);

            // Check if the current system is Windows
            if (sys.isWin()) {
                // Check if the system is before Windows 10
                if (sys.earlierThan('10.0.0')) {
                    // Windows 10 and above are supported, but windows 7 and 8 are not supported
                    logger.error('Windows 7 and 8 are not supported, please upgrade to Windows 10 or above, not installing updating...');
                    reject({ err: 'old-os', msg: 'Windows 7 and 8 are not supported, please upgrade to Windows 10 or above, not installing update...' });
                } else {
                    // Install the update
                    logger.log('Installing update (win)...');

                    // Check if the installer path is valid
                    installerPath = path.resolve(installer);
                    if (!fs.existsSync(installerPath)) {
                        logger.error('Installer path is invalid:', installerPath);
                        reject({ code: 'invalid-installer', msg: 'Installer path is invalid.', path: installerPath });
                    }

                    // Create the log file
                    const logStream = fs.createWriteStream(path.join(global.paths.updateDir, 'install.log'), { flags: 'a' });

                    // Run the installer (msi or exe)
                    switch (installerType) {
                        case 'msi':
                            // Run the msi installer /passive, /quiet, /qn, /norestart
                            const msiExec = childProcess.spawn('cmd.exe', ['/c', 'msiexec', '/i "${installerPath}"', '/qn', '/norestart', `/log ${path.join(global.paths.updateDir, 'installer-exec.log')}`], {
                                detached: true,
                                stdio: ['ignore', 'pipe', 'pipe']
                            });

                            msiExec.on('error', (err) => {
                                //console.error('Failed to start process:', err);
                                reject({ code: 'process-failed', msg: 'Failed to start installation process.', err: err });
                            });

                            msiExec.on('exit', (code, signal) => {
                                if (code === 0) {
                                    //console.log('Update installed successfully.');
                                    resolve({ code: 'update-installed', msg: 'Update installed successfully.' });
                                } else {
                                    //console.error(`Installer process exited with code: ${code}, signal: ${signal}`);
                                    reject({ code: 'install-failed', msg: 'Installer process failed.', exitCode: code, signal: signal });
                                }
                            });

                            msiExec.stdout.on('data', (data) => {
                                //console.log(`stdout: ${data}`);
                                logStream.write(data);
                            });

                            msiExec.stderr.on('data', (data) => {
                                //console.error(`stderr: ${data}`);
                                logStream.write(data);
                            });

                            app.quit();
                            break;
                        case 'exe':
                            // Run the exe installer /s
                            const exeExec = childProcess.spawn('cmd.exe', ['/c', installerPath], {
                                detached: true,
                                stdio: ['ignore', 'pipe', 'pipe']
                            });

                            exeExec.on('error', (err) => {
                                //console.error('Failed to start process:', err);
                                reject({ code: 'process-failed', msg: 'Failed to start installation process.', err: err });
                            });

                            exeExec.on('exit', (code, signal) => {
                                if (code === 0) {
                                    //console.log('Update installed successfully.');
                                    resolve({ code: 'update-installed', msg: 'Update installed successfully.' });
                                } else {
                                    //console.error(`Installer process exited with code: ${code}, signal: ${signal}`);
                                    reject({ code: 'install-failed', msg: 'Installer process failed.', exitCode: code, signal: signal });
                                }
                            });

                            exeExec.stdout.on('data', (data) => {
                                //console.log(`stdout: ${data}`);
                                logStream.write(data);
                            });

                            exeExec.stderr.on('data', (data) => {
                                //console.error(`stderr: ${data}`);
                                logStream.write(data);
                            });

                            app.quit();
                            break;
                        default:
                            //logger.error('Installer type is invalid:', installerType);
                            reject({ code: 'invalid-installer-type', msg: 'Installer type is invalid.', type: installerType });
                            break;
                    }
                }
            }

            // Check if the current system is macOS
            if (sys.isMac()) {
                // Check the current version of macOS, and whether we can use the pkg installer
                if (sys.laterThan('10.0.0')) {
                    // Install the update
                    logger.log('Installing update (mac)...');

                    // Check if the installer path is valid
                    installerPath = path.resolve(installer);
                    if (!fs.existsSync(installerPath)) {
                        logger.error('Installer path is invalid:', installerPath);
                        reject({ code: 'invalid-installer', msg: 'Installer path is invalid.', path: installerPath });
                    }

                    // Create the log file
                    const logStream = fs.createWriteStream(path.join(global.paths.updateDir, 'install.log'), { flags: 'a' });

                    // Run the .pkg installer
                    const command = `sudo installer -pkg ${installerPath} -target /`;
                    const shellProcess = childProcess.spawn('sh', ['-c', command], {
                        detached: true,
                        stdio: ['ignore', 'pipe', 'pipe']
                    });

                    shellProcess.on('error', (err) => {
                        //console.error('Failed to start process:', err);
                        reject({ code: 'process-failed', msg: 'Failed to start installation process.', err: err });
                    });

                    shellProcess.on('exit', (code, signal) => {
                        if (code === 0) {
                            //console.log('Update installed successfully.');
                            resolve({ code: 'update-installed', msg: 'Update installed successfully.' });
                        } else {
                            //console.error(`Installer process exited with code: ${code}, signal: ${signal}`);
                            reject({ code: 'install-failed', msg: 'Installer process failed.', exitCode: code, signal: signal });
                        }
                    });

                    shellProcess.stdout.on('data', (data) => {
                        //console.log(`stdout: ${data}`);
                        logStream.write(data);
                    });

                    shellProcess.stderr.on('data', (data) => {
                        //console.error(`stderr: ${data}`);
                        logStream.write(data);
                    });
                } else {
                    // macOS versions before 10 are not supported
                    logger.error('macOS versions before 10 are not supported, not installing update...');
                    reject({ err: 'old-os', msg: 'macOS versions before 10 are not supported, not installing update...' });
                }
            }

            // Check if the current system is Linux (This should be handled via asarUpdater)
            if (sys.isLinux()) {
                // Check for updates, and if there are updates, download and install them (no system version check)
                // Linux versions use AppImage, so we instead need to check for a new asar file so that the app can
                // load the new asar instead of the packaged one (or even just delete the old appimage and download a new one)
                //logger.log('Checking for updates (linux)...');
                logger.log('This is not implemented yet, please update manually.');
                //asarUpdate();
            }

        } catch (err) {
            logger.error('Failed to install update:', err);
            reject({ code: 'install-failed', msg: 'Failed to install update.', err: err });
        }
    });
};

async function downloadAndInstall() {
    return new Promise((resolve, reject) => {
        // Download the update installer
        downloadUpdate().then((res) => {
            if (res.code === 'downloaded') {
                // Install the update
                installUpdate(res.path).then((res) => {
                    if (res.code === 'install-failed') {
                        //logger.error('Failed to install update:', res.err);
                        reject({ code: 'install-failed', msg: 'Failed to install update.', err: res.err });
                    } else {
                        //logger.log('Update installed successfully.');
                        resolve({ code: 'update-installed', msg: 'Update installed successfully.' });
                    }
                });
            } else {
                //logger.error('Failed to download update:', res.err);
                reject({ code: 'download-failed', msg: 'Failed to download update.', err: res.err });
            }
        }).catch((err) => {
            //logger.error('Failed to download and install update:', err);
            reject({ code: 'download-install-failed', msg: 'Failed to download and install update.', err: err });
        });
    });
}

module.exports = {
    checkForUpdates,
    downloadUpdate,
    installUpdate,
    downloadAndInstall
};