'use strict';

const path = require('path');
const fs = require('fs');
const electron = require('electron');

let remote;
try {
    remote = require('@electron/remote');
} catch (err) {
    remote = electron.remote; // Fallback for older Electron versions
}

module.exports = function (options) {
    const app = electron.app || (remote ? remote.app : null);
    const screen = electron.screen || (remote ? remote.screen : null);
    let state;
    let winRef;
    let stateChangeTimer;
    const eventHandlingDelay = 100;
    const config = Object.assign({
        file: 'window-state.json',
        path: app.getPath('userData'),
        maximize: true,
        fullScreen: true
    }, options);
    const fullStoreFileName = path.join(config.path, config.file);

    function isNormal(win) {
        return !win.isMaximized() && !win.isMinimized() && !win.isFullScreen();
    }

    function hasBounds() {
        return state &&
            Number.isInteger(state.x) &&
            Number.isInteger(state.y) &&
            Number.isInteger(state.width) && state.width > 0 &&
            Number.isInteger(state.height) && state.height > 0;
    }

    function resetStateToDefault() {
        const displayBounds = screen.getPrimaryDisplay().bounds;

        // Reset state to default values on the primary display
        state = {
            width: config.defaultWidth || 800,
            height: config.defaultHeight || 600,
            x: 0,
            y: 0,
            displayBounds
        };
    }

    function windowWithinBounds(bounds) {
        return (
            state.x >= bounds.x &&
            state.y >= bounds.y &&
            state.x + state.width <= bounds.x + bounds.width &&
            state.y + state.height <= bounds.y + bounds.height
        );
    }

    function ensureWindowVisibleOnSomeDisplay() {
        const visible = screen.getAllDisplays().some(display => {
            return windowWithinBounds(display.bounds);
        });

        if (!visible) {
            // Window is partially or fully not visible now.
            // Reset it to safe defaults.
            return resetStateToDefault();
        }
    }

    function validateState() {
        const isValid = state && (hasBounds() || state.isMaximized || state.isFullScreen);
        if (!isValid) {
            state = null;
            return;
        }

        if (hasBounds() && state.displayBounds) {
            ensureWindowVisibleOnSomeDisplay();
        }
    }

    function updateState(win) {
        win = win || winRef;
        if (!win || !state) return;
        // Don't throw an error when window was closed
        try {
            const winBounds = win.getBounds();
            if (isNormal(win)) {
                state.x = winBounds.x;
                state.y = winBounds.y;
                state.width = winBounds.width;
                state.height = winBounds.height;
            }
            state.isMaximized = win.isMaximized();
            state.isFullScreen = win.isFullScreen();
            state.displayBounds = screen.getDisplayMatching(winBounds).bounds;
        } catch (err) { }
    }

    function saveState(win) {
        // Update window state only if it was provided
        if (win) {
            updateState(win);
        }

        // Save state
        try {
            fs.mkdirSync(path.dirname(fullStoreFileName), { recursive: true });
            fs.writeFileSync(fullStoreFileName, JSON.stringify(state));
        } catch (err) {
            // Don't care
        }
    }

    function stateChangeHandler() {
        // Handles both 'resize' and 'move'
        clearTimeout(stateChangeTimer);
        stateChangeTimer = setTimeout(() => saveState(winRef), eventHandlingDelay);
    }

    function closeHandler() {
        updateState();
    }

    function closedHandler() {
        // Unregister listeners and save state
        unmanage();
        saveState();
    }

    function manage(win) {
        if (config.maximize && state.isMaximized) {
            win.maximize();
        }
        if (config.fullScreen && state.isFullScreen) {
            win.setFullScreen(true);
        }

        function resizeBrowserView() {
            try {
                const view = win.getBrowserView();
                if (view) {
                    const windowBounds = win.getBounds(); // Full window size
                    const screenBounds = screen.getPrimaryDisplay().bounds; // Screen size

                    // Calculate the usable area by subtracting window chrome and any borders
                    const width = windowBounds.width;  // Width of the full window
                    const height = windowBounds.height;  // Height of the full window

                    // Ensure BrowserView fits within the screen size and window size
                    view.setBounds({
                        x: 0,
                        y: 0,
                        width: Math.min(width, screenBounds.width),  // Prevent overflow horizontally
                        height: Math.min(height, screenBounds.height)  // Prevent overflow vertically
                    });
                }
            } catch (err) {
                // Ignore errors if BrowserView is not present
            }
        }

        function stateChangeHandlerWithBrowserView() {
            stateChangeHandler(); // Preserve original behavior
            resizeBrowserView();  // Resize BrowserView if applicable
        }

        win.on('resize', stateChangeHandler);
        win.on('move', stateChangeHandler);
        win.on('close', closeHandler);
        win.on('closed', closedHandler);

        // Initial BrowserView resize in case window is already open
        resizeBrowserView();

        winRef = win;
    }

    function unmanage() {
        if (winRef) {
            winRef.removeListener('resize', stateChangeHandler);
            winRef.removeListener('move', stateChangeHandler);
            clearTimeout(stateChangeTimer);
            winRef.removeListener('close', closeHandler);
            winRef.removeListener('closed', closedHandler);
            winRef = null;
        }
    }

    // Load previous state
    try {
        state = JSON.parse(fs.readFileSync(fullStoreFileName, 'utf8'));
    } catch (err) {
        // Don't care
    }

    // Check state validity
    validateState();

    // Set state fallback values
    state = Object.assign({
        width: config.defaultWidth || 800,
        height: config.defaultHeight || 600
    }, state || {});

    return {
        get x() { return state.x; },
        get y() { return state.y; },
        get width() { return state.width; },
        get height() { return state.height; },
        get displayBounds() { return state.displayBounds; },
        get isMaximized() { return state.isMaximized; },
        get isFullScreen() { return state.isFullScreen; },
        saveState,
        unmanage,
        manage,
        resetStateToDefault
    };
};