const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
const allowedChannels = ["ui:badgeCount", "ui:notif", "ui:settings", "ui:openSettings", "app:restart"];

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

// Inject CSS into the DOM
function injectCSS(href) {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = href;
    document.head.appendChild(css);
    console.log(`Injected CSS: ${href}`);
}

document.addEventListener("DOMContentLoaded", async () => {
    injectCSS("app://ui/lib/izitoast.min.css");
    injectCSS("app://ui/rend/extra-themes.css");
    injectCSS("app://ui/css/fa/6.7.1/css/all.min.css");

    try {
        await loadScriptAsync("app://ui/lib/jquery-3.3.1.min.js");
        await loadScriptAsync("app://ui/lib/confetti-1.9.3-browser.min.js");
        await loadScriptAsync("app://ui/lib/izitoast.min.js");
        await loadScriptAsync("app://ui/rend/register-handles.js");
        await loadScriptAsync("app://ui/rend/bsky-ext.js");
        await loadScriptAsync("app://ui/rend/specialAnimations.js");
    } catch (error) {
        console.error("Failed to load one or more scripts.", error);
    }
});