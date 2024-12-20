const { app, BrowserWindow, BrowserView, globalShortcut, ipcMain, Tray, Menu, protocol, session } = require("electron");
const electronremote = require("@electron/remote/main");
//const asar = require('@electron/asar');
const windowStateKeeper = require("electron-window-state");
const { setupTitlebar, attachTitlebarToWindow } = require("./titlebar/main");
const openAboutWindow = require("./about-window/src/index").default;
const badge = require('./badge');
const contextMenu = require('./context-menu');
const autoUpdater = require('./utils/auto-update');
//const loadCRX = require('./utils/loadCRX');
const log4js = require("log4js");
const path = require("path");
const fs = require("fs");
const os = require("os");
require('v8-compile-cache');

const packageJson = require(path.join(__dirname, '..', '..', 'package.json'));

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
global.paths.updateDir = path.join(global.paths.data, 'update');

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
logger.log("Starting Bsky Desktop");

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
    globalShortcut.register("CommandOrControl+R", () => {
      //console.log("CommandOrControl+R is pressed: Shortcut Disabled");
    });
    globalShortcut.register("F5", () => {
      //console.log("F5 is pressed: Shortcut Disabled");
    });
  });
  app.on('browser-window-blur', function () {
    globalShortcut.unregister('CommandOrControl+R');
    globalShortcut.unregister('F5');
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
    width: mainWindow.getBounds().width,
    height: mainWindow.getBounds().height - 30,
  });
  mainWindow.on("resize", () => {
    PageView.setBounds({
      x: 0,
      y: 30,
      width: mainWindow.getBounds().width,
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
    new BrowserWindow({ show: true, autoHideMenuBar: true }).loadURL(url);
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
    ],
    license: `MIT, GPL-2.0, GPL-3.0, ${global.appInfo.license}`,
  });
};

function createTray() {
  logger.log("Creating Tray");
  const tray = new Tray(path.join(global.paths.app, 'ui', 'images', 'logo.png'));
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
      global.PageView.webContents.send('ui:notif', { title: 'Updater', message: 'Update downloaded', options: { position: 'topRight', timeout: 5000, layout: 2, color: 'blue' } });
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

    // Initialize the updater:
    logger.log("Initializing Updater");
    autoUpdater();

    // Handle ipc for render:
    ipcMain.on('close-app', (event, arg) => {
      app.quit();
    });

    createWindow();
    createTray();
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