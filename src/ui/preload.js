const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// settings:open opens the settings window (src/app/module/settings)
const allowedChannels = ["ui:badgeCount", "ui:badgeUpdate", "ui:notif", "ui:settings", "ui:openSettings", "app:restart", "app:notification", "settings:open", "titlebar:setTitle", "titlebar:setColor"];

// Expose ipcRenderer to the renderer process
contextBridge.exposeInMainWorld("ipc", {
    send: (channel, data) => {
        if (allowedChannels.includes(channel)) {
            ipcRenderer.send(channel, data);
        }
    },
    on: (channel, callback) => {
        if (allowedChannels.includes(channel)) {
            ipcRenderer.on(channel, (event, ...args) => callback(...args));
        }
    },
    // Desktop notification helper
    notify: (options) => {
        ipcRenderer.send('app:notification', options);
    }
});

// Load a script asynchronously
function loadScriptAsync(src) {
    return new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = src;
        script.onload = () => {
            console.log(`Loaded script: ${src}`);
            resolve();
        };
        script.onerror = (error) => {
            console.error(`Failed to load script: ${src}`, error);
            reject(error);
        };
        document.body.appendChild(script);
    });
}

// Inject CSS into the DOM (before the userstyles, which stay last)
function injectCSS(href) {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = href;
    document.head.insertBefore(css, userstyleElement?.parentNode === document.head ? userstyleElement : null);
    console.log(`Injected CSS: ${href}`);
}

// Userstyles compiled by the main process (src/app/module/userstyles). Kept as the last
// stylesheet in <head> so they override the page, as in the Stylus extension.
let userstyleElement = null;
function keepUserstylesLast() {
    if (userstyleElement && document.head.lastElementChild !== userstyleElement) {
        document.head.appendChild(userstyleElement);
    }
}
ipcRenderer.on("userstyles:apply", (event, cssList) => {
    if (!document.head) return;
    if (!userstyleElement) {
        userstyleElement = document.createElement("style");
        userstyleElement.id = "app-userstyles";
        new MutationObserver(keepUserstylesLast).observe(document.head, { childList: true });
    }
    userstyleElement.textContent = cssList.join("\n");
    keepUserstylesLast();
});

document.addEventListener("DOMContentLoaded", async () => {
    injectCSS("app://ui/lib/izitoast.min.css");
    injectCSS("app://ui/rend/extra-themes.css");
    injectCSS("app://ui/lib/fa/6.7.1/css/all.min.css");

    try {
        await loadScriptAsync("app://ui/lib/jquery-3.3.1.min.js");
        await loadScriptAsync("app://ui/lib/confetti-1.9.3-browser.min.js");
        await loadScriptAsync("app://ui/lib/izitoast.min.js");
        await loadScriptAsync("app://ui/rend/register-handles.js");
        await loadScriptAsync("app://ui/rend/bsky-ext.js");
        await loadScriptAsync("app://ui/rend/specialAnimations.js");
        // "Desktop App" entry in Bluesky's settings, opens the settings window
        await loadScriptAsync("app://ui/rend/app-settings-injector.js");
    } catch (error) {
        console.error("Failed to load one or more scripts.", error);
    }
});