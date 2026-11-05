// Desktop appearance on Linux: when "appearance.useGtkTheme" is on, the titlebar takes the
// GTK theme's headerbar color and the app's light/dark mode follows the theme (so pages
// that respect prefers-color-scheme match it). Elsewhere, or with the setting off, the app
// follows the system light/dark mode and keeps its own titlebar color.
const { spawnSync } = require('child_process');
const { readGtkTheme } = require('./gtkTheme');

// GNOME 47+ accent names -> libadwaita accent colors
const GNOME_ACCENTS = {
    blue: '#3584e4',
    teal: '#2190a4',
    green: '#3a944a',
    yellow: '#c88800',
    orange: '#ed5b00',
    red: '#e62d42',
    pink: '#d56199',
    purple: '#9141ac',
    slate: '#6f8396',
};

// System accent color on GNOME, or null (older GNOME, or gsettings unavailable)
function getGnomeAccent() {
    try {
        const result = spawnSync('gsettings', ['get', 'org.gnome.desktop.interface', 'accent-color'], { encoding: 'utf8', timeout: 2000 });
        if (result.status !== 0) return null;
        return GNOME_ACCENTS[result.stdout.trim().replace(/'/g, '')] || null;
    } catch {
        return null;
    }
}

// { gtk: { name, dark, colors } | null, accent }
function getAppearance({ useGtkTheme = true } = {}) {
    if (process.platform !== 'linux') return { gtk: null, accent: null };
    const gtk = useGtkTheme ? readGtkTheme() : null;
    return { gtk, accent: gtk?.colors.accent || getGnomeAccent() };
}

// Titlebar color for the appearance, or null to keep the app's own
function getTitlebarColor(appearance) {
    return appearance.gtk?.colors.headerbar || appearance.gtk?.colors.window || null;
}

// The GTK theme decides light/dark when it's followed
function getThemeSource(appearance) {
    if (!appearance.gtk) return 'system';
    return appearance.gtk.dark ? 'dark' : 'light';
}

module.exports = { getAppearance, getTitlebarColor, getThemeSource };
