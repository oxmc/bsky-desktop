const electron = require('electron');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Get app name for storage paths
const app = electron.app || electron.remote.app;
const appName = app.getName();

// Encryption parameters
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;

// SafeStorage class
class SafeStorage {
    constructor() {
        this._key = null;
        this._usePlainText = false;
        this._storageBackend = 'basic_text';
        this._isEncryptionAvailable = false;
        this._keyStoragePath = null;

        this._initializeKey();
    }

    /**
     * Get platform-specific master key
     * @private
     */
    _getPlatformKey() {
        try {
            switch (process.platform) {
                case 'win32':
                    return this._getWindowsKey();
                case 'darwin':
                    return this._getMacKey();
                case 'linux':
                    return this._getLinuxKey();
                default:
                    return this._getFallbackKey();
            }
        } catch (error) {
            console.warn('Platform key unavailable, using fallback:', error.message);
            return this._getFallbackKey();
        }
    }

    /**
     * Windows: Use DPAPI-like approach with system credentials
     * @private
     */
    _getWindowsKey() {
        // Use machine and user-specific information
        const machineId = process.env.COMPUTERNAME || 'unknown-machine';
        const userProfile = process.env.USERPROFILE || process.env.HOMEPATH || 'unknown-user';
        const systemRoot = process.env.SystemRoot || 'C:\\Windows';

        const keyMaterial = `${machineId}:${userProfile}:${systemRoot}`;
        const hash = crypto.createHash('sha256');
        hash.update(keyMaterial);
        return hash.digest().slice(0, KEY_LENGTH);
    }

    /**
     * macOS: Use Keychain-like approach
     * @private
     */
    _getMacKey() {
        // Use system and user-specific information
        const serialNumber = this._getMacSerialNumber();
        const userUid = process.getuid ? process.getuid().toString() : 'unknown-uid';
        const homeDir = os.homedir();

        const keyMaterial = `${serialNumber}:${userUid}:${homeDir}`;
        const hash = crypto.createHash('sha256');
        hash.update(keyMaterial);
        return hash.digest().slice(0, KEY_LENGTH);
    }

    /**
     * Try to get Mac serial number
     * @private
     */
    _getMacSerialNumber() {
        try {
            if (fs.existsSync('/usr/sbin/system_profiler')) {
                const { execSync } = require('child_process');
                const result = execSync('/usr/sbin/system_profiler SPHardwareDataType', { encoding: 'utf8' });
                const match = result.match(/Serial Number \(system\): (.+)/);
                return match ? match[1].trim() : 'unknown-serial';
            }
        } catch (error) {
            // Fallback to other system information
        }

        // Fallback options
        const hostname = os.hostname();
        const username = os.userInfo().username;
        return `${hostname}:${username}`;
    }

    /**
     * Linux: Use keyring-like approach with system information
     * @private
     */
    _getLinuxKey() {
        try {
            // Try to use machine-id (available on most Linux systems)
            let machineId = 'unknown-machine';
            if (fs.existsSync('/etc/machine-id')) {
                machineId = fs.readFileSync('/etc/machine-id', 'utf8').trim();
            } else if (fs.existsSync('/var/lib/dbus/machine-id')) {
                machineId = fs.readFileSync('/var/lib/dbus/machine-id', 'utf8').trim();
            }

            const userUid = process.getuid().toString();
            const homeDir = os.homedir();

            const keyMaterial = `${machineId}:${userUid}:${homeDir}`;
            const hash = crypto.createHash('sha256');
            hash.update(keyMaterial);
            return hash.digest().slice(0, KEY_LENGTH);
        } catch (error) {
            return this._getFallbackKey();
        }
    }

    /**
     * Fallback key when platform-specific methods fail
     * @private
     */
    _getFallbackKey() {
        // Use combination of hostname, username, and homedir
        const hostname = os.hostname();
        const username = os.userInfo().username;
        const homeDir = os.homedir();

        const keyMaterial = `${hostname}:${username}:${homeDir}`;
        const hash = crypto.createHash('sha256');
        hash.update(keyMaterial);
        return hash.digest().slice(0, KEY_LENGTH);
    }

