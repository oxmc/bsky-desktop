const { contextBridge, ipcRenderer } = require('electron');

// Expose IPC methods
contextBridge.exposeInMainWorld("ipc", {
    send: (channel, data) => {
        ipcRenderer.send(channel, data);
    },
    on: (channel, callback) => {
        ipcRenderer.on(channel, (event, ...args) => callback(...args));
    },
});

contextBridge.exposeInMainWorld("badge", {
    update: (badgeNumber) => {
        ipcRenderer.send('ui:badgeCount', badgeNumber);
    }
});

// Helper to dynamically load a script and append it to the DOM
function loadScript(src, callback) {
    const script = document.createElement('script');
    script.src = src;
    script.onload = () => {
        console.log(`Loaded script: ${src}`);
        if (callback) callback();
    };
    script.onerror = (error) => {
        console.error(`Failed to load script: ${src}`, error);
    };
    document.body.appendChild(script);
}

// Inject CSS into the DOM
function injectCSS(href) {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = href;
    document.head.appendChild(css);
    console.log(`Injected CSS: ${href}`);
}

document.addEventListener('DOMContentLoaded', () => {
    // Inject CSS
    injectCSS('ui:///lib/izitoast.min.css');
    injectCSS('ui:///rend/extra-themes.css');
    injectCSS('ui:///css/fa/6.7.1/css/all.min.css');

    // Load jQuery first
    loadScript('ui:///lib/jquery-3.3.1.min.js', () => {
        // Load iziToast after jQuery
        loadScript('ui:///lib/izitoast.min.js', () => {
            loadScript('ui:///rend/register-handles.js');
            loadScript('ui:///rend/bsky-ext.js');
        });
    });
});
