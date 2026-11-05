const { app, BrowserWindow, WebContentsView, safeStorage, globalShortcut, ipcMain, Tray, Menu, protocol, session, dialog, nativeImage, nativeTheme } = require("electron");
const electronremote = require("@electron/remote/main");
const notifier = require('node-notifier');
const admzip = require("adm-zip");
const log4js = require("log4js");
const { applyCommandLineFlags, startMemoryMonitor, getRecommendedWebPreferences, attachWindowMemoryOptimizations } = require('electron-performance');
const path = require("path");
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
require('v8-compile-cache');

// Load package.json, contributors.json, and config.js
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
const { initAboutWindow, openAboutWindow } = require("./module/about-window/src/index");
const badge = require('./module/badge');
const autoUpdater = require('./module/updater/auto-update');
const loadCRX = require('./utils/loadCRX');
const linuxSandbox = require('./utils/linuxSandbox');
const appearance = require('./utils/appearance');
const settings = require('./utils/settings');
const { initSettingsWindow, openSettingsWindow } = require('./module/settings');
const { initUserstyles } = require('./module/userstyles');

// Development mode check
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

// Create data directory if it does not exist
if (!fs.existsSync(global.paths.data)) {
  logger.info("Creating Data Directory");
  fs.mkdirSync(global.paths.data, { recursive: true });
};

// Create temp directory if it does not exist
if (!fs.existsSync(global.paths.temp)) {
  logger.info("Creating Temp Directory");
  fs.mkdirSync(global.paths.temp, { recursive: true });
};

// Create user directory if it does not exist
if (!fs.existsSync(global.paths.user)) {
  logger.info("Creating User Directory");
  fs.mkdirSync(global.paths.user, { recursive: true });
};

// Create extensions directory if it does not exist
if (!fs.existsSync(global.paths.extensions)) {
  logger.info("Creating Extensions Directory");
  fs.mkdirSync(global.paths.extensions, { recursive: true });
};

// Create userstyles directory if it does not exist
if (!fs.existsSync(global.paths.userstyles)) {
  logger.info("Creating Userstyles Directory");
  fs.mkdirSync(global.paths.userstyles, { recursive: true });
};

// Create update directory if it does not exist
if (!fs.existsSync(global.paths.updateDir)) {
  logger.info("Creating Update Directory");
  fs.mkdirSync(global.paths.updateDir, { recursive: true });
};

// User config (settings shown in the settings window: src/app/utils/settings.js)
const userConfigPath = path.join(global.paths.user, 'config.json');
let userConfig = {};
if (fs.existsSync(userConfigPath)) {
  try {
    userConfig = JSON.parse(fs.readFileSync(userConfigPath, 'utf8'));
    logger.log('Loaded user config from file');
  } catch (error) {
    logger.error('Failed to parse user config, using defaults:', error);
  }
}
global.userConfig = userConfig;
settings.init(userConfigPath, userConfig);

// Settings from before the settings window: "Close to tray" moved from appearance to general
if (typeof userConfig.appearance?.closeToTray === 'boolean' && userConfig.general?.closeToTray === undefined) {
  settings.set('general.closeToTray', userConfig.appearance.closeToTray);
}

function saveUserConfig() {
  fs.writeFileSync(userConfigPath, JSON.stringify(userConfig, null, 2), 'utf8');
}

// Performance tuning (memory/CPU): tiered Chromium/V8 flags + runtime GC/cache monitor.
// See electron-performance package. Must run before app is ready.
const perfLogger = { log: (...a) => logger.log(...a), debug: (...a) => logger.debug(...a), error: (...a) => logger.error(...a) };
const perfSystem = applyCommandLineFlags(app, { logger: perfLogger });
logger.log(
  `Performance tuning applied: memTier=${perfSystem.memoryTier}` +
  (perfSystem.pi.isRaspberryPi ? ` pi=gen${perfSystem.pi.generation}` : '') +
  ` gpu=${perfSystem.gpu.discrete.length ? 'discrete' : perfSystem.gpu.physical.length ? 'integrated' : 'none'}`
);

let memoryMonitor;
let lastGcTime = Date.now();
const GC_COOLDOWN = (perfSystem.pi.isRaspberryPi && perfSystem.pi.generation <= 3) ? 5000 : 10000;
app.on('ready', () => {
  memoryMonitor = startMemoryMonitor({ app, BrowserWindow }, { system: perfSystem, logger: perfLogger });
});

