const { app, BrowserWindow, BrowserView, globalShortcut, ipcMain, Tray, Menu, protocol, session, dialog } = require("electron");
const electronremote = require("@electron/remote/main");
//const asar = require('@electron/asar');
const windowStateKeeper = require("./window-state/index");
const { setupTitlebar, attachTitlebarToWindow } = require("./titlebar/main");
const openAboutWindow = require("./about-window/src/index").default;
const badge = require('./badge');
const nodeNotifier = require('node-notifier');
const contextMenu = require('./context-menu');
const autoUpdater = require('./utils/auto-update');
const loadCRX = require('./utils/loadCRX');
const userStyles = require('./utils/userStyles');
const log4js = require("log4js");
//const axios = require("axios");
const path = require("path");
const fs = require("fs");
const os = require("os");
require('v8-compile-cache');

// Load package.json and contributors.json
const packageJson = require(path.join(__dirname, '..', '..', 'package.json'));
const contributors = require(path.join(__dirname, 'contributors.json'));

// isUpdaing:
global.isUpdating = false;

// App Info:
global.appInfo = {
  name: app.getName(),
  version: app.getVersion(),
  license: packageJson.license,
  deeplink: 'bsky'
}

// Paths:
global.paths = {
  app_root: app.getAppPath(),
  app: path.join(app.getAppPath(), 'src'),
  data: os.platform() === 'win32' ? path.join(os.homedir(), 'AppData', 'Roaming', global.appInfo.name) : os.platform() === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support', global.appInfo.name) : path.join(os.homedir(), '.config', global.appInfo.name),
  home: os.homedir(),
  temp: path.join(os.tmpdir(), global.appInfo.name),
};
global.paths.user = path.join(global.paths.data, 'user');
global.paths.updateDir = path.join(global.paths.user, 'update');
global.paths.extensions = path.join(global.paths.user, 'extensions');
global.paths.userstyles = path.join(global.paths.user, 'userstyles');

// URLs:
global.urls = {
  main: 'https://bsky.app'
};

// Settings urls:
global.settings = {
  general: `${global.urls.main}/settings`
};
global.settings.account = `${global.settings.general}/account`;
global.settings.appearance = `${global.settings.general}/appearance`;
global.settings.privacy = `${global.settings.general}/privacy-and-security`;

// Check if app is run from the installer dmg (macOS)
if (process.platform === 'darwin' && app.isPackaged && !app.isInApplicationsFolder()) {
  const response = dialog.showMessageBoxSync({
    type: 'question',
    buttons: ['Yes', 'No'],
    title: 'Move to Applications folder',
    message: 'Please move the app to the Applications folder to ensure it works correctly. Would you like to move it now?'
  });

  if (response === 0) {  // User clicked 'Yes'
    const appPath = app.getPath('exe');
    const applicationsFolder = '/Applications';
    const appName = path.basename(appPath);
    const destinationPath = path.join(applicationsFolder, appName);

    // Try to move the app
    fs.rename(appPath, destinationPath, (err) => {
      if (err) {
        dialog.showErrorBox('Move Failed', 'Failed to move the app to the Applications folder.');
      } else {
        dialog.showInformationBox({ message: 'The app has been moved to the Applications folder. Please restart it.' });
        app.quit();
      }
    });
  } else {
    dialog.showErrorBox('Move to Applications folder', 'Please move the app to the Applications folder to ensure it works correctly.');
    app.quit();
  }
}

// Badge options:
const badgeOptions = {
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
};

/* Logging */
const logFileName = 'BSKY-DESKTOP';
const logFile = path.join(global.paths.data, `${logFileName}.log`);
log4js.configure({
  appenders: {
    stdout: { type: "stdout" },
    bskydesktop: {
      type: "file",
      filename: `${logFile}`,
      backups: 5,
    }
  },
  categories: {
    default: {
      appenders: ["stdout", "bskydesktop"],
      level: "debug"
    }
  }
});
const logger = log4js.getLogger("bskydesktop");
logger.level = fs.existsSync(path.join(global.paths.data, '.dev')) || fs.existsSync(path.join(global.paths.data, '.debug')) ? "debug" : "info";
// if logfile already exists, rename it unles the lock file is present
if (fs.existsSync(logFile) && !fs.existsSync(path.join(global.paths.data, 'lockfile'))) {
  const stats = fs.statSync(logFile);
  const mtime = new Date(stats.mtime);
  const today = new Date();
  // If the log file is from a different day or the secconds is more than 5, rename it
  if (mtime.getDate() !== today.getDate() || mtime.getSeconds() + 5 < today.getSeconds()) {
    fs.renameSync(logFile, path.join(global.paths.data, `${logFileName}.${mtime.toISOString().split('T')[0]}.log`));
  };
};
logger.log(`Starting Bsky Desktop v${packageJson.version} on ${os.platform()} ${os.arch()}`);

