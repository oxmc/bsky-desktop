const { exec } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

// Get system information
const SystemInfo = require('../../utils/sysInfo');

// Get the current system platform
const sys = new SystemInfo();

// Only import the registry package if the system is Windows
let Registry;
if (sys.platform === 'win32') {
    Registry = require('winreg');
}

// Get the uninstall entries from the registry
async function getUninstallEntries(filter = {}) {
    if (sys.platform !== 'win32') {
        console.error('This function only works on Windows.');
        return [];
    }

    const registryPaths = [
        'HKLM\\\\Software\\\\Microsoft\\\\Windows\\\\CurrentVersion\\\\Uninstall',
        'HKLM\\\\Software\\\\Wow6432Node\\\\Microsoft\\\\Windows\\\\CurrentVersion\\\\Uninstall'
    ];

    let results = [];

    for (const regPath of registryPaths) {
        const regKey = new Registry({ hive: Registry.HKLM, key: regPath });

        try {
            const subkeys = await new Promise((resolve, reject) => {
                regKey.keys((err, keys) => {
                    if (err) reject(err);
                    else resolve(keys);
                });
            });

            for (const subkey of subkeys) {
                const values = await new Promise((resolve, reject) => {
                    subkey.values((err, items) => {
                        if (err) reject(err);
                        else resolve(items);
                    });
                });

                let entry = {};
                values.forEach(item => {
                    if (item.name === 'DisplayName') entry.DisplayName = item.value;
                    if (item.name === 'Publisher') entry.Publisher = item.value;
                    if (item.name === 'InstallDate') entry.InstallDate = item.value;
                    if (item.name === 'DisplayVersion') entry.DisplayVersion = item.value;
                    if (item.name === 'HelpLink') entry.HelpLink = item.value;
                    if (item.name === 'UninstallString') entry.UninstallString = item.value;
                    if (item.name === 'WindowsInstaller') entry.WindowsInstaller = item.value === '1' ? 'MSI' : 'EXE';
                });

                if (entry.DisplayName && entry.UninstallString) {
                    // If WindowsInstaller value is missing, check UninstallString
                    if (!entry.WindowsInstaller) {
                        entry.WindowsInstaller = entry.UninstallString.includes('msiexec') ? 'MSI' : 'EXE';
                    }

                    results.push(entry);
                }
            }
        } catch (error) {
            console.error(`Error accessing registry path ${regPath}:`, error);
        }
    }

    results.sort((a, b) => a.DisplayName.localeCompare(b.DisplayName));

    // Filter results based on the provided filter (e.g., { DisplayName: 'bskyDesktop' })
    if (filter.DisplayName) {
        return results.filter(entry => entry.DisplayName?.includes(filter.DisplayName));
    }

    //console.log(results);
    return results;
}

async function checkAppInstallationMethod(appPath, bundleId) {
    if (!fs.existsSync(appPath)) {
        return { error: "App does not exist at the specified path." };
    }

    try {
        // Check for Mac App Store receipt
        const { stdout: masOutput } = await execPromise(`mdls -name kMDItemAppStoreReceiptURL "${appPath}"`);
        if (!masOutput.includes("(null)")) {
            return { type: "MAS" };
        }

        // Check for PKG installation
        try {
            const { stdout: pkgOutput } = await execPromise(`pkgutil --pkg-info "${bundleId}"`);
            return { type: "PKG", stdout: pkgOutput };
        } catch {
            // Ignore error; means PKG is not found
        }

        // Check if manually installed (ZIP/DMG)
        const receiptPath = path.join(appPath, 'Contents', '_MASReceipt', 'receipt');
        if (!fs.existsSync(receiptPath)) {
            return { type: "ZIP/DMG" };
        }

    } catch (error) {
        return { error: error.message };
    }
}

module.exports = {
    getUninstallEntries,
    checkAppInstallationMethod
};