// Linux sandbox fallback: Chromium needs either a setuid-root chrome-sandbox or working
// unprivileged user namespaces. On Ubuntu 23.10+ the latter requires an AppArmor profile
// for this exact binary; the .deb/.rpm postinst installs one, AppImage/zip builds get one
// offered at runtime (see linuxSandbox / whenReady below). When neither works, fall back to
// --no-sandbox so Chromium doesn't abort at startup. Don't force --no-sandbox otherwise: it
// throws away working sandboxing. Must run before app is ready.
let linuxSandboxStatus = 'ok';
if (process.platform === 'linux') {
  try {
    linuxSandboxStatus = linuxSandbox.getSandboxStatus();
  } catch (err) {
    logger.log(`Could not determine sandbox availability: ${err.message}`);
    linuxSandboxStatus = 'unavailable';
  }
  if (linuxSandboxStatus !== 'ok') {
    logger.log(`Linux sandbox status: ${linuxSandboxStatus}; falling back to --no-sandbox`);
    app.commandLine.appendSwitch('no-sandbox');
  }
}

// Offer to install an AppArmor profile so AppImage/zip builds can run sandboxed.
// Returns true when the app is relaunching.
async function maybeInstallAppArmorProfile() {
  if (linuxSandboxStatus !== 'needs-profile' || !app.isPackaged || userConfig.apparmorPrompt === false) return false;

  const { response, checkboxChecked } = await dialog.showMessageBox({
    type: 'question',
    buttons: ['Install', 'Not now'],
    defaultId: 0,
    cancelId: 1,
    title: 'Enable sandbox',
    message: `${global.appInfo.name} is running without Chromium's sandbox.`,
    detail: 'Your system restricts user namespaces via AppArmor. Installing a small AppArmor profile (requires your password) lets the app run sandboxed. The app will restart afterwards.',
    checkbox: "Don't ask again",
  });
  if (response !== 0) {
    if (checkboxChecked) {
      userConfig.apparmorPrompt = false;
      saveUserConfig();
    }
    return false;
  }

  const result = linuxSandbox.installProfile(global.paths.temp);
  if (!result.ok) {
    if (!result.cancelled) {
      logger.error(`AppArmor profile install failed: ${result.error}`);
      dialog.showErrorBox('Enable sandbox', `Could not install AppArmor profile:\n${result.error}`);
    }
    return false;
  }

  logger.log('AppArmor profile installed, relaunching');
  app.relaunch(linuxSandbox.relaunchOptions());
  app.exit(0);
  return true;
}

// Splash progress text. The splash is destroyed once the main window shows, which can
// happen while startup is still running, so a send to it must not throw.
function splashProgress(progress) {
  if (global.splash && !global.splash.isDestroyed()) global.splash.webContents.send('ui:progtext', progress);
}

// Desktop appearance (Linux: follow the GTK theme, see utils/appearance.js)
let appAppearance = null;
function loadAppearance() {
  appAppearance = appearance.getAppearance({ useGtkTheme: settings.get('appearance.useGtkTheme') });
  nativeTheme.themeSource = appearance.getThemeSource(appAppearance);
  if (appAppearance.gtk) logger.log(`Following GTK theme ${appAppearance.gtk.name}`);
}
loadAppearance();

// setup the titlebar main process:
setupTitlebar();