// Create data directory if it does not exist:
if (!fs.existsSync(global.paths.data)) {
  logger.info("Creating Data Directory");
  fs.mkdirSync(global.paths.data, { recursive: true });
};

// Create temp directory if it does not exist:
if (!fs.existsSync(global.paths.temp)) {
  logger.info("Creating Temp Directory");
  fs.mkdirSync(global.paths.temp, { recursive: true });
};

// Create user directory if it does not exist:
if (!fs.existsSync(global.paths.data, 'user')) {
  logger.info("Creating User Directory");
  fs.mkdirSync(global.paths.user, { recursive: true });
};

// Create extensions directory if it does not exist:
if (!fs.existsSync(global.paths.extensions)) {
  logger.info("Creating Extensions Directory");
  fs.mkdirSync(global.paths.extensions, { recursive: true });
};

// Create userstyles directory if it does not exist:
if (!fs.existsSync(global.paths.userstyles)) {
  logger.info("Creating Userstyles Directory");
  fs.mkdirSync(global.paths.userstyles, { recursive: true });
};

// Create update directory if it does not exist:
if (!fs.existsSync(global.paths.updateDir)) {
  logger.info("Creating Update Directory");
  fs.mkdirSync(global.paths.updateDir, { recursive: true });
};

// improve performance on linux?
if (process.platform !== "win32" && process.platform !== "darwin") {
  logger.log("Disabling Hardware Acceleration and Transparent Visuals");
  app.commandLine.appendSwitch("disable-transparent-visuals");
  app.commandLine.appendSwitch("disable-gpu");
  app.disableHardwareAcceleration();
}

// setup the titlebar main process:
setupTitlebar();

// Disable reload and F5 if not in dev mode:
if (process.env.NODE_ENV !== 'development') {
  app.on('browser-window-focus', function () {
    /*globalShortcut.register("CommandOrControl+R", () => {
      //console.log("CommandOrControl+R is pressed: Shortcut Disabled");
    });
    globalShortcut.register("F5", () => {
      //console.log("F5 is pressed: Shortcut Disabled");
    });*/
  });
  app.on('browser-window-blur', function () {
    /*globalShortcut.unregister('CommandOrControl+R');
    globalShortcut.unregister('F5');*/
  });
};

