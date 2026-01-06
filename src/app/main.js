const { app, BrowserWindow, WebContentsView, safeStorage, globalShortcut, ipcMain, Tray, Menu, protocol, session, dialog, nativeImage } = require("electron");
const electronremote = require("@electron/remote/main");
const { autoUpdater } = require('electron-updater');
const notifier = require('node-notifier');
const admzip = require("adm-zip");
const log4js = require("log4js");
const GPUInfo = require('@oxmc/node-gpuinfo');
const SMBIOS = require('@oxmc/node-smbios');
const detectRpi = require('detect-rpi');
const path = require("path");
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
const AboutWindow = require("./module/about-window/src/index").default;
const badge = require('./module/badge');
const loadCRX = require('./utils/loadCRX');
const userStyles = require('./utils/userStyles');

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
const updaterLogger = log4js.getLogger("bskydesktop-updater");
logger.level = isDev ? "debug" : "info";
updaterLogger.level = isDev ? "debug" : "info";
autoUpdater.logger = updaterLogger;
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
if (!fs.existsSync(global.paths.data, 'user')) {
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

// User config
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

// Merge user config with defaults
global.userConfig = {
  updates: { ...config.user_settings.updates, ...userConfig.updates },
  appearance: { ...config.user_settings.appearance, ...userConfig.appearance },
  badge: { ...config.user_settings.badge, ...userConfig.badge }
};

// Function to save user config
function saveUserConfig() {
  try {
    fs.writeFileSync(userConfigPath, JSON.stringify(global.userConfig, null, 2), 'utf8');
    logger.log('User config saved successfully');
    return true;
  } catch (error) {
    logger.error('Failed to save user config:', error);
    return false;
  }
}

// Configure autoUpdater (use the generic provider with custom URL so that we can do staging with CDN)
let updateCheckInterval = null;
const UPDATE_CHECK_INTERVAL = global.userConfig.updates.checkInterval;

// Set update channel URL
const updateChannel = global.userConfig.updates.channel || 'latest';
const updateURL = `https://github.com/oxmc/bsky-desktop/releases/${updateChannel}/download/`;

// Map platform/arch to match yml file names
const platformMap = {
  'win32': 'win',
  'darwin': 'mac',
  'linux': 'linux'
};
const platform = platformMap[os.platform()] || os.platform();
const arch = os.arch();
const channelName = `latest-${platform}-${arch}`;

autoUpdater.setFeedURL({
  provider: 'generic',
  url: updateURL,
  channel: channelName,
  requestHeaders: {
    'User-Agent': `bsky-desktop-updater/${packageJson.version} (${os.platform()} ${os.arch()}; Electron ${process.versions.electron})`
  }
});

logger.log(`Update channel set to: ${updateChannel} ${channelName}`);

// If in dev mode, enable dev update config
if (isDev) {
  logger.log("Enabling dev update config for autoUpdater");
  autoUpdater.forceDevUpdateConfig = true;
};

// Set autoUpdater options from user config
autoUpdater.autoDownload = global.userConfig.updates.autoDownload;
autoUpdater.autoInstallOnAppQuit = global.userConfig.updates.autoInstallOnQuit;
autoUpdater.disableWebInstaller = true;
autoUpdater.disableDifferentialDownload = true;

// Setup updater event handlers
autoUpdater.on('checking-for-update', () => {
  logger.log('Checking for updates...');
  if (global.splash && global.splash.webContents) {
    global.splash.webContents.send('ui:progtext', {
      title: 'Checking for updates...',
      subtitle: 'Awaiting response'
    });
  };
});

autoUpdater.on('update-available', (info) => {
  logger.log('Update available:', info.version);
  if (global.splash && global.splash.webContents) {
    global.splash.webContents.send('ui:progtext', {
      title: 'Update available',
      subtitle: `Version ${info.version}`
    });
  };

  // Notify user if main window is already shown
  if (global.PageView && global.PageView.webContents && global.config.runtime.isReady) {
    global.PageView.webContents.send('ui:notif', {
      title: 'Update Available',
      message: `Version ${info.version} is available for download`,
      options: {
        izitoast: {
          position: 'topRight',
          timeout: 5000,
          layout: 2,
          color: 'blue'
        }
      }
    });

    // Show desktop notification if window is not focused
    if (global.mainWindow && !global.mainWindow.isFocused()) {
      notifier.notify({
        title: 'Bluesky Desktop - Update Available',
        message: `Version ${info.version} is available for download`,
        icon: path.join(global.paths.app, 'ui', 'img', 'icons', 'icon.png'),
        sound: false,
        wait: false
      });
    }
  }
});

autoUpdater.on('update-not-available', (info) => {
  logger.log('No updates available');
  if (global.splash && global.splash.webContents) {
    global.splash.webContents.send('ui:progtext', {
      title: 'Checking for updates...',
      subtitle: 'Up to date!'
    });
  };
});

autoUpdater.on('error', (err) => {
  logger.error('Update error:', err);
  if (global.splash && global.splash.webContents) {
    global.splash.webContents.send('ui:progtext', {
      title: 'Error checking for updates',
      subtitle: ' '
    });
  };
});

autoUpdater.on('download-progress', (progressObj) => {
  logger.log(`Download speed: ${progressObj.bytesPerSecond} - Downloaded ${progressObj.percent}%`);
  if (global.splash && global.splash.webContents) {
    global.splash.webContents.send('ui:progtext', {
      title: 'Downloading update',
      subtitle: `${Math.round(progressObj.percent)}% complete`
    });
  };

  // Show progress in main window if available
  if (global.PageView && global.PageView.webContents && global.config.runtime.isReady) {
    global.PageView.webContents.send('ui:notif', {
      title: 'Downloading Update',
      message: `${Math.round(progressObj.percent)}% complete`,
      options: {
        izitoast: {
          position: 'topRight',
          timeout: 2000,
          layout: 2,
          color: 'blue'
        }
      }
    });
  }
});

autoUpdater.on('update-downloaded', (info) => {
  logger.log('Update downloaded:', info.version);
  if (global.splash && global.splash.webContents) {
    global.splash.webContents.send('ui:progtext', {
      title: 'Update downloaded',
      subtitle: 'Will install on quit'
    });
  };

  if (global.PageView && global.PageView.webContents) {
    global.PageView.webContents.send('ui:notif', {
      title: 'Update Ready',
      message: `Version ${info.version} will be installed when you restart the app`,
      options: {
        izitoast: {
          position: 'topRight',
          timeout: 10000,
          layout: 2,
          color: 'green'
        }
      }
    });

    // Show desktop notification if window is not focused
    if (global.mainWindow && !global.mainWindow.isFocused()) {
      notifier.notify({
        title: 'Bluesky Desktop - Update Ready',
        message: `Version ${info.version} will be installed when you restart the app`,
        icon: path.join(global.paths.app, 'ui', 'img', 'icons', 'icon.png'),
        sound: false,
        wait: false
      });
    }
  }
});

// Check for updates
async function checkForUpdates(silent = false) {
  try {
    if (!silent) {
      logger.log('Running periodic update check...');
    }

    const updateCheckResult = await autoUpdater.checkForUpdates();

    if (updateCheckResult && updateCheckResult.updateInfo) {
      const currentVersion = packageJson.version;
      const latestVersion = updateCheckResult.updateInfo.version;

      // Only download if a newer version is available
      if (latestVersion !== currentVersion) {
        logger.log(`Update available: ${latestVersion} (current: ${currentVersion})`);

        // Automatically download the update in the background
        await autoUpdater.downloadUpdate();
      } else {
        if (!silent) {
          logger.log('Already running the latest version');
        }
      }
    }
  } catch (error) {
    logger.error('Error during periodic update check:', error);
  }
}

function startPeriodicUpdateChecks() {
  // Clear any existing interval
  if (updateCheckInterval) {
    clearInterval(updateCheckInterval);
  }

  // Set up periodic checks
  updateCheckInterval = setInterval(() => {
    checkForUpdates(false);
  }, UPDATE_CHECK_INTERVAL);

  logger.log(`Periodic update checks started (interval: ${UPDATE_CHECK_INTERVAL / 60000} minutes)`);
}

// Get system information for performance tuning
const totalMem = os.totalmem() / (1024 * 1024); // in MB
const allGpus = GPUInfo.getAllGpuInfo();
const piInfo = detectRpi.info();

// Filter out software and virtual GPUs
const physicalGpus = allGpus.filter(gpu => {
  const name = gpu.name.toLowerCase();
  return !name.includes('software') && !name.includes('virtual') && !name.includes('swiftshader');
});

// Filter integrated GPUs (mostly Intel)
const discreteGpus = physicalGpus.filter(gpu => {
  const name = gpu.name.toLowerCase();
  return !name.includes('intel') && !name.includes('amd radeon') && !name.includes('radeon') && !name.includes('uhd graphics') && !name.includes('hd graphics');
});

// If running on Raspberry Pi, determine generation for specific tweaks
const isRaspberryPi = piInfo.isPi;
let piGeneration = 0;

if (isRaspberryPi) {
  logger.log(`Detected Raspberry Pi: ${piInfo.model || 'Unknown model'}`);
  logger.log(`Hardware: ${piInfo.hardware}, Revision: ${piInfo.revision}`);

  // Determine generation from model string
  const model = (piInfo.model || '').toLowerCase();

  if (model.includes('pi 5') || model.includes('compute module 5')) {
    piGeneration = 5;
  } else if (model.includes('pi 4') || model.includes('compute module 4')) {
    piGeneration = 4;
  } else if (model.includes('pi 3') || model.includes('compute module 3')) {
    piGeneration = 3;
  } else if (model.includes('zero 2')) {
    piGeneration = 3; // Zero 2 W uses RP3A0, similar to Pi 3
  } else if (model.includes('pi 2') || model.includes('compute module')) {
    piGeneration = 2;
  } else if (model.includes('zero') || model.includes('pi 1')) {
    piGeneration = 1;
  } else {
    // Fallback: determine by hardware ID
    const hw = (piInfo.hardware || '').toUpperCase();
    if (hw.includes('BCM2712')) {
      piGeneration = 5;
    } else if (hw.includes('BCM2711')) {
      piGeneration = 4;
    } else if (hw.includes('BCM2837') || hw === 'RP3A0') {
      piGeneration = 3;
    } else if (hw.includes('BCM2836')) {
      piGeneration = 2;
    } else {
      piGeneration = 1; // BCM2835 and older
    }
  }

  logger.log(`Determined Pi Generation: ${piGeneration}`);
}

// Determine memory tier for appropriate limits
const memoryTier = totalMem < 4096 ? 'low' : totalMem < 8192 ? 'medium' : 'high';

// Define constants based on Pi detection
const MEMORY_CHECK_INTERVAL = isRaspberryPi && piGeneration <= 3 ? 3000 : 5000;
const CACHE_CLEAR_INTERVAL = isRaspberryPi && piGeneration <= 3 ? 300000 : 600000; // 5 min vs 10 min
const HIGH_MEMORY_THRESHOLD = isRaspberryPi && piGeneration <= 3 ? 75 : 85;
const GC_COOLDOWN = isRaspberryPi && piGeneration <= 3 ? 5000 : 10000; // Faster GC on old Pi

// Apply Raspberry Pi specific optimizations FIRST (highest priority)
if (isRaspberryPi) {
  logger.log('Applying Raspberry Pi optimizations');

  // All Pi models benefit from these
  app.commandLine.appendSwitch('disable-gpu-compositing');
  app.commandLine.appendSwitch('disable-software-rasterizer');
  app.commandLine.appendSwitch('disable-dev-shm-usage');
  app.commandLine.appendSwitch('disable-accelerated-2d-canvas');
  app.commandLine.appendSwitch('disable-smooth-scrolling');
  app.commandLine.appendSwitch('disable-webgl');
  app.commandLine.appendSwitch('disable-webgl2');
  app.commandLine.appendSwitch('disable-reading-from-canvas'); // Prevent canvas readback

  // Generation-specific optimizations
  if (piGeneration <= 3) {
    // Pi 1, 2, 3, Zero, Zero 2 W - very aggressive optimization
    logger.log(`Applying aggressive optimizations for Pi Gen ${piGeneration}`);

    app.commandLine.appendSwitch('disable-gpu');
    app.commandLine.appendSwitch('disable-animations');
    app.commandLine.appendSwitch('disable-features', 'VizDisplayCompositor,Compositing');
    app.commandLine.appendSwitch('num-raster-threads', piGeneration <= 1 ? '1' : '2');
    app.commandLine.appendSwitch('enable-low-end-device-mode');

    // Determine memory tier for older Pi models
    const piMemoryTier = totalMem < 512 ? 'verylow' : totalMem < 1024 ? 'low' : 'medium';
    logger.log(`Pi memory tier: ${piMemoryTier} (${Math.round(totalMem)}MB total)`);

    // Reduce JS heap size significantly for Pi
    const piJsHeapSize = piMemoryTier === 'verylow' ? 256 : piMemoryTier === 'low' ? 512 : 1024;
    logger.log(`Setting Pi JS heap size to: ${piJsHeapSize}MB`);

    // Override the existing JS flags with Pi-optimized settings
    app.commandLine.appendSwitch('js-flags',
      `--expose-gc --max-old-space-size=${piJsHeapSize} --gc-global --always-compact --optimize-for-size --max-semi-space-size=1 --initial-heap-size=${Math.floor(piJsHeapSize / 4)}`
    );

    // Additional memory-saving flags
    app.commandLine.appendSwitch('renderer-process-limit', '1');
    app.commandLine.appendSwitch('disable-hang-monitor');

  } else if (piGeneration === 4) {
    // Pi 4 - moderate optimization, enable hardware acceleration where possible
    logger.log('Applying moderate optimizations for Pi 4');

    app.commandLine.appendSwitch('enable-features', 'VaapiVideoDecoder');
    app.commandLine.appendSwitch('use-gl', 'egl');
    app.commandLine.appendSwitch('num-raster-threads', '2');
    app.commandLine.appendSwitch('enable-native-gpu-memory-buffers');

    // Pi 4 can handle a bit more
    const pi4JsHeapSize = totalMem < 2048 ? 1024 : totalMem < 4096 ? 1536 : 2048;
    logger.log(`Setting Pi 4 JS heap size to: ${pi4JsHeapSize}MB`);
    app.commandLine.appendSwitch('js-flags',
      `--expose-gc --max-old-space-size=${pi4JsHeapSize} --gc-global --always-compact --optimize-for-size`
    );

  } else if (piGeneration >= 5) {
    // Pi 5 - lighter optimization, more capable hardware
    logger.log('Applying light optimizations for Pi 5');

    app.commandLine.appendSwitch('enable-features', 'VaapiVideoDecoder,VaapiVideoEncoder');
    app.commandLine.appendSwitch('use-gl', 'egl');
    app.commandLine.appendSwitch('enable-gpu-rasterization');
    app.commandLine.appendSwitch('num-raster-threads', '4');
    app.commandLine.appendSwitch('enable-native-gpu-memory-buffers');
    app.commandLine.appendSwitch('enable-zero-copy');

    // Pi 5 can handle normal workloads
    const pi5JsHeapSize = totalMem < 4096 ? 2048 : 3072;
    logger.log(`Setting Pi 5 JS heap size to: ${pi5JsHeapSize}MB`);
    app.commandLine.appendSwitch('js-flags',
      `--expose-gc --max-old-space-size=${pi5JsHeapSize} --gc-global --optimize-for-size`
    );
  }

  // All Pi models: reduce cache size
  const piCacheSize = piGeneration <= 3 ? 26214400 : 52428800; // 25MB vs 50MB
  app.commandLine.appendSwitch('disk-cache-size', piCacheSize.toString());
  logger.log(`Set disk cache to ${piCacheSize / 1024 / 1024}MB for Pi`);

  // Disable unnecessary features for all Pi models
  app.commandLine.appendSwitch('disable-features', 'AudioServiceOutOfProcess,CalculateNativeWinOcclusion');
} else {
  // NON-PI SYSTEMS: Apply standard optimizations

  // If low memory (non-Pi), apply additional restrictions
  if (memoryTier === 'low') {
    logger.log('Low memory system detected, applying additional restrictions');
    app.commandLine.appendSwitch('disable-smooth-scrolling');
    app.commandLine.appendSwitch('disable-accelerated-2d-canvas');
    app.commandLine.appendSwitch('num-raster-threads', '2');
  }

  // GPU-based performance adjustments (non-Pi)
  if (discreteGpus.length > 0) {
    // A dedicated GPU is present, enable all GPU features
    logger.log('Discrete GPU detected, enabling full GPU features');
  } else if (physicalGpus.length > 0) {
    // Only integrated GPUs present, enable some GPU features
    logger.log('Only integrated GPU detected, enabling limited GPU features');
    app.commandLine.appendSwitch('enable-features', 'UseSkiaRenderer');
  } else {
    // No physical GPUs detected, disable GPU features
    logger.log('No physical GPU detected, disabling GPU features');
    app.commandLine.appendSwitch('disable-gpu');
    app.commandLine.appendSwitch('disable-gpu-compositing');
    app.commandLine.appendSwitch('disable-software-rasterizer');
  }

  // Optimize transparency based on platform and GPU availability (non-Pi)
  if (process.platform !== 'win32' && process.platform !== 'darwin') {
    logger.log('Disabling Transparent Visuals');
    app.commandLine.appendSwitch('disable-transparent-visuals');
  } else if (discreteGpus.length > 0 || physicalGpus.length > 0) {
    // GPU-boosting flags only when GPU is available
    app.commandLine.appendSwitch('enable-features', 'UseSkiaRenderer');
    app.commandLine.appendSwitch('enable-zero-copy');
    app.commandLine.appendSwitch('ignore-gpu-blacklist');
    app.commandLine.appendSwitch('enable-native-gpu-memory-buffers');
    app.commandLine.appendSwitch('enable-gpu-rasterization');
  }

  // Platform-specific optimizations (non-Pi)
  if (process.platform === 'win32') {
    logger.log('Applying Windows-specific optimizations');
    app.commandLine.appendSwitch('disable-direct-composition');
    app.commandLine.appendSwitch('enable-features', 'OverlayScrollbar');
  }

  if (process.platform === 'darwin') {
    logger.log('Applying macOS-specific optimizations');
    app.commandLine.appendSwitch('enable-metal'); // Metal API for GPU
  }

  if (process.platform === 'linux') {
    logger.log('Applying Linux-specific optimizations');
    app.commandLine.appendSwitch('disable-gpu-memory-buffer-video-frames');
    app.commandLine.appendSwitch('enable-features', 'VaapiVideoDecoder');
  }

  // Memory-based JS heap limits (non-Pi)
  const jsHeapSize = memoryTier === 'low' ? 1024 : memoryTier === 'medium' ? 2048 : 4096;
  logger.log(`Setting JS heap size to: ${jsHeapSize}MB`);

  // V8 optimization flags (non-Pi)
  app.commandLine.appendSwitch('js-flags', `--expose-gc --max-old-space-size=${jsHeapSize} --gc-global --always-compact --optimize-for-size`);

  // Disk cache control (non-Pi)
  app.commandLine.appendSwitch('disk-cache-size', '52428800'); // 50MB cache limit
}

// GENERAL FLAGS (apply to all systems - Pi and non-Pi)
logger.log('Applying general performance flags');

// General performance flags (Disable unneeded features)
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion,Translate,AutofillServerCommunication,Autofill,BackgroundSync,MediaRouter,HardwareMediaKeyHandling');
app.commandLine.appendSwitch('disable-shared-dictionary');
app.commandLine.appendSwitch('disable-spell-checking');
app.commandLine.appendSwitch('disable-spellchecking-dictionaries');
app.commandLine.appendSwitch('disable-http-cache');
app.commandLine.appendSwitch('disable-speech-api');
app.commandLine.appendSwitch('disable-notifications');
app.commandLine.appendSwitch('disable-sync');
app.commandLine.appendSwitch('disable-domain-reliability');

// Process management
app.commandLine.appendSwitch('process-per-site');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');

// Network optimizations
app.commandLine.appendSwitch('disable-site-isolation-trials');
app.commandLine.appendSwitch('disable-features', 'IsolateOrigins,site-per-process');

// Additional memory pressure handling
let lastGcTime = Date.now();
const gcInterval = isRaspberryPi && piGeneration <= 3 ? 10000 :
  isRaspberryPi && piGeneration === 4 ? 20000 :
    memoryTier === 'low' ? 15000 : 30000;

if (global.gc) {
  logger.log(`Manual GC enabled (interval: ${gcInterval}ms)`);
  setInterval(() => {
    if (global.gc) {
      const memUsage = process.memoryUsage();
      const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
      const heapTotalMB = Math.round(memUsage.heapTotal / 1024 / 1024);

      logger.log(`Memory before GC: ${heapUsedMB}MB / ${heapTotalMB}MB`);
      global.gc();

      const memUsageAfter = process.memoryUsage();
      const heapUsedAfterMB = Math.round(memUsageAfter.heapUsed / 1024 / 1024);
      logger.log(`Memory after GC: ${heapUsedAfterMB}MB (freed: ${heapUsedMB - heapUsedAfterMB}MB)`);

      lastGcTime = Date.now();
    }
  }, gcInterval);
}

// Monitor memory pressure and trigger GC when needed
app.on('ready', () => {
  // Memory pressure monitoring
  setInterval(() => {
    const memUsage = process.memoryUsage();
    const heapUsedPercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;
    const rss = Math.round(memUsage.rss / 1024 / 1024);

    // Log memory stats periodically (only when high)
    if (heapUsedPercent > 70) {
      logger.debug(`Memory usage: ${Math.round(heapUsedPercent)}% heap, ${rss}MB RSS`);
    }

    // Trigger GC if heap is >85% full and last GC was >10s ago
    if (heapUsedPercent > HIGH_MEMORY_THRESHOLD && Date.now() - lastGcTime > GC_COOLDOWN && global.gc) {
      logger.log(`High memory pressure detected (${Math.round(heapUsedPercent)}%), forcing GC`);
      global.gc();
      lastGcTime = Date.now();
    }
  }, MEMORY_CHECK_INTERVAL);

  // Clear caches periodically
  setInterval(() => {
    const windows = BrowserWindow.getAllWindows();
    windows.forEach(win => {
      if (win && !win.isDestroyed()) {
        win.webContents.session.clearCache().then(() => {
          logger.debug('Cleared browser cache');
        }).catch(err => {
          logger.error('Failed to clear cache:', err);
        });
      }
    });
  }, CACHE_CLEAR_INTERVAL);
});

// setup the titlebar main process:
setupTitlebar();

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

    if (global.userConfig?.appearance?.closeToTray === true && !global.config.runtime.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
      logger.log('Window hidden to tray');
    }
  });

  // Set initial bounds
  setImmediate(updateViewBounds);

  // Badge count: (use mainWindow as that shows the badge on the taskbar)
  // Pass PageView's webContents for drawing since mainWindow has no loaded content
  const badgeOptions = {
    ...global.app_settings.badgeOptions,
    drawingWebContents: PageView.webContents,
    useSystemAccentTheme: global.userConfig.badge.useSystemAccent
  };
  const badgeInstance = new badge(mainWindow, badgeOptions);
  logger.log(`Badge configured - useSystemAccent: ${global.userConfig.badge.useSystemAccent}`);

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
    ses.setUserAgent(`Mozilla/5.0 bsky-desktop/${global.appInfo.version} (Electron:${process.versions.electron};) Chrome:${process.versions.chrome};`);

    // Handle ipc for render
    ipcMain.on('app:check-updates', async (event) => {
      logger.log('Manual update check requested');
      await checkForUpdates(false);
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
        title: options.title || 'Bluesky Desktop',
        message: options.message || '',
        icon: options.icon || path.join(global.paths.app, 'ui', 'img', 'icons', 'icon.png'),
        sound: options.sound !== undefined ? options.sound : false,
        wait: options.wait !== undefined ? options.wait : false,
        timeout: options.timeout || 5
      });
    });

    // Settings IPC handlers
    ipcMain.handle('app:getSettings', () => {
      return global.userConfig;
    });

    ipcMain.handle('app:saveSettings', (event, newSettings) => {
      try {
        const oldSettings = JSON.parse(JSON.stringify(global.userConfig));
        
        global.userConfig = {
          updates: { ...global.userConfig.updates, ...(newSettings.updates || {}) },
          appearance: { ...global.userConfig.appearance, ...(newSettings.appearance || {}) },
          badge: { ...global.userConfig.badge, ...(newSettings.badge || {}) }
        };
        
        const saved = saveUserConfig();
        if (saved) {
          logger.log('Settings saved via IPC');
          //logger.log('Old settings:', oldSettings);
          //logger.log('New settings:', global.userConfig);
          
          // Apply settings that don't require restart
          let requiresRestart = false;
          
          // Check if update settings changed (requires restart for update channel)
          if (oldSettings.updates.channel !== global.userConfig.updates.channel) {
            requiresRestart = true;
            logger.log('Update channel changed, restart required');
          }
          
          // Apply update check interval change
          if (oldSettings.updates.autoCheck !== global.userConfig.updates.autoCheck) {
            if (global.userConfig.updates.autoCheck && updateCheckInterval === null) {
              logger.log('Enabling periodic update checks');
              startPeriodicUpdateChecks();
            } else if (!global.userConfig.updates.autoCheck && updateCheckInterval !== null) {
              logger.log('Disabling periodic update checks');
              clearInterval(updateCheckInterval);
              updateCheckInterval = null;
            }
          }
          
          return { success: true, requiresRestart };
        } else {
          return { success: false, error: 'Failed to save config file' };
        }
      } catch (error) {
        logger.error('Error saving settings:', error);
        return { success: false, error: error.message };
      }
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
          global.splash.webContents.send('ui:progtext', {
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

                global.splash.webContents.send('ui:progtext', {
                  title: 'Connection restored',
                  subtitle: 'Checking for updates...'
                });

                // Now proceed with normal startup
                await performStartup();
              }
              checkCount++;
              // After 12 checks (1 minute), show a more prominent message
              if (checkCount === 12) {
                global.splash.webContents.send('ui:progtext', {
                  title: 'Still no connection',
                  subtitle: 'Please check your network settings.'
                });
              }
              // After 60 checks (5 minutes), Stop checking automatically and quit the app
              if (checkCount === 60) {
                logger.log('No internet connection after 5 minutes, quitting app');
                global.splash.webContents.send('ui:progtext', {
                  title: 'No connection',
                  subtitle: 'Quitting the app. Please check your network and restart.'
                });
                setTimeout(() => {
                  app.quit();
                }, 5000); // Give user time to read message
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

    // check for updates, load extensions and userstyles
    async function performStartup() {
      try {
        // Initial update check (if auto-check is enabled)
        if (global.userConfig.updates.autoCheck) {
          logger.log('Checking for updates on startup...');
          await checkForUpdates(false);
          // Start periodic update checks after initial check
          startPeriodicUpdateChecks();
        } else {
          logger.log('Auto-check for updates is disabled, skipping update check');
        }

      } catch (error) {
        logger.error('Error during update check:', error);
        global.splash.webContents.send('ui:progtext', {
          title: 'Error checking for updates',
          subtitle: 'Continuing as normal...'
        });
      }

      // Continue with extensions and userstyles loading
      await loadExtensionsAndStyles();

      // Setup page loading handler
      setupPageLoadHandler();
    }

    // Extract extensions and styles loading into a separate function
    async function loadExtensionsAndStyles() {
      // Load extensions (.crx files, that get unpacked so that we can load them [we can't load .crx directly in electron])
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
        // Check for unpacked extensions
        const unpackedExtensions = fs.readdirSync(global.paths.extensions).filter((file) =>
          fs.lstatSync(path.join(global.paths.extensions, file)).isDirectory()
        );

        // Check if the directory contains a manifest.json file
        for (const extension of unpackedExtensions) {
          const manifestPath = path.join(global.paths.extensions, extension, 'manifest.json');
          if (fs.existsSync(manifestPath)) {
            logger.log(`Loading unpacked extension: ${extension}`);
            global.splash.webContents.send('ui:progtext', { title: `Loading unpacked extension: ${extension}` });
            try {
              const { id } = await session.defaultSession.loadExtension(path.join(global.paths.extensions, extension));
              logger.log(`Extension loaded with ID: ${id}`);
            } catch (error) {
              logger.error(`Failed to load extension: ${error}`);
            }
          } else {
            logger.warn(`Skipping directory ${extension} as it does not contain a manifest.json file`);
          }
        }
      }

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
            try {
              const cssContent = fs.readFileSync(cssFile, 'utf-8');
              const result = await userStyles.parseCSS(cssContent);

              logger.info(`Loading userstyle: ${result.metadata.name}`);

              // Compile the userstyle
              const compiled = await userStyles.compileStyle(result.css, result.metadata);

              // Check if the site 'bsky.app' is defined
              if (compiled.sites?.['bsky.app']) {
                // Apply the userstyle to the PageView
                await global.PageView.webContents.insertCSS(compiled.sites['bsky.app']);

                logger.info(`Applied userstyle: ${result.metadata.name}`);
                global.splash.webContents.send('ui:progtext', {
                  title: `Applied userstyle: ${result.metadata.name}`
                });
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
    }

    // Extract page load handler into a separate function
    function setupPageLoadHandler() {
      // Timeout to prevent infinite splash screen
      const splashTimeout = setTimeout(() => {
        logger.warn('Splash screen timeout - forcing main window to show');
        global.mainWindow.show();
        global.splash.destroy();
        global.mainWindow.focus();
      }, 30000);

      // Wait for PageView to finish loading
      const onPageLoaded = () => {
        clearTimeout(splashTimeout);
        setTimeout(() => {
          global.config.runtime.isReady = true;
          global.mainWindow.show();
          global.splash.destroy();
          global.mainWindow.focus();
        }, 1000);
      };

      // Check if already loaded, otherwise wait for event
      if (global.PageView.webContents.isLoading()) {
        global.PageView.webContents.once('did-finish-load', onPageLoaded);
      } else {
        onPageLoaded();
      }

      // Show the main window
      global.splash.webContents.send('ui:progtext', { title: 'Loading app...', subtitle: ' ' });
      global.config.runtime.isReady = true;
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
    if (global.gc) {
      logger.log('All windows closed, running final GC');
      global.gc();
    }
    app.quit();
  }
});

// Add memory cleanup when windows are destroyed
app.on('browser-window-created', (event, window) => {
  window.on('closed', () => {
    if (global.gc && Date.now() - lastGcTime > GC_COOLDOWN) {
      logger.debug('Window closed, triggering GC');
      global.gc();
      lastGcTime = Date.now();
    }
  });
});

// When the app will quit, clear the update check interval and unregister global shortcuts
app.on('will-quit', () => {
  if (updateCheckInterval) {
    clearInterval(updateCheckInterval);
    updateCheckInterval = null;
  }
  globalShortcut.unregisterAll();
});

// Before quit, shutdown logger
app.on('before-quit', () => {
  logger.log('[Before Quit] Shutting down logger and quitting');
  global.config.runtime.isQuitting = true;
  log4js.shutdown();
});