// Initialize the about window
initAboutWindow({
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

// Disable reload and F5 if not in dev mode: (This code is kept for future use, currently disabled as there is no use for this currently)
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
    roundedCorners: true,
    icon: path.join(global.paths.app, 'ui', 'img', 'logo.png'),
    skipTaskbar: true,
    webPreferences: getRecommendedWebPreferences({
      nodeIntegration: true,
      contextIsolation: false
    })
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
    roundedCorners: true,
    titleBarStyle: 'hidden',
    // Native overlay controls don't render on the transparent Linux window; the titlebar
    // draws its own there. macOS uses the traffic lights.
    titleBarOverlay: process.platform === 'win32',
    // Transparent on Linux so the views' rounded corners show the desktop behind them
    ...(process.platform === 'linux' ? { transparent: true, backgroundColor: '#00000000' } : {}),
    icon: path.join(global.paths.app, 'ui', 'img', 'logo.png'),
    webPreferences: getRecommendedWebPreferences({
      nodeIntegration: false,
      contextIsolation: true
    })
  }));
  mainWindowState.manage(mainWindow);
  mainWindow.hide();
  attachWindowMemoryOptimizations(mainWindow, {
    onSettleHidden: () => memoryMonitor?.forceGc(),
    logger: perfLogger
  });
  logger.log("Creating Title Bar View");
  const titlebarWindow = (global.titlebarWindow = new WebContentsView({
    webPreferences: getRecommendedWebPreferences({
      nodeIntegration: true,
      contextIsolation: false,
      preload: path.join(global.paths.app, 'ui', 'preload-titlebar.js')
    })
  }));
  titlebarWindow.webContents.loadFile(path.join(global.paths.app, 'ui', 'titlebar.html'));
  const PageView = (global.PageView = new WebContentsView({
    webPreferences: getRecommendedWebPreferences({
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(global.paths.app, 'ui', 'preload.js'),
      session: global.ses
    }),
  }));
  // Userstyles: applied on every page load, managed from the settings window
  initUserstyles({ dir: global.paths.userstyles, site: new URL(global.urls.main).hostname, webContents: PageView.webContents });
  // Nothing is loaded here: startup loads the main page (or the offline page) behind the
  // splash and reveals the window when it has loaded.
  mainWindow.contentView.addChildView(titlebarWindow);
  mainWindow.contentView.addChildView(PageView);
  mainWindow.setMenu(null);

  // Rounded corners like GTK/libadwaita on Linux (Windows 11 and macOS round natively):
  // rounded when floating, square when maximized or fullscreen. setBorderRadius only takes
  // one radius for all four corners, so the titlebar view is made taller and PageView,
  // stacked above it, covers its rounded bottom. PageView's own rounded top corners then
  // show that hidden strip, which syncSeamColors paints the page's background so the seam
  // between them looks square.
  const windowCornerRadius = 12;
  function currentCornerRadius() {
    if (process.platform !== 'linux') return 0;
    return mainWindow.isMaximized() || mainWindow.isFullScreen() ? 0 : windowCornerRadius;
  }

  const titleBarHeight = 30;
  function updateViewBounds() {
    const contentBounds = mainWindow.contentView.getBounds();
    const contentWidth = Math.round(contentBounds.width);
    const contentHeight = Math.round(contentBounds.height);

    // On macOS, offset the page view slightly to account for the traffic lights
    const titleBarOffset = process.platform === 'darwin' ? titleBarHeight - 2 : titleBarHeight;
    const pageViewHeight = Math.max(0, contentHeight - titleBarOffset);
    const radius = currentCornerRadius();

    titlebarWindow.setBorderRadius(radius);
    PageView.setBorderRadius(radius);

    titlebarWindow.setBounds({
      x: 0,
      y: 0,
      width: contentWidth,
      // 2x radius: the strip behind PageView's rounded top corners must itself sit above
      // this view's own rounded bottom corners, or both cut-outs overlap and show through
      height: titleBarHeight + radius * 2,
    });

    PageView.setBounds({
      x: 0,
      y: titleBarOffset,
      width: contentWidth,
      height: pageViewHeight,
    });
  }

  // Basic resize
  mainWindow.on("resize", updateViewBounds);

  // On maximize/unmaximize and fullscreen, delay slightly to ensure full layout
  mainWindow.on("maximize", () => setTimeout(updateViewBounds, 50));
  mainWindow.on("unmaximize", () => setTimeout(updateViewBounds, 50));
  mainWindow.on("enter-full-screen", () => setTimeout(updateViewBounds, 50));
  mainWindow.on("leave-full-screen", () => setTimeout(updateViewBounds, 50));

  // Sample the page background at its top-left/top-right corners for the titlebar strip
  // behind PageView's rounded top corners (see updateViewBounds).
  function syncSeamColors() {
    if (process.platform !== 'linux') return;
    PageView.webContents.executeJavaScript(`(() => {
      // Composite the (often translucent) backgrounds stacked at a point into one opaque color
      const bgAt = (x, y) => {
        const layers = [];
        for (let el = document.elementFromPoint(x, y); el; el = el.parentElement) {
          const m = getComputedStyle(el).backgroundColor.match(/[\\d.]+/g);
          if (!m) continue;
          const [r, g, b, a = 1] = m.map(Number);
          if (a > 0) layers.push([r, g, b, a]);
          if (a >= 1) break;
        }
        let out = matchMedia('(prefers-color-scheme: dark)').matches ? [0, 0, 0] : [255, 255, 255];
        for (const [r, g, b, a] of layers.reverse()) {
          out = [r * a + out[0] * (1 - a), g * a + out[1] * (1 - a), b * a + out[2] * (1 - a)];
        }
        return 'rgb(' + out.map(Math.round).join(', ') + ')';
      };
      return [bgAt(1, 1), bgAt(innerWidth - 2, 1)];
    })()`).then(([left, right]) => {
      titlebarWindow.webContents.send('titlebar:setSeamColors', left, right);
    }).catch((err) => logger.debug(`Could not sample page colors: ${err.message}`));
  }
  PageView.webContents.on('did-finish-load', syncSeamColors);
  PageView.webContents.on('did-navigate-in-page', syncSeamColors);
  nativeTheme.on('updated', () => setTimeout(syncSeamColors, 500));

  // Titlebar color: the GTK theme's headerbar color when following it (Linux), otherwise
  // the color the page asks for (titlebar:setColor) or the titlebar's default
  function syncTitlebarColor() {
    const color = appearance.getTitlebarColor(appAppearance);
    if (color) titlebarWindow.webContents.send('titlebar:setColor', color);
  }
  titlebarWindow.webContents.on('did-finish-load', syncTitlebarColor);

  // Appearance setting changed, or the desktop theme changed while running
  function refreshAppearance() {
    const before = JSON.stringify(appAppearance);
    loadAppearance();
    if (JSON.stringify(appAppearance) === before) return;
    syncTitlebarColor();
    setTimeout(syncSeamColors, 500);
  }
  settings.onChange('appearance.useGtkTheme', refreshAppearance);
  if (process.platform === 'linux') {
    const monitor = spawn('gsettings', ['monitor', 'org.gnome.desktop.interface'], { stdio: ['ignore', 'pipe', 'ignore'] });
    let pending = null;
    monitor.on('error', () => { }); // no gsettings: nothing to follow
    monitor.stdout.on('data', (data) => {
      if (!/gtk-theme|color-scheme|accent-color/.test(data.toString())) return;
      clearTimeout(pending);
      pending = setTimeout(refreshAppearance, 300);
    });
    app.on('will-quit', () => monitor.kill());
  }

  // Ctrl/Cmd+, opens settings, like macOS apps
  const openSettingsShortcut = (event, input) => {
    if (input.type === 'keyDown' && input.key === ',' && (process.platform === 'darwin' ? input.meta : input.control)) {
      event.preventDefault();
      openSettingsWindow(mainWindow);
    }
  };
  PageView.webContents.on('before-input-event', openSettingsShortcut);
  titlebarWindow.webContents.on('before-input-event', openSettingsShortcut);

  // Save window state on close
  mainWindow.on("close", (event) => {
    mainWindowState.saveState(mainWindow);

    if (settings.get('general.closeToTray') && !global.config.runtime.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
      logger.log('Window hidden to tray');
    }
  });
  // Really closed: quit, even if hidden helper windows (about, popups) are still around and
  // would keep the app running with a tray pointing at a destroyed window
  mainWindow.on("closed", () => {
    if (process.platform !== 'darwin') app.quit();
  });

  // Set initial bounds
  setImmediate(updateViewBounds);

  // Badge count: (use mainWindow as that shows the badge on the taskbar)
  // Pass PageView's webContents for drawing since mainWindow has no loaded content
  const useSystemAccent = settings.get('badge.useSystemAccent');
  const badgeOptions = {
    ...global.app_settings.badgeOptions,
    drawingWebContents: PageView.webContents,
    useSystemAccentTheme: useSystemAccent
  };
  new badge(mainWindow, badgeOptions);
  logger.log(`Badge configured - useSystemAccent: ${useSystemAccent}`);

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

  // Hands over from the splash to the main window. Called once by startup when the first
  // page is ready; later loads must not pull the main window in front of e.g. the settings
  // window.
  global.revealMainWindow = () => {
    if (global.isUpdating || splash.isDestroyed()) return;
    logger.log('Showing main window');
    global.config.runtime.isReady = true;
    mainWindow.show();
    splash.destroy();
    mainWindow.focus();
    setImmediate(updateViewBounds);
  };

  // PageView Events:
  PageView.webContents.setWindowOpenHandler(({ url }) => {
    const popup = new BrowserWindow({
      show: true,
      autoHideMenuBar: true,
      icon: path.join(global.paths.app, 'ui', 'img', 'logo.png'),
      webPreferences: getRecommendedWebPreferences()
    });
    attachWindowMemoryOptimizations(popup, { onSettleHidden: () => memoryMonitor?.forceGc(), logger: perfLogger });
    popup.loadURL(url);
    return { action: 'deny' };
  });

  PageView.webContents.on('page-title-updated', (event, title) => {
    global.titlebarWindow.webContents.send('titlebar:setTitle', title);
  });
};