// create main window
function createWindow() {
  logger.log("Creating windowStateKeeper");
  const mainWindowState = windowStateKeeper({
    defaultWidth: 1340,
    defaultHeight: 800,
    fullScreen: false,
    maximize: true,
  });
  logger.log("Creating splash screen");
  const splash = (global.splash = new BrowserWindow({
    width: 400,
    height: 400,
    frame: false,
    show: false,
    icon: path.join(global.paths.app, 'ui', 'images', 'logo.png'),
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  }));
  splash.loadFile(path.join(global.paths.app, 'ui', 'splash.html'));
  logger.log("Creating Main Window");
  const mainWindow = (global.mainWindow = new BrowserWindow({
    x: mainWindowState.x,
    y: mainWindowState.y,
    width: mainWindowState.width,
    height: mainWindowState.height,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    show: false,
    icon: path.join(global.paths.app, 'ui', 'images', 'logo.png'),
    titleBarStyle: 'hidden',
    titleBarOverlay: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: true,
      preload: path.join(global.paths.app, 'ui', 'preload-titlebar.js'),
    }
  }));
  mainWindowState.manage(mainWindow);
  mainWindow.loadFile(path.join(global.paths.app, 'ui', 'titlebar.html'));
  mainWindow.hide();
  const PageView = (global.PageView = new BrowserView({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(global.paths.app, 'ui', 'preload.js'),
      session: global.session,
    },
  }));
  mainWindow.setBrowserView(PageView);
  PageView.webContents.loadURL(global.urls.main);
  PageView.setBounds({
    x: 0,
    y: 30,
    width: mainWindow.isMaximized() ? mainWindow.getBounds().width - 16 : mainWindow.getBounds().width,
    height: mainWindow.getBounds().height - 30,
  });
  mainWindow.on("resize", () => {
    PageView.setBounds({
      x: 0,
      y: 30,
      width: mainWindow.isMaximized() ? mainWindow.getBounds().width - 16 : mainWindow.getBounds().width,
      height: mainWindow.getBounds().height - 30,
    });
  });

  // Context Menu:
  contextMenu({
    labels: {
      showSaveImage: 'Download Image',
      showSaveVideo: 'Download Video',
      showSaveAudio: 'Download Audio',
      showCopyLink: 'Copy Link',
      showCopyImage: 'Copy Image',
      showInspectElement: 'Inspect Element'
    },
    showSelectAll: false,
    showSaveImage: true,
    showSaveVideo: true,
    showSaveAudio: true,
    showCopyLink: true,
    showCopyImage: false,
    showInspectElement: !app.isPackaged,
    window: PageView
  });

  // Badge count: (use mainWindow as that shows the badge on the taskbar)
  new badge(mainWindow, badgeOptions);

  logger.log("Main Window Created, Showing splashscreen");
  splash.show();
  //mainWindow.show();

  logger.log("Attaching Titlebar to Main Window");
  attachTitlebarToWindow(mainWindow);

  // DevTools:
  //mainWindow.webContents.openDevTools();
  //PageView.webContents.openDevTools();
  //splash.webContents.openDevTools();

  logger.log("Initializing @electron/remote");
  electronremote.initialize();
  electronremote.enable(mainWindow.webContents);
  electronremote.enable(PageView.webContents);

  // PageView Events:
  PageView.webContents.on('did-finish-load', () => {
    if (!global.isUpdating) {
      // Show the main window
      mainWindow.show();
      // Hide the splash screen
      splash.destroy();
    };
  });
  PageView.webContents.setWindowOpenHandler(({ url }) => {
    new BrowserWindow({ show: true, autoHideMenuBar: true, icon: path.join(global.paths.app, 'ui', 'images', 'logo.png') }).loadURL(url);
    return { action: 'deny' };
  });
  // Log PageView navigations:
  /*PageView.webContents.on('will-navigate', (event, url) => {
    logger.log(`Navigating to: ${url}`);
  });
  PageView.webContents.on('did-navigate-in-page', (event, url) => {
    logger.log(`Navigated to: ${url}`);
  });*/
};

function showAboutWindow() {
  openAboutWindow({
    icon_path: path.join(global.paths.app, 'ui', 'images', 'bsky-logo.svg'),
    package_json_dir: global.paths.app_root,
    product_name: global.appInfo.name,
    //open_devtools: process.env.NODE_ENV !== 'production',
    use_version_info: [
      ['Application Version', `${global.appInfo.version}`],
      ['Contributors', contributors.map((contributor) => contributor.name).join(', ')],
    ],
    license: `MIT, GPL-2.0, GPL-3.0, ${global.appInfo.license}`,
  });
};

function createTray() {
  logger.log("Creating Tray");
  const tray = new Tray(path.join(global.paths.app, 'ui', 'images', 'icons', '32x32.png'));
  tray.setToolTip('Bsky Desktop');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: global.appInfo.name, enabled: false },
    { type: 'separator' },
    {
      label: 'About', click() {
        showAboutWindow();
      }
    },
    { label: 'Quit', role: 'quit', click() { app.quit(); } }
  ]));
  tray.on('click', () => {
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
    }
  });
};

