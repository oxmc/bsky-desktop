// App Settings Modal - Builds and manages the settings UI
async function showAppSettingsModal() {
    // Check if modal already exists
    if (document.getElementById('bsky-app-settings-modal')) {
        return;
    }

    // Load current settings
    let settings = {};
    try {
        settings = await window.ipc.invoke('app:getSettings');
    } catch (error) {
        console.error('Failed to load settings:', error);
        iziToast.error({
            title: 'Error',
            message: 'Failed to load settings',
            position: 'topRight'
        });
        return;
    }

    // Create modal overlay
    const overlay = document.createElement('div');
    overlay.id = 'bsky-app-settings-modal';
    overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background-color: rgba(0, 0, 0, 0.7);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
        animation: fadeIn 0.2s ease-in-out;
    `;

    // Create modal container
    const modal = document.createElement('div');
    modal.style.cssText = `
        background-color: rgb(22, 24, 27);
        border-radius: 16px;
        width: 90%;
        max-width: 650px;
        max-height: 85vh;
        overflow-y: auto;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
        animation: slideUp 0.3s ease-out;
    `;

    // Modal header
    const header = document.createElement('div');
    header.style.cssText = `
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 20px 24px;
        border-bottom: 1px solid rgb(47, 51, 56);
        position: sticky;
        top: 0;
        background-color: rgb(22, 24, 27);
        z-index: 10;
    `;

    const headerTitle = document.createElement('h2');
    headerTitle.style.cssText = `
        margin: 0;
        font-size: 20px;
        font-weight: 600;
        color: rgb(255, 255, 255);
    `;
    headerTitle.innerHTML = '<i class="fa-solid fa-desktop" style="margin-right: 8px;"></i>Desktop App Settings';

    const closeButton = document.createElement('button');
    closeButton.style.cssText = `
        background: none;
        border: none;
        color: rgb(159, 167, 179);
        font-size: 24px;
        cursor: pointer;
        padding: 0;
        width: 32px;
        height: 32px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 50%;
        transition: background-color 0.2s;
    `;
    closeButton.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    closeButton.addEventListener('mouseenter', () => {
        closeButton.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
    });
    closeButton.addEventListener('mouseleave', () => {
        closeButton.style.backgroundColor = 'transparent';
    });
    closeButton.addEventListener('click', () => {
        overlay.remove();
    });

    header.appendChild(headerTitle);
    header.appendChild(closeButton);

    // Modal content
    const content = document.createElement('div');
    content.style.cssText = `padding: 24px;`;
    content.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 24px;">
            <!-- Updates Section -->
            <div>
                <h3 style="margin: 0 0 16px 0; font-size: 16px; font-weight: 600; color: rgb(255, 255, 255);">
                    <i class="fa-solid fa-download" style="margin-right: 8px; color: rgb(16, 131, 254);"></i>Updates
                </h3>
                
                <!-- Update Channel (Hidden for now) -->
                <div style="margin-bottom: 16px; display: none;">
                    <label style="display: block; font-size: 14px; font-weight: 500; color: rgb(255, 255, 255); margin-bottom: 8px;">
                        Update Channel
                    </label>
                    <select id="setting-update-channel" style="width: 100%; padding: 10px 12px; background-color: rgb(30, 33, 37); color: rgb(255, 255, 255); border: 1px solid rgb(47, 51, 56); border-radius: 8px; font-size: 14px; cursor: pointer;">
                        <option value="stable" ${settings.updates?.channel === 'stable' ? 'selected' : ''}>Stable (Recommended)</option>
                        <option value="beta" ${settings.updates?.channel === 'beta' ? 'selected' : ''}>Beta (Testing)</option>
                        <option value="dev" ${settings.updates?.channel === 'dev' ? 'selected' : ''}>Dev (Experimental)</option>
                    </select>
                    <div style="font-size: 12px; color: rgb(159, 167, 179); margin-top: 6px;">
                        Choose which update channel to receive updates from
                    </div>
                </div>

                <!-- Auto Check Updates -->
                <div style="display: flex; align-items: center; justify-content: space-between; padding: 12px 0;">
                    <div>
                        <div style="font-size: 14px; font-weight: 500; color: rgb(255, 255, 255);">Auto-check for updates</div>
                        <div style="font-size: 12px; color: rgb(159, 167, 179); margin-top: 2px;">Automatically check for updates periodically</div>
                    </div>
                    <label class="toggle-switch">
                        <input type="checkbox" id="setting-auto-check" ${settings.updates?.autoCheck ? 'checked' : ''}>
                        <span class="toggle-slider"></span>
                    </label>
                </div>

                <!-- Auto Download -->
                <div style="display: flex; align-items: center; justify-content: space-between; padding: 12px 0;">
                    <div>
                        <div style="font-size: 14px; font-weight: 500; color: rgb(255, 255, 255);">Auto-download updates</div>
                        <div style="font-size: 12px; color: rgb(159, 167, 179); margin-top: 2px;">Download updates automatically when available</div>
                    </div>
                    <label class="toggle-switch">
                        <input type="checkbox" id="setting-auto-download" ${settings.updates?.autoDownload ? 'checked' : ''}>
                        <span class="toggle-slider"></span>
                    </label>
                </div>

                <!-- Auto Install on Quit -->
                <div style="display: flex; align-items: center; justify-content: space-between; padding: 12px 0;">
                    <div>
                        <div style="font-size: 14px; font-weight: 500; color: rgb(255, 255, 255);">Install on quit</div>
                        <div style="font-size: 12px; color: rgb(159, 167, 179); margin-top: 2px;">Install updates when the app closes</div>
                    </div>
                    <label class="toggle-switch">
                        <input type="checkbox" id="setting-auto-install" ${settings.updates?.autoInstallOnQuit ? 'checked' : ''}>
                        <span class="toggle-slider"></span>
                    </label>
                </div>
            </div>

            <div style="border-top: 1px solid rgb(47, 51, 56);"></div>

            <!-- Appearance Section -->
            <div>
                <h3 style="margin: 0 0 16px 0; font-size: 16px; font-weight: 600; color: rgb(255, 255, 255);">
                    <i class="fa-solid fa-paintbrush" style="margin-right: 8px; color: rgb(16, 131, 254);"></i>Appearance
                </h3>
                
                <!-- Close to Tray -->
                <div style="display: flex; align-items: center; justify-content: space-between; padding: 12px 0;">
                    <div>
                        <div style="font-size: 14px; font-weight: 500; color: rgb(255, 255, 255);">Close to system tray</div>
                        <div style="font-size: 12px; color: rgb(159, 167, 179); margin-top: 2px;">Minimize to tray instead of quitting</div>
                    </div>
                    <label class="toggle-switch">
                        <input type="checkbox" id="setting-close-to-tray" ${settings.appearance?.closeToTray ? 'checked' : ''}>
                        <span class="toggle-slider"></span>
                    </label>
                </div>

                <!-- Badge System Accent -->
                <div style="display: flex; align-items: center; justify-content: space-between; padding: 12px 0;">
                    <div>
                        <div style="font-size: 14px; font-weight: 500; color: rgb(255, 255, 255);">Use system accent for badge</div>
                        <div style="font-size: 12px; color: rgb(159, 167, 179); margin-top: 2px;">Match notification badge color to system theme</div>
                    </div>
                    <label class="toggle-switch">
                        <input type="checkbox" id="setting-badge-accent" ${settings.badge?.useSystemAccent ? 'checked' : ''}>
                        <span class="toggle-slider"></span>
                    </label>
                </div>
            </div>

            <div style="border-top: 1px solid rgb(47, 51, 56);"></div>

            <!-- Quick Actions -->
            <div>
                <h3 style="margin: 0 0 16px 0; font-size: 16px; font-weight: 600; color: rgb(255, 255, 255);">
                    <i class="fa-solid fa-bolt" style="margin-right: 8px; color: rgb(16, 131, 254);"></i>Quick Actions
                </h3>

                <button id="action-restart" style="width: 100%; padding: 14px; background-color: rgba(255, 255, 255, 0.05); color: rgb(255, 255, 255); border: none; border-radius: 8px; font-size: 14px; font-weight: 500; cursor: pointer; transition: background-color 0.2s; text-align: left; display: flex; align-items: center; justify-content: space-between;">
                    <div style="display: flex; align-items: center;">
                        <i class="fa-solid fa-rotate-right" style="margin-right: 12px; color: rgb(16, 131, 254);"></i>
                        <span>Restart Application</span>
                    </div>
                    <i class="fa-solid fa-chevron-right" style="color: rgb(159, 167, 179); font-size: 12px;"></i>
                </button>
            </div>

            <!-- Save Button -->
            <button id="save-settings" style="width: 100%; padding: 14px; background-color: rgb(16, 131, 254); color: rgb(255, 255, 255); border: none; border-radius: 8px; font-size: 15px; font-weight: 600; cursor: pointer; transition: background-color 0.2s;">
                <i class="fa-solid fa-save" style="margin-right: 8px;"></i>Save Settings
            </button>
        </div>
    `;

    // Add toggle switch styles
    const style = document.createElement('style');
    style.textContent = `
        @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
        }
        @keyframes slideUp {
            from { opacity: 0; transform: translateY(20px); }
            to { opacity: 1; transform: translateY(0); }
        }
        .toggle-switch {
            position: relative;
            display: inline-block;
            width: 44px;
            height: 24px;
        }
        .toggle-switch input {
            opacity: 0;
            width: 0;
            height: 0;
        }
        .toggle-slider {
            position: absolute;
            cursor: pointer;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background-color: rgb(47, 51, 56);
            transition: 0.3s;
            border-radius: 24px;
        }
        .toggle-slider:before {
            position: absolute;
            content: "";
            height: 18px;
            width: 18px;
            left: 3px;
            bottom: 3px;
            background-color: white;
            transition: 0.3s;
            border-radius: 50%;
        }
        input:checked + .toggle-slider {
            background-color: rgb(16, 131, 254);
        }
        input:checked + .toggle-slider:before {
            transform: translateX(20px);
        }
        #action-restart:hover {
            background-color: rgba(255, 255, 255, 0.1);
        }
        #save-settings:hover {
            background-color: rgb(14, 116, 225);
        }
    `;
    document.head.appendChild(style);

    modal.appendChild(header);
    modal.appendChild(content);
    overlay.appendChild(modal);

    // Event handlers
    content.querySelector('#save-settings').addEventListener('click', async () => {
        const newSettings = {
            updates: {
                channel: content.querySelector('#setting-update-channel').value,
                autoCheck: content.querySelector('#setting-auto-check').checked,
                autoDownload: content.querySelector('#setting-auto-download').checked,
                autoInstallOnQuit: content.querySelector('#setting-auto-install').checked
            },
            appearance: {
                closeToTray: content.querySelector('#setting-close-to-tray').checked
            },
            badge: {
                useSystemAccent: content.querySelector('#setting-badge-accent').checked
            }
        };

        try {
            const result = await window.ipc.invoke('app:saveSettings', newSettings);
            if (result.success) {
                const message = result.requiresRestart 
                    ? 'Settings saved! Please restart the app to apply all changes.'
                    : 'Settings saved successfully!';
                    
                iziToast.success({
                    title: 'Success',
                    message: message,
                    position: 'topRight',
                    timeout: result.requiresRestart ? 6000 : 3000,
                    buttons: result.requiresRestart ? [
                        ['<button>Restart Now</button>', function (instance, toast) {
                            window.ipc.send('app:restart');
                            instance.hide({ transitionOut: 'fadeOut' }, toast, 'button');
                        }, true]
                    ] : []
                });
                overlay.remove();
            } else {
                throw new Error(result.error || 'Unknown error');
            }
        } catch (error) {
            console.error('Failed to save settings:', error);
            iziToast.error({
                title: 'Error',
                message: 'Failed to save settings: ' + error.message,
                position: 'topRight'
            });
        }
    });

    content.querySelector('#action-restart').addEventListener('click', () => {
        if (window.ipc) {
            window.ipc.send('app:restart');
            overlay.remove();
        }
    });

    // Close on overlay click
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            overlay.remove();
        }
    });

    document.body.appendChild(overlay);
}

// Export for use in main injector
window.showAppSettingsModal = showAppSettingsModal;