// Loads a page into PageView behind the splash; resolves once it has loaded (or failed to)
function loadFirstPage(load) {
  const { webContents } = global.PageView;
  return new Promise((resolve) => {
    const done = () => {
      webContents.off('did-finish-load', done);
      webContents.off('did-fail-load', failed);
      resolve();
    };
    const failed = (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (isMainFrame) done();
    };
    webContents.on('did-finish-load', done);
    webContents.on('did-fail-load', failed);
    load(webContents).catch((error) => logger.error(`Failed to load first page: ${error}`));
  });
}

function showAboutWindow() {
  openAboutWindow();
};

// The main window, unless it has been destroyed (macOS keeps the app running without it)
function mainWindowAlive() {
  return global.mainWindow && !global.mainWindow.isDestroyed() ? global.mainWindow : null;
}

function createTray() {
  logger.log("Creating Tray");
  const logoImage = nativeImage.createFromPath(path.join(global.paths.app, 'ui', 'img', 'logo.png')).resize({ width: 16, height: 16 });
  const tray = (global.tray = new Tray(logoImage));
  tray.setToolTip(global.appInfo.name);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: global.appInfo.name, enabled: false, icon: logoImage },
    { type: 'separator' },
    process.platform === 'darwin'
      ? { label: 'Show', click() { mainWindowAlive()?.show(); } }
      : { label: 'Show/Hide', click() { const win = mainWindowAlive(); if (win) win.isVisible() ? win.hide() : win.show(); } },
    { type: 'separator' },
    {
      label: 'About', click() {
        showAboutWindow();
      }
    },
    { label: 'Settings…', click() { openSettingsWindow(mainWindowAlive()); } },
    { label: 'Quit', role: 'quit', click() { app.quit(); } }
  ]));
  tray.on('click', () => {
    const win = mainWindowAlive();
    if (!win) return;
    if (win.isVisible() && !win.isFocused()) {
      win.focus();
    } else {
      win.show();
      if (win.isMinimized()) {
        win.restore();
      }
      win.focus();
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

    default:
      if (uri[0] !== 'none') {
        logger.warn("[DEEPLINK] Unknown command");
      }
      break;
  };
};

// MIME types for app:// responses. Chromium's Opaque Response Blocking silently drops
// cross-scheme <script> loads unless the response carries a script MIME type, so
// application/octet-stream is only the fallback.
const APP_PROTOCOL_MIME_TYPES = {
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.json': 'application/json',
  '.html': 'text/html',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

// Register app protocol to handle app://ui/... requests (files in src/ui). Each session has
// its own protocol registry, so this runs for the default session (splash, titlebar, about)
// and for PageView's persistent session.
function handleAppProtocol(session) {
  session.protocol.handle('app', async (req) => {
    const { host, pathname } = new URL(req.url);

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
        const mimeType = APP_PROTOCOL_MIME_TYPES[path.extname(pathname).toLowerCase()] || 'application/octet-stream';
        return new Response(data, {
          status: 200,
          headers: {
            'Content-Type': mimeType,
            'Access-Control-Allow-Origin': '*',
            // Read from disk every time, so changed injected CSS/JS is never served stale
            'Cache-Control': 'no-store',
          }
        });
      } catch (error) {
        return new Response('File not found', { status: 404 });
      }
    } else {
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
      bypassCSP: true,
      // @font-face always fetches in CORS mode, which Chromium only allows for custom
      // schemes that opt in here
      corsEnabled: true
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
    if (await maybeInstallAppArmorProfile()) return;
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

    // Check if safeStorage is available
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

    // Set UserAgent
    global.ses.setUserAgent(`Mozilla/5.0 bsky-desktop/${global.appInfo.version} (Electron:${process.versions.electron};) Chrome:${process.versions.chrome};`);

    // Titlebar IPC bridge
    ipcMain.on('titlebar:setTitle', (event, title) => {
      if (global.titlebarWindow) global.titlebarWindow.webContents.send('titlebar:setTitle', title);
    });
    ipcMain.on('titlebar:setColor', (event, color) => {
      if (global.titlebarWindow) global.titlebarWindow.webContents.send('titlebar:setColor', color);
    });

    // Handle ipc for render
    ipcMain.on('app:check-updates', () => {
      logger.log('Manual update check requested');
      autoUpdater.checkForUpdates().catch((err) => logger.warn('Manual update check failed:', err.message));
    });

    ipcMain.on('app:quit-and-install', () => {
      autoUpdater.quitAndInstall();
    });

    ipcMain.on('app:restart', (event, arg) => {
      app.relaunch();
      app.quit();
    });

    ipcMain.on('app:quit', (event, arg) => {
      app.quit();
    });

    // Desktop notification IPC handler
    ipcMain.on('app:notification', (event, options) => {
      notifier.notify({
        title: options.title || global.appInfo.name,
        message: options.message || '',
        icon: options.icon || path.join(global.paths.app, 'ui', 'img', 'icons', 'icon.png'),
        sound: options.sound !== undefined ? options.sound : false,
        wait: options.wait !== undefined ? options.wait : false,
        timeout: options.timeout || 5
      });
    });

    // Settings window (src/ui/settings.html), opened from the tray, Ctrl/Cmd+, or the page
    // (settings:open)
    ipcMain.on('settings:open', (event) => {
      if (event.sender === global.PageView?.webContents) openSettingsWindow(mainWindowAlive());
    });
    initSettingsWindow({
      info: () => ({
        productName: packageJson.productName || global.appInfo.name,
        installType: autoUpdater.installType,
        sandbox: linuxSandboxStatus,
        gtkTheme: appAppearance.gtk?.name || null,
        site: new URL(global.urls.main).hostname,
        license: packageJson.license,
        homepage: packageJson.homepage,
      }),
      onCheckForUpdates: () => {
        autoUpdater.setup(config);
        return autoUpdater.checkForUpdates();
      },
    });

    // Create windows and tray
    createWindow();
    createTray();

    // Wait for splash screen to load before checking for updates, loading extensions and userstyles
    global.splash.webContents.on('did-finish-load', async () => {
      // Check for internet connection
      logger.log("Checking for internet connection");
      require('dns').lookup('google.com', async (err) => {
        if (err) {
          logger.log('No internet connection, showing not connected message');
          splashProgress({
            title: 'No internet connection',
            subtitle: 'Waiting for connection...'
          });

          // Keep track of how many checks have been made
          let checkCount = 0;

          // Set up periodic internet check
          const internetCheckInterval = setInterval(() => {
            logger.log('Rechecking internet connection...');
            require('dns').lookup('google.com', async (checkErr) => {
              if (!checkErr) {
                logger.log('Internet connection restored');
                clearInterval(internetCheckInterval);

                splashProgress({
                  title: 'Connection restored',
                  subtitle: 'Checking for updates...'
                });

                // Now proceed with normal startup
                await performStartup();
                return;
              }
              checkCount++;
              // After 12 checks (1 minute), show a more prominent message
              if (checkCount === 12) {
                splashProgress({
                  title: 'Still no connection',
                  subtitle: 'Please check your network settings.'
                });
              }
              // After 60 checks (5 minutes), stop waiting and show the offline page, which
              // can restart the app once the network is back
              if (checkCount === 60) {
                logger.log('No internet connection after 5 minutes, showing the offline page');
                clearInterval(internetCheckInterval);
                await loadFirstPage((webContents) => webContents.loadFile(path.join(global.paths.app, 'ui', 'offline.html')));
                global.revealMainWindow();
              }
            });
          }, 5000); // Check every 5 seconds

          return; // Exit early, don't destroy splash or setup page handler
        }

        // Internet is available from the start
        logger.log('Internet available, checking for updates');
        await performStartup();
      });
    });

    // check for updates, load extensions and userstyles, then show the main page
    async function performStartup() {
      logger.log("Initializing Updater");
      autoUpdater.setup(config);
      // Downloads and installs an update before the app opens, if there is one
      const installing = await autoUpdater.startupUpdate().then((result) => result.code === 'installing', (error) => {
        logger.error(`Error checking for updates: ${error}`);
        splashProgress({ title: 'Error checking for updates', subtitle: 'Continuing...' });
        return false;
      });
      // The app is about to restart into the new version
      if (installing) return;

      await loadExtensions();

      splashProgress({ title: 'Loading app...', subtitle: ' ' });
      // Shown even if the page hangs, so the splash can't stay up forever
      const splashTimeout = setTimeout(() => {
        logger.warn('Splash screen timeout - forcing main window to show');
        global.revealMainWindow();
      }, 30000);
      await loadFirstPage((webContents) => webContents.loadURL(global.urls.main));
      clearTimeout(splashTimeout);
      global.revealMainWindow();
    }

    // Load extensions (.crx files, that get unpacked so that we can load them [we can't load .crx directly in electron])
    async function loadExtensions() {
      logger.log("Checking for extensions");
      splashProgress({ title: 'Checking for extensions', subtitle: ' ' });
      const extensions = fs.readdirSync(global.paths.extensions).filter((file) => file.endsWith('.crx'));

      if (extensions.length > 0) {
        logger.log(`Unpacking ${extensions.length} extensions and loading them`);
        splashProgress({ title: `Unpacking ${extensions.length} extensions` });
        extensions.forEach((extension) => {
          logger.log(`Loading extension: ${extension}`);
          splashProgress({ title: `Loading extension: ${extension}` });
          loadCRX(path.join(global.paths.extensions, extension));
        });
      } else {
        // Check for unpacked extensions
        const unpackedExtensions = fs.readdirSync(global.paths.extensions).filter((file) =>
          fs.lstatSync(path.join(global.paths.extensions, file)).isDirectory()
        );

        // Check if the directory contains a manifest.json file
        for (const extension of unpackedExtensions) {
          const manifestPath = path.join(global.paths.extensions, extension, 'manifest.json');
          if (fs.existsSync(manifestPath)) {
            logger.log(`Loading unpacked extension: ${extension}`);
            splashProgress({ title: `Loading unpacked extension: ${extension}` });
            try {
              const { id } = await session.defaultSession.extensions.loadExtension(path.join(global.paths.extensions, extension));
              logger.log(`Extension loaded with ID: ${id}`);
            } catch (error) {
              logger.error(`Failed to load extension: ${error}`);
            }
          } else {
            logger.warn(`Skipping directory ${extension} as it does not contain a manifest.json file`);
          }
        }
      }
    }
  } else {
    logger.log("Failed to get singleInstanceLock, Quitting");
    app.quit();
  };
});

// Deeplink handler for macOS
app.on('open-url', (event, url) => {
  event.preventDefault();
  handleDeeplink([url]);
});

// Quit when all windows are closed. Except on macOS.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    logger.log('All windows closed, running final GC');
    memoryMonitor?.forceGc();
    app.quit();
  }
});

// macOS: clicking the dock icon brings the window back
app.on('activate', () => {
  mainWindowAlive()?.show();
});

// Add memory cleanup when windows are destroyed
app.on('browser-window-created', (event, window) => {
  window.on('closed', () => {
    if (Date.now() - lastGcTime > GC_COOLDOWN) {
      logger.debug('Window closed, triggering GC');
      memoryMonitor?.forceGc();
      lastGcTime = Date.now();
    }
  });
});

// When the app will quit, unregister global shortcuts
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

// Before quit, shutdown logger
app.on('before-quit', () => {
  logger.log('[Before Quit] Shutting down logger and quitting');
  global.config.runtime.isQuitting = true;
  log4js.shutdown();
});