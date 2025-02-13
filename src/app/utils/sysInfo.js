const os = require('os');
const childProcess = require('child_process');

class SystemInfo {
  constructor() {
    this.platform = os.platform(); // 'win32', 'darwin', 'linux'
    this.release = os.release(); // OS version
    this.arch = os.arch(); // 'arm', 'arm64', 'x64', 'x86'
    this.versionInfo = this._getVersionInfo(); // Parsed version
  }

  // Check if current system is Windows
  isWin() {
    return this.platform === 'win32';
  }

  // Check if current system is macOS
  isMac() {
    return this.platform === 'darwin';
  }

  // Check if current system is Linux
  isLinux() {
    return this.platform === 'linux';
  }

  // Check if current system architecture is ARM
  isARM() {
    return this.arch === 'arm';
  }

  // Check if current system architecture is ARM64
  isARM64() {
    return this.arch === 'arm64';
  }

  // Check if current system architecture is x64
  isX64() {
    return this.arch === 'x64';
  }

  // Check if current system architecture is x86
  isX86() {
    return this.arch === 'x86';
  }

  // Compare if current version is later than the given version
  laterThan(compareVersion) {
    const current = this.versionInfo;
    const compare = this._parseVersion(compareVersion);

    for (let i = 0; i < current.length; i++) {
      if ((current[i] || 0) > (compare[i] || 0)) return true;
      if ((current[i] || 0) < (compare[i] || 0)) return false;
    }
    return false;
  }

  // Compare if current version is earlier than the given version
  earlierThan(compareVersion) {
    return !this.laterThan(compareVersion);
  }

  // Get edition of the os
  getEdition() {
    if (this.isWin()) {
      const edition = childProcess.execSync('wmic os get Caption').toString().trim();
      return edition.split('\n')[1].trim();
    } else {
      return 'N/A';
    }
  }

  // Private: Parse version strings (e.g., "10.0.19045" -> [10, 0, 19045])
  _parseVersion(version) {
    return version.split('.').map((num) => parseInt(num, 10) || 0);
  }

  // Private: Get detailed version info based on platform
  _getVersionInfo() {
    if (this.isWin()) {
      // Windows version is already available via os.release()
      return this._parseVersion(this.release);
    } else if (this.isMac()) {
      // Get macOS version via 'sw_vers'
      const version = childProcess.execSync('sw_vers -productVersion').toString().trim();
      return this._parseVersion(version);
    } else if (this.isLinux()) {
      // Use 'uname -r' for kernel version
      const version = childProcess.execSync('uname -r').toString().trim();
      return this._parseVersion(version);
    } else {
      return [0, 0, 0]; // Unknown system
    }
  }

  // Get current version as a string (e.g., "10.15.7")
  getVersion() {
    return this.versionInfo.join('.');
  }
}

module.exports = SystemInfo;

// Usage Example
//const sys = new SystemInfo();
//console.log(`Is Windows: ${sys.isWin()}`);
//console.log(`Is macOS: ${sys.isMac()}`);
//console.log(`Is Linux: ${sys.isLinux()}`);
//console.log(`Current Version Info: ${sys.getVersion()}`);
//console.log(`Later than 10.0.19044: ${sys.laterThan('10.0.19044')}`);
//console.log(`Later than 5.15.0 (Linux Kernel): ${sys.laterThan('5.15.0')}`);