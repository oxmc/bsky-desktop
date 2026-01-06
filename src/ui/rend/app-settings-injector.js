console.log("App Settings Injector loaded");

// Wait for the settings page to load and inject our custom app settings section
function injectAppSettings() {
    // Check if we're on the settings page
    const isSettingsPage = window.location.pathname.includes('/settings');
    
    if (!isSettingsPage) return;

    // Wait for the settings content to be available
    const settingsContainer = document.querySelector('[data-testid="settingsPage"]') || 
                             document.querySelector('main[role="main"]');
    
    if (!settingsContainer) {
        console.log("Settings container not found, retrying...");
        setTimeout(injectAppSettings, 500);
        return;
    }

    // Check if already injected
    if (document.getElementById('bsky-desktop-app-settings')) {
        console.log("App settings already injected");
        return;
    }

    console.log("Injecting app settings button...");

    // Find the parent container - look for the container with the "Account" link
    const accountLink = settingsContainer.querySelector('a[href="/settings/account"]');
    
    if (!accountLink) {
        console.log("Account link not found, retrying...");
        setTimeout(injectAppSettings, 500);
        return;
    }

    const settingsList = accountLink.parentElement;
    console.log("Found settings list:", settingsList);
    
    if (!settingsList) {
        console.log("Settings list not found, retrying...");
        setTimeout(injectAppSettings, 500);
        return;
    }

    // Find the first divider to insert before it
    const firstDivider = Array.from(settingsList.children).find(child => 
        child.style.borderTopWidth === '1px'
    );
    
    console.log("First divider:", firstDivider);

    // Create the app settings button matching Bluesky's exact structure
    const appSettingsButton = document.createElement('button');
    appSettingsButton.id = 'bsky-desktop-app-settings';
    appSettingsButton.setAttribute('aria-label', 'Desktop App Settings');
    appSettingsButton.setAttribute('aria-pressed', 'false');
    appSettingsButton.setAttribute('role', 'button');
    appSettingsButton.setAttribute('tabindex', '0');
    appSettingsButton.className = 'css-g5y9jx r-1loqt21 r-1otgn73';
    appSettingsButton.type = 'button';
    appSettingsButton.style.cssText = 'flex-direction: row; align-items: center; justify-content: center;';

    // Inner container
    const innerContainer = document.createElement('div');
    innerContainer.className = 'css-g5y9jx';
    innerContainer.style.cssText = 'padding: 8px 20px; align-items: center; gap: 8px; width: 100%; flex-direction: row; min-height: 48px;';

    // Icon container
    const iconContainer = document.createElement('div');
    iconContainer.className = 'css-g5y9jx';
    iconContainer.style.cssText = 'z-index: 20; width: 24px; height: 24px;';
    
    // Desktop icon SVG
    iconContainer.innerHTML = `<svg fill="none" width="24" viewBox="0 0 24 24" height="24" style="color: rgb(255, 255, 255);">
        <path fill="#FFFFFF" stroke="none" stroke-width="0" d="M2 5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-6v2h3a1 1 0 1 1 0 2H7a1 1 0 1 1 0-2h3v-2H4a2 2 0 0 1-2-2V5Zm2 0h16v10H4V5Z"></path>
    </svg>`;

    // Text
    const textDiv = document.createElement('div');
    textDiv.setAttribute('dir', 'auto');
    textDiv.className = 'css-146c3p1';
    textDiv.style.cssText = 'font-size: 15px; letter-spacing: 0px; color: rgb(255, 255, 255); text-align: left; font-weight: 400; flex: 1 1 0%; line-height: 15px; font-family: InterVariable, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji"; font-variant: no-contextual;';
    textDiv.textContent = 'Desktop App';

    // Chevron
    const chevronContainer = document.createElement('div');
    chevronContainer.className = 'css-g5y9jx';
    chevronContainer.style.cssText = 'z-index: 20; width: 20px; height: 20px;';
    chevronContainer.innerHTML = `<svg fill="none" width="20" viewBox="0 0 24 24" height="20" style="color: rgb(111, 131, 159);">
        <path fill="#6F839F" stroke="none" stroke-width="0" fill-rule="evenodd" clip-rule="evenodd" d="M8.293 3.293a1 1 0 0 1 1.414 0l8 8a1 1 0 0 1 0 1.414l-8 8a1 1 0 0 1-1.414-1.414L15.586 12 8.293 4.707a1 1 0 0 1 0-1.414Z"></path>
    </svg>`;

    // Assemble
    innerContainer.appendChild(iconContainer);
    innerContainer.appendChild(textDiv);
    innerContainer.appendChild(chevronContainer);
    appSettingsButton.appendChild(innerContainer);

    // Click handler
    appSettingsButton.addEventListener('click', () => {
        if (window.showAppSettingsModal) {
            window.showAppSettingsModal();
        } else {
            console.error('App settings modal not loaded');
        }
    });

    // Insert right after the "Add another account" button and before the first divider
    const addAccountButton = Array.from(settingsList.children).find(child => 
        child.tagName === 'BUTTON' && child.textContent.includes('Add another account')
    );
    
    if (addAccountButton && addAccountButton.nextElementSibling) {
        console.log("Inserting after Add another account button");
        settingsList.insertBefore(appSettingsButton, addAccountButton.nextElementSibling);
    } else if (firstDivider) {
        console.log("Inserting before first divider");
        settingsList.insertBefore(appSettingsButton, firstDivider);
    } else {
        console.log("Inserting before Account link");
        settingsList.insertBefore(appSettingsButton, accountLink);
    }

    console.log("App settings button element:", appSettingsButton);
    console.log("App settings injected successfully");
}

// Monitor for route changes (Bluesky is a SPA)
let lastUrl = location.href;
new MutationObserver(() => {
    const url = location.href;
    if (url !== lastUrl) {
        lastUrl = url;
        setTimeout(injectAppSettings, 300);
    }
}).observe(document.body, { subtree: true, childList: true });

// Initial injection
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        setTimeout(injectAppSettings, 1000);
    });
} else {
    setTimeout(injectAppSettings, 1000);
}
