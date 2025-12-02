const { app, BrowserWindow, WebContentsView, safeStorage, globalShortcut, ipcMain, Tray, Menu, protocol, session, dialog, nativeImage } = require("electron");
const electronremote = require("@electron/remote/main");
const admzip = require("adm-zip");
const log4js = require("log4js");
const path = require("path");
const fs = require("fs");
const os = require("os");
require('v8-compile-cache');

// Load package.json, contributors.json, and config.js:
const packageJson = require(path.join(__dirname, '..', '..', 'package.json'));
const contributors = require(path.join(__dirname, 'contributors.json'));
const initConfig = require(path.join(__dirname, 'config.js'));
config = initConfig(app, packageJson);
global.config = config;
global.app_settings = config.app_settings;
global.appInfo = config.app;
global.paths = config.paths;
global.urls = config.urls;

// Local modules
const windowStateKeeper = require("./module/window-state/index");
const { setupTitlebar, attachTitlebarToWindow } = require("./module/titlebar/main");
const AboutWindow = require("./module/about-window/src/index").default;
const badge = require('./module/badge');
const autoUpdater = require('./module/updater/auto-update');
const loadCRX = require('./utils/loadCRX');
const userStyles = require('./utils/userStyles');

// Development mode check:
const isDev = !app.isPackaged && (fs.existsSync(path.join(global.paths.data, ".dev")) || fs.existsSync(path.join(global.paths.data, ".debug")));

