const { nativeImage, ipcMain, systemPreferences } = require('electron');
const BadgeGenerator = require('./badgeGenerator.js');
const { execSync } = require('child_process');

let badgeDescription = 'New notification';
let UPDATE_BADGE_EVENT;
let invokeType = 'send';
let additionalFunc = () => {
    // Empty for now...
};
let currentOverlayIcon = { image: null, badgeDescription };
let currentNumber = null;

/**
 * @example const badgeOptions = {
 *   fontColor: '#000000',
 *   font: '62px Microsoft Yahei',
 *   color: '#000000',
 *   radius: 48,
 *   updateBadgeEvent: 'notificationCount',
 *   badgeDescription: 'Unread Notifications',
 *   invokeType: 'handle',
 *   max: 9,
 *   fit: false,
 *   useSystemAccentTheme: true,
 *   additionalFunc: (count) => {
 *     console.log(`Received ${count} new notifications!`);
 *   },
 * };
 *
 * new Badge(win, badgeOptions);
 * @since 1.0.0
 * @param {Electron.BrowserWindow} win
 * @param {object} badgeOptions
 * @returns {void}
 */
module.exports = class Badge {
    constructor(win, opts = {}) {
        this.win = win;
        this.opts = opts;

        // Get native accent color
        const accentColor = getNativeAccentColor();
        this.generator = new BadgeGenerator(win, opts, accentColor);

        if (process.platform === 'win32' || process.platform === 'darwin') {
            systemPreferences.on('accent-color-changed', () => {
                const newAccentColor = getNativeAccentColor();
                this.generator = new BadgeGenerator(win, opts, newAccentColor);
                this.generator.generate(currentNumber, true);
                this.update(currentNumber);
            });
        }

        if (typeof opts?.updateBadgeEvent !== 'string') {
            throw new TypeError(`Invalid IPC event handler name specified.\nExpected: string\nGot: ${typeof opts?.updateBadgeEvent}`);
        }

        UPDATE_BADGE_EVENT = opts?.updateBadgeEvent ?? 'update-badge';
        badgeDescription = opts?.badgeDescription ?? UPDATE_BADGE_EVENT;
        invokeType = opts?.invokeType ?? 'send';
        additionalFunc = opts?.additionalFunc ?? additionalFunc;

        this.initListeners();

        // If win is a bowserview, change to this.win.webContents instead
        this.win.on('closed', () => { this.win = null; });
        if (process.platform === 'win32' || process.platform === 'darwin') {
            this.win.on('show', () => { this.win.setOverlayIcon(currentOverlayIcon.image, currentOverlayIcon.badgeDescription); });
        }
    }

    update(badgeNumber) {
        if (typeof badgeNumber !== 'number' && badgeNumber != null) {
            throw new TypeError(`Invalid badgeNumber specified.\nExpected: number\nGot: ${typeof badgeNumber}`);
        }

        if (badgeNumber) {
            this.generator.generate(badgeNumber).then((base64) => {
                const image = nativeImage.createFromDataURL(base64);
                currentOverlayIcon = {
                    image,
                    badgeDescription,
                };
                if (process.platform === 'win32' || process.platform === 'darwin') {
                    this.win.setOverlayIcon(currentOverlayIcon.image, currentOverlayIcon.badgeDescription);
                }
                currentNumber = badgeNumber;
            });
        } else {
            currentOverlayIcon = {
                image: null,
                badgeDescription,
            };
            if (process.platform === 'win32' || process.platform === 'darwin') {
                this.win.setOverlayIcon(currentOverlayIcon.image, currentOverlayIcon.badgeDescription);
            }
        }
    }

    initListeners() {
        if (invokeType.includes('send')) {
            ipcMain.on(UPDATE_BADGE_EVENT, (event, badgeNumber) => {
                if (this.win) {
                    this.update(badgeNumber);
                    additionalFunc(badgeNumber);
                }
                event.returnValue = 'success';
            });
        } else {
            ipcMain.handle(UPDATE_BADGE_EVENT, (event, badgeNumber) => {
                if (this.win) {
                    this.update(badgeNumber);
                    additionalFunc(badgeNumber);
                }
                event.returnValue = 'success';
            });
        }
    }
};

function getNativeAccentColor() {
    try {
        if (process.platform === 'win32' || process.platform === 'darwin') {
            return `#${systemPreferences.getAccentColor()}`;
        } else if (process.platform === 'linux') {
            return getLinuxAccentColor();
        }
    } catch (error) {
        console.warn('Failed to fetch native accent color, using default:', error);
        return '#4cc2ff'; // Fallback color
    }
}

function getLinuxAccentColor() {
    try {
        // GNOME: Use gsettings to fetch theme's accent color
        const color = execSync('gsettings get org.gnome.desktop.interface gtk-color-scheme')
            .toString()
            .match(/bg_color:\s*#([0-9a-fA-F]{6})/);
        return color ? `#${color[1]}` : '#4cc2ff';
    } catch {
        // KDE: Use a default or parse kdeglobals
        try {
            const kdeColor = execSync("grep 'AccentColor=' ~/.config/kdeglobals | cut -d'=' -f2").toString().trim();
            return kdeColor ? `#${kdeColor}` : '#4cc2ff';
        } catch {
            return '#4cc2ff';
        }
    }
}

function rgbToHex(r, g, b) {
    const red = parseInt(r);
    const green = parseInt(g);
    const blue = parseInt(b);

    const rgb = blue | (green << 8) | (red << 16);
    return '#' + rgb.toString(16).padStart(6, '0');
}