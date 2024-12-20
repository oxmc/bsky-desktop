const path = require('path');
const os = require('os');
const fs = require('fs');
const childProcess = require('child_process');
const { app } = require('electron');
const log4js = require('log4js');

// import the asarUpdater module
const asarUpdater = require('./asarUpdater');

// Get system information
const SystemInfo = require('./sysInfo');

// Get the current system platform
const sys = new SystemInfo();

// Setup the logger
const logger = log4js.getLogger("bskydesktop");

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
        asarUpdater.setFeedURL(path.join(global.paths.app_root), 'https://cdn.oxmc.me/internal/bsky-desktop/update/core');
    };

    //Check for updates:
    logger.log("Checking for Updates");
    if (app.isPackaged) {
        const UPDATE_CHECK = 1000 * 60 * 60 * 4 // 4 hours
        setInterval(() => {
            //asarUpdater.checkForUpdates();
        }, UPDATE_CHECK);
        //asarUpdater.checkForUpdates();
    } else {
        logger.warn("Not checking for updates as app is not packaged");
    };
}

function checkForUpdates() {
    // Check if the current system is Windows
    if (sys.isWin()) {
        // Check if the system is before Windows 10
        if (sys.laterThan('10.0.0')) {
            // Check for updates, and if there are updates, download and install them
            logger.log('Checking for updates (win)...');
        } else {
            // Windows 10 and above are supported, but windows 7 and 8 are not supported
            logger.error('Windows 7 and 8 are not supported, please upgrade to Windows 10 or above, not updating...');
        }
    }

    // Check if the current system is macOS
    if (sys.isMac()) {
        // Check if the current version is later than macOS 10.15.0
        if (sys.laterThan('10.15.0')) {
            // Check for updates, and if there are updates, download and install them
            logger.log('Checking for updates (macOS)...');
        } else {
            // macOS 10.15 and above are supported, but macOS 10.14 and below are not supported
            logger.error('macOS 10.14 and below are not supported, please upgrade to macOS 10.15 or above, not updating...');
        }
    }

    // Check if the current system is Linux
    if (sys.isLinux()) {
        // Check for updates, and if there are updates, download and install them (no system version check)
        logger.log('Checking for updates (linux)...');
        asarUpdate();
    }
}

module.exports = checkForUpdates;