    /**
     * Encrypt data with platform key
     * @private
     */
    _encryptWithPlatformKey(data) {
        const platformKey = this._getPlatformKey();
        const iv = crypto.randomBytes(IV_LENGTH);
        const cipher = crypto.createCipheriv(ALGORITHM, platformKey, iv);

        const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
        const tag = cipher.getAuthTag();

        return Buffer.concat([iv, tag, encrypted]);
    }

    /**
     * Decrypt data with platform key
     * @private
     */
    _decryptWithPlatformKey(encryptedData) {
        try {
            const platformKey = this._getPlatformKey();
            const iv = encryptedData.slice(0, IV_LENGTH);
            const tag = encryptedData.slice(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
            const data = encryptedData.slice(IV_LENGTH + TAG_LENGTH);

            const decipher = crypto.createDecipheriv(ALGORITHM, platformKey, iv);
            decipher.setAuthTag(tag);

            return Buffer.concat([decipher.update(data), decipher.final()]);
        } catch (error) {
            throw new Error('Failed to decrypt with platform key: ' + error.message);
        }
    }

    /**
     * Initialize encryption key automatically
     * @private
     */
    _initializeKey() {
        try {
            // Try to load existing key from storage
            this._key = this._loadEncryptionKey();

            if (!this._key) {
                // Generate new key if none exists
                this._key = crypto.randomBytes(KEY_LENGTH);
                this._saveEncryptionKey(this._key);
            }

            this._isEncryptionAvailable = true;
        } catch (error) {
            console.warn('Encryption not available:', error.message);
            this._isEncryptionAvailable = false;
            this._usePlainText = true;
        }
    }

    /**
     * Load encryption key from secure storage
     * @private
     */
    _loadEncryptionKey() {
        try {
            // Try to get key from environment variable (highest priority)
            if (process.env.APP_ENCRYPTION_KEY) {
                const keyBuffer = Buffer.from(process.env.APP_ENCRYPTION_KEY, 'base64');
                if (keyBuffer.length === KEY_LENGTH) {
                    return keyBuffer;
                }
            }

            const keyPath = this._getKeyStoragePath();

            if (fs.existsSync(keyPath)) {
                const encryptedKeyData = fs.readFileSync(keyPath);

                // Decrypt with platform-specific key
                const decryptedKey = this._decryptWithPlatformKey(encryptedKeyData);

                if (decryptedKey.length === KEY_LENGTH) {
                    return decryptedKey;
                } else {
                    console.warn('Stored key has invalid length, generating new key');
                    // Key file is corrupted, remove it
                    fs.unlinkSync(keyPath);
                }
            }

            return null;
        } catch (error) {
            console.warn('Failed to load encryption key:', error.message);
            return null;
        }
    }

    /**
     * Save encryption key to secure storage
     * @private
     */
    _saveEncryptionKey(key) {
        try {
            const keyPath = this._getKeyStoragePath();
            const keyDir = path.dirname(keyPath);

            // Ensure directory exists
            if (!fs.existsSync(keyDir)) {
                fs.mkdirSync(keyDir, { recursive: true, mode: 0o700 });
            }

            // Encrypt the key with platform-specific key before storing
            const encryptedKey = this._encryptWithPlatformKey(key);

            fs.writeFileSync(keyPath, encryptedKey, { mode: 0o600 });

            // Set appropriate file permissions
            if (process.platform !== 'win32') {
                fs.chmodSync(keyPath, 0o600);
            }

            console.log('Encryption key saved to:', keyPath);
        } catch (error) {
            console.warn('Could not save encryption key:', error.message);
            throw error;
        }
    }

    /**
     * Get platform-specific key storage path
     * @private
     */
    _getKeyStoragePath() {
        if (this._keyStoragePath) {
            return this._keyStoragePath;
        }

        let basePath;

        switch (process.platform) {
            case 'win32':
                basePath = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
                break;
            case 'darwin':
                basePath = path.join(os.homedir(), 'Library', 'Application Support');
                break;
            default: // Linux and other Unix-like
                basePath = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
        }

        const keyPath = path.join(basePath, appName, 'encryption.key');
        this._keyStoragePath = keyPath;
        return keyPath;
    }

    // Public API methods
    setKeyStoragePath(customPath) {
        this._keyStoragePath = customPath;
    }

    isEncryptionAvailable() {
        return this._isEncryptionAvailable && !this._usePlainText;
    }

    encryptString(plainText) {
        if (!this.isEncryptionAvailable()) {
            throw new Error('Encryption is not available');
        }

        if (this._usePlainText) {
            return Buffer.from(plainText, 'utf8');
        }

        try {
            const iv = crypto.randomBytes(IV_LENGTH);
            const cipher = crypto.createCipheriv(ALGORITHM, this._key, iv);

            const encrypted = Buffer.concat([
                cipher.update(plainText, 'utf8'),
                cipher.final()
            ]);

            const tag = cipher.getAuthTag();

            return Buffer.concat([iv, tag, encrypted]);

        } catch (err) {
            throw new Error(`Encryption failed: ${err.message}`);
        }
    }

    decryptString(encryptedBuffer) {
        if (!this.isEncryptionAvailable()) {
            throw new Error('Encryption is not available');
        }

        if (this._usePlainText) {
            return encryptedBuffer.toString('utf8');
        }

        try {
            const iv = encryptedBuffer.slice(0, IV_LENGTH);
            const tag = encryptedBuffer.slice(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
            const encryptedData = encryptedBuffer.slice(IV_LENGTH + TAG_LENGTH);

            const decipher = crypto.createDecipheriv(ALGORITHM, this._key, iv);
            decipher.setAuthTag(tag);

            const decrypted = Buffer.concat([
                decipher.update(encryptedData),
                decipher.final()
            ]);

            return decrypted.toString('utf8');

        } catch (err) {
            if (err.message.includes('auth tag')) {
                throw new Error('Decryption failed: Data may be corrupted or tampered with');
            }
            throw new Error(`Decryption failed: ${err.message}`);
        }
    }

    setEncryptionKey(key) {
        if (Buffer.isBuffer(key) && key.length === KEY_LENGTH) {
            this._key = Buffer.from(key);
            this._isEncryptionAvailable = true;
            this._usePlainText = false;
            this._saveEncryptionKey(this._key);
        } else if (typeof key === 'string') {
            const hash = crypto.createHash('sha256');
            hash.update(key);
            this._key = hash.digest();
            this._isEncryptionAvailable = true;
            this._usePlainText = false;
            this._saveEncryptionKey(this._key);
        } else {
            throw new Error('Key must be a 32-byte Buffer or a string');
        }
    }

    getEncryptionKey() {
        if (!this._key) {
            throw new Error('No encryption key available');
        }
        return Buffer.from(this._key);
    }

    setUsePlainTextEncryption(usePlainText = false) {
        this._usePlainText = usePlainText;
    }

    getSelectedStorageBackend() {
        return this._storageBackend;
    }

    clearKey() {
        if (this._key) {
            this._key.fill(0);
            this._key = null;
        }
        this._isEncryptionAvailable = false;
        this._usePlainText = true;
    }

    resetEncryptionKey() {
        this.clearKey();
        // Remove the key file
        try {
            const keyPath = this._getKeyStoragePath();
            if (fs.existsSync(keyPath)) {
                fs.unlinkSync(keyPath);
            }
        } catch (error) {
            // Ignore errors when removing key file
        }
        this._initializeKey();
    }

    /**
     * Get information about the current platform and key status
     */
    getPlatformInfo() {
        return {
            platform: process.platform,
            keyStoragePath: this._getKeyStoragePath(),
            platformKeyDerived: !!this._getPlatformKey(),
            isEncryptionAvailable: this.isEncryptionAvailable(),
            hasStoredKey: fs.existsSync(this._getKeyStoragePath())
        };
    }
}

// Create singleton instance
const safeStorage = new SafeStorage();

module.exports = safeStorage;