// Handle deeplinks:
function handleDeeplink(commandLine) {
  logger.debug(commandLine);
  let uri;

  try {
    // Extract the last element in the array
    uri = commandLine.pop();

    if (uri.startsWith(`${global.appInfo.deeplink}://`)) {
      logger.debug(`[DEEPLINK] Found URI: ${uri}`);
      uri = uri.split('/');
    } else {
      uri = ["none"];
    }
  } catch (error) {
    uri = ["none"];
  }

  logger.debug(`[DEEPLINK] Parsing URI: ${uri.join('/')}`);
  switch (uri[2]) {
    case "about":
      logger.log("[DEEPLINK] Show About Window");
      showAboutWindow();
      break;

    case "settings":
      switch (uri[3]) {
        case "general":
          logger.log("[DEEPLINK] Open General Settings");
          global.PageView.webContents.send('ui:openSettings', 'general');
          break;

        case "account":
          logger.log("[DEEPLINK] Open Account Settings");
          global.PageView.webContents.send('ui:openSettings', 'account');
          break;

        case "appearance":
          logger.log("[DEEPLINK] Open Appearance Settings");
          global.PageView.webContents.send('ui:openSettings', 'appearance');
          break;

        case "privacy":
          logger.log("[DEEPLINK] Open Privacy Settings");
          global.PageView.webContents.send('ui:openSettings', 'privacy-and-security');
          break;

        default:
          logger.warn("[DEEPLINK] Unknown settings command");
          break;
      };
      break;

    case "notiftest":
      global.PageView.webContents.send('ui:notif', { title: 'Updater', message: 'Update downloaded', options: { izitoast: { position: 'topRight', timeout: 5000, layout: 2, color: 'blue' } } });
      break;

    default:
      if (uri[0] !== 'none') {
        logger.warn("[DEEPLINK] Unknown command");
      }
      break;
  };
};

// Hanle ui: protocol,
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'ui',
    privileges: {
      secure: true,
      supportFetchAPI: true,
      bypassCSP: true
    }
  }
]);

