// Reads the colors of the user's GTK theme (Linux), for the adwaita restyle to follow it.
//
// Looks at, in priority order: ~/.config/gtk-4.0/gtk.css (user overrides, e.g. Gradience),
// then the active theme's gtk-4.0 and gtk-3.0 stylesheets. Follows @import, including
// resource:/// imports into the theme's compiled .gresource bundles (as Yaru ships), and
// resolves @define-color values with GTK's shade()/alpha()/mix()/lighter()/darker().
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Colors we use, by role, with the GTK names that provide them (first match wins)
const ROLES = {
    window: ['window_bg_color', 'theme_bg_color'],
    view: ['view_bg_color', 'content_view_bg', 'theme_base_color'],
    fg: ['window_fg_color', 'view_fg_color', 'theme_fg_color'],
    accent: ['accent_bg_color', 'accent_color', 'theme_selected_bg_color'],
    headerbar: ['headerbar_bg_color'],
    sidebar: ['sidebar_bg_color'],
    popover: ['popover_bg_color'],
    card: ['card_bg_color'],
};

function gsetting(key) {
    const result = spawnSync('gsettings', ['get', 'org.gnome.desktop.interface', key], { encoding: 'utf8', timeout: 2000 });
    return result.status === 0 ? result.stdout.trim().replace(/^'|'$/g, '') : null;
}

function findThemeDir(name) {
    const dirs = [path.join(os.homedir(), '.themes'), path.join(os.homedir(), '.local/share/themes'), '/usr/local/share/themes', '/usr/share/themes'];
    return dirs.map((d) => path.join(d, name)).find((d) => fs.existsSync(d)) || null;
}

// --- Loading CSS, following imports -----------------------------------------------------

function gresourcesIn(themeDir) {
    const out = [];
    for (const sub of ['', 'gtk-4.0', 'gtk-3.0']) {
        const dir = path.join(themeDir, sub);
        if (!fs.existsSync(dir)) continue;
        for (const file of fs.readdirSync(dir)) if (file.endsWith('.gresource')) out.push(path.join(dir, file));
    }
    return out;
}

function readResource(themeDir, resourcePath) {
    for (const bundle of gresourcesIn(themeDir)) {
        const result = spawnSync('gresource', ['extract', bundle, resourcePath], { encoding: 'utf8', timeout: 5000, maxBuffer: 16 * 1024 * 1024 });
        if (result.status === 0 && result.stdout) return result.stdout;
    }
    return null;
}

// Returns the CSS text with @imports inlined (resources from the theme's .gresource files)
function loadCss(file, themeDir, depth = 0) {
    let css;
    if (file.startsWith('resource://')) css = themeDir ? readResource(themeDir, file.replace('resource://', '')) : null;
    else css = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    if (!css || depth > 4) return css || '';

    return css.replace(/@import\s+url\(\s*["']?([^"')]+)["']?\s*\)\s*;/g, (match, target) => {
        let resolved = target;
        if (target.startsWith('file://')) resolved = target.slice(7);
        else if (!target.startsWith('resource://') && !path.isAbsolute(target)) {
            resolved = file.startsWith('resource://')
                ? 'resource://' + path.posix.join(path.posix.dirname(file.slice(11)), target)
                : path.join(path.dirname(file), target);
        }
        return loadCss(resolved, themeDir, depth + 1);
    });
}

// --- Colors ------------------------------------------------------------------------------

const NAMED = { white: [255, 255, 255, 1], black: [0, 0, 0, 1], transparent: [0, 0, 0, 0] };

function splitArgs(s) {
    const args = [];
    let depth = 0, start = 0;
    for (let i = 0; i < s.length; i++) {
        if (s[i] === '(') depth++;
        else if (s[i] === ')') depth--;
        else if (s[i] === ',' && depth === 0) { args.push(s.slice(start, i).trim()); start = i + 1; }
    }
    args.push(s.slice(start).trim());
    return args;
}

function rgbToHsl([r, g, b]) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
    if (max === min) return [0, 0, l];
    const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h / 6, s, l];
}

function hslToRgb([h, s, l]) {
    if (s === 0) return [l * 255, l * 255, l * 255];
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    const f = (t) => {
        t = (t + 1) % 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
    };
    return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}

// GTK's shade(): scale lightness and saturation by factor
function shade(c, factor) {
    const [h, s, l] = rgbToHsl(c);
    return [...hslToRgb([h, Math.min(1, s * factor), Math.min(1, l * factor)]), c[3]];
}

