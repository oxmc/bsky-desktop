const path = require('path');
const os = require('os');

module.exports = function initConfig(app, packageJson) {
    const config = {
        // Runtime state
        runtime: {
            isUpdating: false,
            isReady: false,
            isDebug: false,
            isQuitting: false,
            taskButtons: {}
        },

        // App Information
        app: {
            name: app.getName(),
            version: app.getVersion(),
            license: packageJson.license,
            deeplink: ["bsky"],
            serverUrl: "https://cdn.oxmc.me/apps/bsky-desktop"
        },

        // App Settings
        app_settings: {},

        // Paths
        paths: {}, // Will be populated below

        // URLs (more will be populated below)
        urls: {
            main: 'https://bsky.app'
        },
    };

    // App
    const appName = config.app.name;

    // App Settings ()
    config.app_settings = {
        badgeOptions: {
            fontColor: '#FFFFFF', // The font color
            font: '62px Microsoft Yahei', // The font and its size. You shouldn't have to change this at all
            color: '#FF0000', // The background color
            radius: 48, // The radius for the badge circle. You shouldn't have to change this at all
            useSystemAccentTheme: true, // Use the system accent color for the badge
            updateBadgeEvent: 'ui:badgeCount', // The IPC event name to listen on
            badgeDescription: 'Unread Notifications', // The badge description
            invokeType: 'send', // The IPC event type
            max: 9, // The maximum integer allowed for the badge. Anything above this will have "+" added to the end of it.
            fit: false, // Useful for multi-digit numbers. For single digits keep this set to false
            additionalFunc: (count) => {
                // An additional function to run whenever the IPC event fires. It has a count parameter which is the number that the badge was set to.
                //console.log(`Received ${count} new notifications!`);
            },
        },
        trayOptions: {
            closeToTray: false, // Close to tray instead of quitting the app
        }
    };

    // Paths (App)
    config.paths.app_root = app.getAppPath();
    config.paths.app = path.join(config.paths.app_root, 'src');
    config.paths.home = os.homedir();
    config.paths.temp = path.join(os.tmpdir(), appName);

    // Determine data path based on OS
    let dataPath;
    if (os.platform() === 'win32') {
        dataPath = path.join(os.homedir(), 'AppData', 'Roaming', appName);
    } else if (os.platform() === 'darwin') {
        dataPath = path.join(os.homedir(), 'Library', 'Application Support', appName);
    } else { // linux and other
        dataPath = path.join(os.homedir(), '.config', appName);
    }
    config.paths.data = dataPath;
    config.paths.logs = path.join(config.paths.data, 'logs');

    // Paths (User)
    config.paths.user = path.join(config.paths.data, 'user');
    config.paths.updateDir = path.join(config.paths.user, 'update');
    config.paths.extensions = path.join(config.paths.user, 'extensions');
    config.paths.userstyles = path.join(config.paths.user, 'userstyles');

    // URLs
    const mainUrl = config.urls.main;
    config.urls.login = `${mainUrl}/login`;
    config.urls.settings = {
        general: `${mainUrl}/settings`,
        account: `${mainUrl}/settings/account`,
        appearance: `${mainUrl}/settings/appearance`,
        privacy: `${mainUrl}/settings/privacy-and-security`
    };

    // Return the config object
    return config;
};