/* Logging */
// Create logs directory if it does not exist
if (!fs.existsSync(global.paths.logs)) {
  fs.mkdirSync(global.paths.logs, { recursive: true });
};
const logFileName = 'BSKY-DESKTOP';
const logFile = path.join(global.paths.data, `${logFileName}.log`);
log4js.configure({
  appenders: {
    stdout: { type: "stdout" },
    bskydesktop: {
      type: "file",
      filename: `${logFile}`,
      maxLogSize: 10 * 1024 * 1024,
      backups: 5,
      compress: true
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
logger.level = isDev ? "debug" : "info";
// if logfile already exists, rename it unless the lock file is present
// rotate + zip old logs if present
if (fs.existsSync(logFile) && !fs.existsSync(path.join(global.paths.data, "lockfile"))) {
  const stats = fs.statSync(logFile);
  const mtime = new Date(stats.mtime);
  const now = new Date();

  const isOld = mtime.toDateString() !== now.toDateString() || (now - mtime) > 5000; // 5s old or different day

  if (isOld) {
    const timestamp = mtime.toISOString().replace(/[:.]/g, "-");
    const rotatedName = `${logFileName}.${timestamp}.log`;
    const rotatedPath = path.join(global.paths.logs, rotatedName);

    // rename to timestamped file
    fs.renameSync(logFile, rotatedPath);

    // zip the old log
    const zip = new admzip();
    zip.addLocalFile(rotatedPath);
    const zipPath = rotatedPath.replace(/\.log$/, ".zip");
    zip.writeZip(zipPath);

    // remove the uncompressed rotated log
    fs.unlinkSync(rotatedPath);

    logger.info(`Old log rotated and zipped: ${zipPath}`);

    // enforce max of 5 log archives
    const files = fs
      .readdirSync(global.paths.data)
      .filter(f => f.startsWith(logFileName) && f.endsWith(".zip"))
      .map(f => path.join(global.paths.data, f))
      .sort((a, b) => fs.statSync(b).mtime - fs.statSync(a).mtime); // newest first

    if (files.length > 5) {
      const toDelete = files.slice(5); // keep newest 5
      toDelete.forEach(f => {
        fs.unlinkSync(f);
        logger.info(`Old log deleted: ${f}`);
      });
    }
  }
}
if (logger.isDebugEnabled()) {
  console.log(`Running in ${isDev ? 'development' : 'production'} mode`);
  console.log(`config:`, config);
}
logger.log(`Starting ${global.appInfo.name} v${packageJson.version} on ${os.platform()} ${os.arch()}`);

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

// User config
const userConfigPath = path.join(global.paths.data, 'config.json');
let userConfig = fs.existsSync(userConfigPath) ? JSON.parse(fs.readFileSync(userConfigPath)) : {};
global.userConfig = userConfig;

// Performance
if (process.platform !== 'win32' && process.platform !== 'darwin') {
  logger.log('Disabling Transparent Visuals');
  app.commandLine.appendSwitch('disable-transparent-visuals');
} else {
  // GPU-boosting flags only when GPU is allowed
  app.commandLine.appendSwitch('enable-features', 'UseSkiaRenderer');
  app.commandLine.appendSwitch('enable-zero-copy');
  app.commandLine.appendSwitch('ignore-gpu-blacklist');
  app.commandLine.appendSwitch('enable-native-gpu-memory-buffers');
  app.commandLine.appendSwitch('enable-gpu-rasterization');
}

// General performance flags (Disable unneeded features, increase memory limits)
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion,Translate,AutofillServerCommunication,Autofill,BackgroundSync');
app.commandLine.appendSwitch("disable-shared-dictionary");
app.commandLine.appendSwitch("disable-spell-checking");
app.commandLine.appendSwitch("disable-spellchecking-dictionaries");
app.commandLine.appendSwitch('js-flags', '--expose-gc --max-old-space-size=4096 --gc-global --always-compacts');
app.commandLine.appendSwitch('process-per-site');

// Handle garbage collection (every 60s)
if (global.gc) {
  logger.log('Manual GC enabled');
  setInterval(() => {
    if (global.gc) {
      logger.log('Running manual GC...')
      global.gc()
    }
  }, 60000);
};

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
    defaultWidth: 1280,
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
    icon: path.join(global.paths.app, 'ui', 'img', 'logo.png'),
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
    titleBarStyle: 'hidden',
    titleBarOverlay: process.platform === 'darwin' ? false : true,
    icon: path.join(global.paths.app, 'ui', 'img', 'logo.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  }));
  mainWindowState.manage(mainWindow);
  mainWindow.hide();
  logger.log("Creating Title Bar View");
  const titlebarWindow = (global.titlebarWindow = new WebContentsView({
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      preload: path.join(global.paths.app, 'ui', 'preload-titlebar.js')
    }
  }));
  titlebarWindow.webContents.loadFile(path.join(global.paths.app, 'ui', 'titlebar.html'));
  const PageView = (global.PageView = new WebContentsView({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(global.paths.app, 'ui', 'preload.js'),
      session: global.ses
    },
  }));
  PageView.webContents.loadURL(global.urls.main);
  mainWindow.contentView.addChildView(titlebarWindow);
  mainWindow.contentView.addChildView(PageView);
  mainWindow.setMenu(null);

  function updateViewBounds() {
    const contentBounds = mainWindow.contentView.getBounds();
    const contentWidth = Math.round(contentBounds.width);
    const contentHeight = Math.round(contentBounds.height);

    // On macOS, offset the title bar slightly to account for the traffic lights
    const titleBarHeight = 30;
    const titleBarOffset = process.platform === 'darwin' ? titleBarHeight - 2 : 0;
    const pageViewHeight = Math.max(0, contentHeight - titleBarHeight);

    titlebarWindow.setBounds({
      x: 0,
      y: titleBarOffset,
      width: contentWidth,
      height: titleBarHeight,
    });

    PageView.setBounds({
      x: 0,
      y: titleBarHeight + titleBarOffset,
      width: contentWidth,
      height: pageViewHeight,
    });
  }

  // Basic resize
  mainWindow.on("resize", updateViewBounds);

  // On maximize/unmaximize, delay slightly to ensure full layout
  mainWindow.on("maximize", () => setTimeout(updateViewBounds, 50));
  mainWindow.on("unmaximize", () => setTimeout(updateViewBounds, 50));

  // Save window state on close
  mainWindow.on("close", (event) => {
    mainWindowState.saveState(mainWindow);

    if (global.app_settings?.trayOptions?.closeToTray === true && !global.config.runtime.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  // Set initial bounds
  setImmediate(updateViewBounds);

  // Badge count: (use mainWindow as that shows the badge on the taskbar)
  new badge(mainWindow, global.app_settings.badgeOptions);

  logger.log("Main Window Created, Showing splashscreen");
  splash.show();

  logger.log("Attaching Titlebar to Main Window");
  attachTitlebarToWindow(titlebarWindow);

  // DevTools:
  //splash.webContents.openDevTools();
  //mainWindow.webContents.openDevTools();
  //titlebarWindow.webContents.openDevTools();
  //PageView.webContents.openDevTools();

  logger.log("Initializing @electron/remote");
  electronremote.initialize();
  //electronremote.enable(titlebarWindow.webContents);
  electronremote.enable(PageView.webContents);

  // PageView Events:
  PageView.webContents.setWindowOpenHandler(({ url }) => {
    new BrowserWindow({ show: true, autoHideMenuBar: true, icon: path.join(global.paths.app, 'ui', 'img', 'logo.png') }).loadURL(url);
    return { action: 'deny' };
  });
};

function showAboutWindow() {
  AboutWindow({
    //open_devtools: isDev,
    icon_path: path.join(global.paths.app, 'ui', 'img', 'logo.png'),
    package_json_dir: global.paths.app_root,
    product_name: global.appInfo.name,
    license: global.appInfo.license,
    css_path: path.join('styles', 'ui-dark.css'),
    use_version_info: [
      ['Application Version', `${global.appInfo.version}`],
      ['Contributors', contributors.map((contributor) => contributor.name).join(', ')],
    ],
  });
};

function createTray() {
  logger.log("Creating Tray");
  const logoImage = nativeImage.createFromPath(path.join(global.paths.app, 'ui', 'img', 'logo.png')).resize({ width: 16, height: 16 });
  const tray = new Tray(logoImage);
  tray.setToolTip(global.appInfo.name);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: global.appInfo.name, enabled: false, icon: logoImage },
    { type: 'separator' },
    {
      label: 'About', click() {
        showAboutWindow();
      }
    },
    { label: 'Quit', role: 'quit', click() { app.quit(); } }
  ]));
  tray.on('click', () => {
    if (global.mainWindow.isVisible() && !global.mainWindow.isFocused()) {
      global.mainWindow.focus();
    } else {
      global.mainWindow.show();
      if (global.mainWindow.isMinimized()) {
        global.mainWindow.restore();
      }
      global.mainWindow.focus();
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

// Register app protocol to handle app:// requests
function handleAppProtocol(session) {
  session.protocol.handle('app', async (req) => {
    const { host, pathname } = new URL(req.url);

    //console.log(`App Protocol Request: host=${host}, pathname=${pathname}`);

    if (host === 'ui') {
      const baseDir = path.join(__dirname, '..', 'ui');
      const pathToServe = path.resolve(baseDir, '.' + pathname);

      const relativePath = path.relative(baseDir, pathToServe);
      const isSafe = relativePath && !relativePath.startsWith('..') && !path.isAbsolute(relativePath);

      if (!isSafe) {
        return new Response('Bad request', { status: 400 });
      }

      try {
        const data = fs.readFileSync(pathToServe);
        const mimeType = pathname.endsWith('.css') ? 'text/css' : 'application/octet-stream';
        return new Response(data, {
          status: 200,
          headers: { 'Content-Type': mimeType, 'Access-Control-Allow-Origin': '*' }
        });
      } catch (error) {
        //console.error(`Error serving app protocol for ${req.url}:`, error);
        return new Response('File not found', { status: 404 });
      }
    } else {
      //console.warn(`Unhandled app protocol host: ${host}`);
      return new Response('Not found', { status: 404 });
    }
  });
}

const secureAppProtocol = [
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      bypassCSP: true
    }
  }
];
protocol.registerSchemesAsPrivileged(secureAppProtocol);

// Main App Events:
app.whenReady().then(async () => {
  logger.log('App reports ready, Checking if packaged...');
  // Check if app is run from the installer dmg (macOS)
  if (process.platform === 'darwin' && app.isPackaged && !app.isInApplicationsFolder()) {
    const { response } = await dialog.showMessageBox({
      type: 'question',
      buttons: ['Move to Applications folder', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
      title: 'Move to Applications folder',
      message: 'To ensure the app works correctly, please move it to the Applications folder. Would you like to do that now?'
    });

    if (response === 0) {
      app.moveToApplicationsFolder();
    } else {
      await dialog.showMessageBox({
        type: 'error',
        buttons: ['OK'],
        title: 'Move to Applications folder',
        message: 'Please move the app to the Applications folder to ensure it works correctly.'
      });
      return app.quit(); // Prevent further execution
    }
  };

  logger.log("App Ready, Ensuring singleInstanceLock and registering deeplink");
  const gotTheLock = app.requestSingleInstanceLock();
  if (gotTheLock) {
    logger.log("SingleInstanceLock Acquired, Registering deeplink");
    if (process.defaultApp) {
      if (process.argv.length >= 2) {
        global.appInfo.deeplink.forEach((protocol) => {
          app.setAsDefaultProtocolClient(protocol, process.execPath, [path.resolve(process.argv[1])])
        });
      }
    } else {
      global.appInfo.deeplink.forEach((protocol) => {
        app.setAsDefaultProtocolClient(protocol)
      });
    };
    if (!process.defaultApp && process.argv.length >= 2) {
      logger.log("Handling deeplink from commandline");
      handleDeeplink(process.argv);
    };
    app.on('second-instance', (event, commandLine, workingDirectory) => {
      logger.log("Second Instance Detected, handling");
      handleDeeplink(commandLine);
      if (global.mainWindow) {
        if (global.mainWindow.isMinimized()) global.mainWindow.restore();
        if (!global.mainWindow.isVisible()) global.mainWindow.show();
        global.mainWindow.focus();
      };
    });

    // Check if safeStorage is available:
    if (safeStorage.isEncryptionAvailable()) {
      logger.log("SafeStorage is available, enabling encryption.");
      global.safeStorage = safeStorage;
    } else {
      logger.warn("SafeStorage is not available, encryption will not be used.");
      global.safeStorage = require('./module/safeStorage');
    };

    // Create persistent session for the app:
    global.ses = session.fromPath(path.join(global.paths.data, 'session'), {
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

    // Handle app protocol
    handleAppProtocol(global.ses);
    handleAppProtocol(session.defaultSession);

    // Set UserAgent:
    ses.setUserAgent(`Mozilla/5.0 bsky-desktop/${global.appInfo.version} (Electron:${process.versions.electron};) Chrome:${process.versions.chrome};`);

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
                console.log(update);
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

          const onPageLoaded = () => {
            setTimeout(() => {
              global.config.runtime.isReady = true;

              if (!global.PageView.webContents.isLoading()) {
                setTimeout(() => {
                  global.mainWindow.show();
                  global.splash.destroy();
                  global.mainWindow.focus();
                }, 1000);
              }
            }, 1000);
          };

          // Add event listener for PageView
          global.PageView.webContents.on('did-finish-load', onPageLoaded);

          // All done, we're ready to show the main window (when the page is loaded)
          global.splash.webContents.send('ui:progtext', { title: 'Loading app...', subtitle: ' ' });
          global.config.runtime.isReady = true;
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