// Parse a GTK color expression into [r, g, b, a], or null if it can't be resolved
function parseColor(expr, defs, seen = new Set()) {
    expr = expr.trim();
    if (expr.startsWith('@')) {
        const name = expr.slice(1);
        if (seen.has(name) || !(name in defs)) return null;
        return parseColor(defs[name], defs, new Set([...seen, name]));
    }
    if (NAMED[expr]) return NAMED[expr];
    let m = expr.match(/^#([0-9a-f]{3,8})$/i);
    if (m) {
        let hex = m[1];
        if (hex.length <= 4) hex = [...hex].map((ch) => ch + ch).join('');
        const n = (i) => parseInt(hex.slice(i, i + 2), 16);
        return [n(0), n(2), n(4), hex.length === 8 ? n(6) / 255 : 1];
    }
    m = expr.match(/^(\w+)\((.*)\)$/s);
    if (!m) return null;
    const [, fn, body] = m;
    const args = splitArgs(body);
    const color = (i) => parseColor(args[i], defs, seen);
    const num = (i) => parseFloat(args[i]);
    switch (fn) {
        case 'rgb':
        case 'rgba': {
            const [r, g, b, a = '1'] = args;
            const channel = (v) => (v.endsWith('%') ? parseFloat(v) * 2.55 : parseFloat(v));
            return [channel(r), channel(g), channel(b), parseFloat(a)];
        }
        case 'alpha': {
            const c = color(0);
            return c && [c[0], c[1], c[2], c[3] * num(1)];
        }
        case 'shade': {
            const c = color(0);
            return c && shade(c, num(1));
        }
        case 'lighter': {
            const c = color(0);
            return c && shade(c, 1.3);
        }
        case 'darker': {
            const c = color(0);
            return c && shade(c, 0.7);
        }
        case 'mix': {
            const a = color(0), b = color(1), f = num(2);
            return a && b && a.map((v, i) => v + (b[i] - v) * f);
        }
        default:
            return null;
    }
}

// Opaque colors as #rrggbb (the titlebar only takes hex), translucent as rgb(r g b / a)
function toCss([r, g, b, a]) {
    const rgb = [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))));
    if (a >= 1) return '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('');
    return `rgb(${rgb.join(' ')} / ${+a.toFixed(3)})`;
}

function luminance([r, g, b]) {
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function parseDefines(css) {
    const defs = {};
    for (const m of css.matchAll(/@define-color\s+([\w-]+)\s+([^;]+);/g)) defs[m[1]] = m[2].trim();
    return defs;
}

// --- Public ------------------------------------------------------------------------------

// Returns { name, dark, colors: { window, view, fg, accent, headerbar, sidebar, popover, card } }
// with CSS color strings for the roles the theme defines, or null when nothing usable found.
function readGtkTheme() {
    if (process.platform !== 'linux') return null;
    try {
        const name = gsetting('gtk-theme');
        const prefersDark = gsetting('color-scheme') === 'prefer-dark' || /-dark$/i.test(name || '');
        const themeDir = name ? findThemeDir(name) : null;

        // Lowest priority first, so later sources override earlier ones
        const sources = [];
        if (themeDir) {
            for (const ver of ['gtk-3.0', 'gtk-4.0']) {
                const variant = prefersDark && fs.existsSync(path.join(themeDir, ver, 'gtk-dark.css')) ? 'gtk-dark.css' : 'gtk.css';
                sources.push([path.join(themeDir, ver, variant), themeDir]);
            }
        }
        sources.push([path.join(os.homedir(), '.config/gtk-4.0/gtk.css'), null]);

        const defs = {};
        for (const [file, dir] of sources) Object.assign(defs, parseDefines(loadCss(file, dir)));

        const colors = {};
        for (const [role, names] of Object.entries(ROLES)) {
            for (const n of names) {
                const c = n in defs && parseColor(`@${n}`, defs);
                if (c) { colors[role] = c; break; }
            }
        }
        if (!colors.window && !colors.view) return null;
        colors.window = colors.window || colors.view;
        colors.view = colors.view || colors.window;

        // Many themes (e.g. Yaru) only define the GTK 3 basics: derive the surfaces they
        // don't define from the window color, roughly as libadwaita does
        const dark = luminance(colors.window) < 0.5;
        colors.headerbar = colors.headerbar || shade(colors.window, dark ? 1.08 : 0.97);
        colors.sidebar = colors.sidebar || shade(colors.window, dark ? 1.04 : 0.97);
        colors.popover = colors.popover || shade(colors.window, dark ? 1.2 : 1);
        return { name, dark, colors: Object.fromEntries(Object.entries(colors).map(([k, v]) => [k, toCss(v)])) };
    } catch {
        return null;
    }
}

module.exports = { readGtkTheme, parseColor };