// Main App Events:
app.whenReady().then(() => {
  logger.log("App Ready, Ensuring singleInstanceLock and registering deeplink");
  const gotTheLock = app.requestSingleInstanceLock();
  if (gotTheLock) {
    logger.log("SingleInstanceLock Acquired, Registering deeplink");
    if (process.defaultApp) {
      if (process.argv.length >= 2) {
        app.setAsDefaultProtocolClient(global.appInfo.deeplink, process.execPath, [path.resolve(process.argv[1])])
      }
    } else {
      app.setAsDefaultProtocolClient(global.appInfo.deeplink)
    };
    if (!process.defaultApp && process.argv.length >= 2) {
      logger.log("Handling deeplink from commandline");
      handleDeeplink(process.argv);
    };
    app.on('second-instance', (event, commandLine, workingDirectory) => {
      logger.log("Second Instance Detected, handling");
      handleDeeplink(commandLine);
      /*if (global.mainWindow) {
        if (global.mainWindow.isMinimized()) global.mainWindow.restore();
        global.mainWindow.focus();
      };*/
    });

    // Create persistent session for the app:
    const ses = session.fromPath(path.join(global.paths.data, 'session'), {
      cache: true,
      partition: 'persist:bsky',
      allowRunningInsecureContent: false,
      contextIsolation: true,
      enableRemoteModule: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
      webSecurity: true,
      worldSafeExecuteJavaScript: true,
      preload: path.join(global.paths.app, 'ui', 'preload.js'),
    });

    // Set UserAgent:
    ses.setUserAgent(`Mozilla/5.0 bsky-desktop/${global.appInfo.version} (Electron:${process.versions.electron};) Chrome:${process.versions.chrome};`);

    // Handle ui: protocol,
    ses.protocol.handle('ui', (req) => {
      // Log the incoming request URL for debugging
      //console.log('Request URL:', req.url);

      // Construct the correct file path
      const pathToMedia = path.join(__dirname, '..', 'ui', req.url.substring(5));
      //console.log('Path to media:', pathToMedia); // Log the resolved path

      // Determine MIME type based on the file extension
      const mimeType = req.url.endsWith('.css') ? 'text/css' :
        req.url.endsWith('.js') ? 'text/javascript' :
          req.url.endsWith('.png') ? 'image/png' :
            req.url.endsWith('.svg') ? 'image/svg+xml' :
              req.url.endsWith('.html') ? 'text/html' : 'application/octet-stream';  // Default binary mime type

      try {
        // Attempt to read the file synchronously
        const media = fs.readFileSync(pathToMedia);

        // Log success and return the response
        //console.log('File found and served successfully');
        return new Response(media, { // Pass the Buffer (binary data) as the body
          status: 200,
          headers: {
            'Content-Type': mimeType,
            'Access-Control-Allow-Origin': '*'
          }
        });

      } catch (error) {
        // Log the error if file is not found
        console.error('Error reading file:', error);

        return new Response('File not found', { // Send plain text error if file not found
          status: 404,
          headers: { 'Content-Type': 'text/plain' }
        });
      }
    });

    // Set session:
    global.session = ses;

    // Handle ipc for render:
    ipcMain.on('close-app', (event, arg) => {
      app.quit();
    });

    ipcMain.on('app:restart', (event, arg) => {
      app.relaunch();
      app.quit();
    });

    // Create windows and tray:
    createWindow();
    createTray();

    // Wait for splash screen to load before checking for updates, loading extensions and userstyles
    global.splash.webContents.on('did-finish-load', async () => {
      // Check for internet connection:
      logger.log("Checking for internet connection");
      require('dns').lookup('google.com', err => {
        if (err) {
          logger.log('No internet connection, showing not connected message');
          global.PageView.webContents.loadFile(path.join(global.paths.app, 'ui', 'offline.html'));
          return;
        }
        logger.log('Internet available, checking for updates');
        // Initialize the updater:
        logger.log("Initializing Updater");
        global.splash.webContents.send('ui:progtext', { title: 'Checking for updates...', subtitle: 'Awaiting response' });
        autoUpdater.checkForUpdates().then(async (result) => {
          //console.log(result);
          switch (result.code) {
            case 'update-available':
              global.isUpdating = true;
              logger.log("Update available, downloading");
              global.splash.webContents.send('ui:progtext', { title: 'Update available', subtitle: 'Downloading update' });
              try {
                const update = await autoUpdater.downloadUpdate();
                //console.log(update);
                if (update.err && update.err.code === 'unpackaged') {
                  logger.warn("Update failed to download, unpackaged app");
                  global.splash.webContents.send('ui:progtext', { title: 'Not downloading update', subtitle: 'Unpackaged app' });
                  global.isUpdating = false;
                } else {
                  if (update.err) {
                    logger.error("Update failed to download");
                    console.log(update.err);
                    global.splash.webContents.send('ui:progtext', { title: 'Failed to download update', subtitle: 'Continuing as normal...' });
                  };
                  switch (update.code) {
                    case 'downloaded':
                      logger.log("Update downloaded, installing");
                      global.splash.webContents.send('ui:progtext', { title: 'Update downloaded', subtitle: 'Installing update' });
                      try {
                        const install = await autoUpdater.installUpdate(update.path);
                        //console.log(install);
                        if (install.err) {
                          logger.error("Failed to install update");
                          console.log(install.err);
                          global.splash.webContents.send('ui:progtext', { title: 'Failed to install update', subtitle: 'Continuing as normal...' });
                        } else {
                          if (install.code === 'update-installed') {
                            logger.log("Update installed, restarting");
                            global.splash.webContents.send('ui:progtext', { title: 'Update installed', subtitle: 'Restarting...' });
                            app.relaunch();
                            app.quit();
                          } else {
                            logger.error("Failed to install update");
                            global.splash.webContents.send('ui:progtext', { title: 'Failed to install update', subtitle: 'Continuing as normal...' });
                          };
                        };
                      } catch (error) {
                        logger.error(`Error installing update:`, error);
                        global.splash.webContents.send('ui:progtext', { title: 'Error installing update', subtitle: ' ' });
                      };
                      break;
                    case 'download-failed':
                      logger.error("Failed to download update");
                      global.splash.webContents.send('ui:progtext', { title: 'Failed to download update', subtitle: 'Continuing as normal...' });
                      global.isUpdating = false;
                      global.mainWindow.show();
                      global.splash.destroy();
                      break;
                    default:
                      logger.error("Unknown update download status");
                      global.splash.webContents.send('ui:progtext', { title: 'Unknown update download status', subtitle: ' ' });
                      break;
                  };
                };
              } catch (error) {
                logger.error(`Error downloading update:`, error);
                global.splash.webContents.send('ui:progtext', { title: 'Error downloading update', subtitle: ' ' });
              };
              break;
            case 'no-update':
              logger.log("No update available");
              global.splash.webContents.send('ui:progtext', { title: 'Checking for updates...', subtitle: 'Up to date!' });
              break;
            case 'check-failed':
              logger.warn("Failed to check for updates");
              global.splash.webContents.send('ui:progtext', { title: 'Failed to check for updates', subtitle: ' ' });
              break;
            case 'old-os':
              logger.warn("Old OS, unable to update");
              global.splash.webContents.send('ui:progtext', { title: 'Update not available', subtitle: 'Old OS' });
              break;
            default:
              logger.warn("Unknown update status");
              global.splash.webContents.send('ui:progtext', { title: 'Unknown update status', subtitle: ' ' });
              break;
          };
        }).catch((error) => {
          logger.error(`Error checking for updates: ${error}`);
          global.splash.webContents.send('ui:progtext', { title: 'Error checking for updates', subtitle: ' ' });
        }).finally(async () => {
          // Load extensions (.crx files):
          logger.log("Checking for extensions");
          global.splash.webContents.send('ui:progtext', { title: 'Checking for extensions', subtitle: ' ' });
          const extensions = fs.readdirSync(global.paths.extensions).filter((file) => file.endsWith('.crx'));
          if (extensions.length > 0) {
            logger.log(`Unpacking ${extensions.length} extensions and loading them`);
            global.splash.webContents.send('ui:progtext', { title: `Unpacking ${extensions.length} extensions` });
            extensions.forEach((extension) => {
              logger.log(`Loading extension: ${extension}`);
              global.splash.webContents.send('ui:progtext', { title: `Loading extension: ${extension}` });
              loadCRX(path.join(global.paths.extensions, extension));
            });
          } else {
            // Check for unpacked extensions:
            const unpackedExtensions = fs.readdirSync(global.paths.extensions).filter((file) => fs.lstatSync(path.join(global.paths.extensions, file)).isDirectory());

            // Check if the directory contains a manifest.json file
            unpackedExtensions.forEach((extension) => {
              const manifestPath = path.join(global.paths.extensions, extension, 'manifest.json');
              if (fs.existsSync(manifestPath)) {
                logger.log(`Loading unpacked extension: ${extension}`);
                global.splash.webContents.send('ui:progtext', { title: `Loading unpacked extension: ${extension}` });
                session.defaultSession.loadExtension(path.join(global.paths.extensions, extension)).then(({ id }) => {
                  logger.log(`Extension loaded with ID: ${id}`);
                }).catch((error) => {
                  logger.error(`Failed to load extension: ${error}`);
                });
              } else {
                logger.warn(`Skipping directory ${extension} as it does not contain a manifest.json file`);
              };
            });
          };

          // Load userstyles
          logger.log("Checking for userstyles");
          global.splash.webContents.send('ui:progtext', { title: 'Checking for userstyles' });
          const userStylesDir = path.join(global.paths.userstyles);
          if (fs.existsSync(userStylesDir)) {
            const files = fs.readdirSync(userStylesDir).filter((file) => file.endsWith('.css'));
            if (files.length > 0) {
              logger.log(`Loading ${files.length} userstyles`);
              const userStylePromises = files.map(async file => {
                const cssFile = path.join(userStylesDir, file);
                // Parse the CSS file
                try {
                  const cssContent = fs.readFileSync(cssFile, 'utf-8');
                  const result = await userStyles.parseCSS(cssContent);

                  logger.info(`Loading userstyle: ${result.metadata.name}`);

                  // Compile the userstyle
                  const compiled = await userStyles.compileStyle(result.css, result.metadata);

                  // Check if the site 'bsky.app' is defined
                  if (compiled.sites?.['bsky.app']) {
                    // Apply the userstyle to the PageView
                    await PageView.webContents.insertCSS(compiled.sites['bsky.app']);

                    logger.info(`Applied userstyle: ${result.metadata.name}`);
                    global.splash.webContents.send('ui:progtext', { title: `Applied userstyle: ${result.metadata.name}` });
                  } else {
                    if (compiled.error) {
                      logger.warn(`Error loading userstyle: ${compiled.error.message}`);
                    } else {
                      logger.warn(`Userstyle ${result.metadata.name} does not target 'bsky.app'`);
                    }
                  }
                } catch (error) {
                  logger.error(`Error loading userstyle: ${file}`, error);
                }
              });

              await Promise.all(userStylePromises);
            }
          }
        });
      });
    });
  } else {
    logger.log("Failed to get singleInstanceLock, Quitting");
    app.quit();
  };
});

app.on('open-url', (event, url) => {
  event.preventDefault();
  handleDeeplink([url]);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  };
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('before-quit', () => {
  logger.log('[Before Quit] Shutting down logger and quitting');
  log4js.shutdown();
});