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

  // Get edition of the os (Windows only, uses execSync - WARNING: can block)
  getEdition() {
    if (this.isWin()) {
      try {
        // Use /NH (No Header) and /FO CSV (Format CSV) for more reliable parsing
        const result = childProcess.execSync('wmic os get Caption /Value', { stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).toString();
        const match = result.match(/Caption=(.*)/i);
        if (match && match[1]) {
          return match[1].trim();
        }
      } catch (e) {
        console.error(`SystemInfo: Failed to get Windows edition: ${e.message}`);
      }
      return 'N/A';
    } else {
      return 'N/A';
    }
  }

  // Get current version as a string (e.g., "10.0.19045" or "10.15.7")
  getVersion() {
    return this.versionInfo.join('.');
  }

  // Private: Parse version strings (e.g., "10.0.19045" -> [10, 0, 19045])
  _parseVersion(version) {
    return (version || '').split('.').map((num) => parseInt(num, 10) || 0);
  }

  // Private: Get detailed version info based on platform (uses execSync - WARNING: can block)
  _getVersionInfo() {
    try {
      if (this.isWin()) {
        return this._parseVersion(this.release); // os.release() is usually sufficient for Windows version numbers
      } else if (this.isMac()) {
        const version = childProcess.execSync('sw_vers -productVersion', { stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).toString().trim();
        return this._parseVersion(version);
      } else if (this.isLinux()) {
        // Use 'uname -r' for kernel version - more standard
        const version = childProcess.execSync('uname -r', { stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).toString().trim();
        return this._parseVersion(version);
        // Could also try parsing /etc/os-release or lsb_release -r for distro version, but kernel is common
      }
    } catch (e) {
      console.error(`SystemInfo: Failed to get OS version info for ${this.platform}: ${e.message}`);
    }
    return [0, 0, 0]; // Default for unknown or failed
  }

  // --- RAM Methods ---

  // Get total system memory in bytes
  getTotalMemory() {
    return os.totalmem();
  }

  // Get free system memory in bytes
  getFreeMemory() {
    return os.freemem();
  }

  // --- GPU Methods (uses execSync - WARNING: can block and may be unreliable) ---

  /**
   * Attempts to get primary GPU information (Name and VRAM).
   * WARNING: Uses synchronous child processes and relies on command output parsing,
   * which can be slow, block the thread, fail if commands are missing, or break
   * with different OS versions/languages/drivers.
   * @returns {{name: string | 'Unknown', vramBytes: number | 'Unknown'} | null} GPU info or null if detection fails.
   */
  getGpuInfo() {
    if (this._cachedGpuInfo) {
      return this._cachedGpuInfo; // Return cached result
    }

    let gpuInfo = null;
    try {
      if (this.isWin()) {
        // Get Name and AdapterRAM (in bytes)
        const result = childProcess.execSync('wmic path win32_videocontroller get Name,AdapterRAM /Value', { stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).toString();
        const nameMatch = result.match(/Name=(.*)/i);
        const vramMatch = result.match(/AdapterRAM=(.*)/i);
        let vramBytes = 'Unknown';
        if (vramMatch && vramMatch[1]) {
          vramBytes = parseInt(vramMatch[1].trim(), 10);
          if (isNaN(vramBytes)) vramBytes = 'Unknown';
        }
        gpuInfo = {
          name: nameMatch && nameMatch[1] ? nameMatch[1].trim() : 'Unknown',
          vramBytes: vramBytes
        };

      } else if (this.isMac()) {
        // Get Chipset Model and VRAM (Total)
        const result = childProcess.execSync('system_profiler SPDisplaysDataType', { stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).toString();
        const nameMatch = result.match(/Chipset Model:\s*(.*)/i);
        const vramMatch = result.match(/VRAM \(Total\):\s*(.*)/i);

        let vramBytes = 'Unknown';
        if (vramMatch && vramMatch[1]) {
          vramBytes = this._parseVramString(vramMatch[1].trim());
        }

        gpuInfo = {
          name: nameMatch && nameMatch[1] ? nameMatch[1].trim() : 'Unknown',
          vramBytes: vramBytes
        };

      } else if (this.isLinux()) {
        // Try lshw first (more common for details, but might need sudo or not installed)
        // Example output line: "size: 4 GiB" or "description: VGA compatible controller"
        try {
          // Check if lshw exists and is executable
          if (fs.existsSync('/usr/bin/lshw')) { // Common path, might vary
            const result = childProcess.execSync('lshw -c display', { stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).toString();
            // Simple parsing: look for description (name) and size (vram)
            const nameMatch = result.match(/description:\s*(.*)/i);
            const vramMatch = result.match(/size:\s*(.*)/i); // VRAM often listed under size

            let vramBytes = 'Unknown';
            if (vramMatch && vramMatch[1]) {
              vramBytes = this._parseVramString(vramMatch[1].trim());
            }
            gpuInfo = {
              name: nameMatch && nameMatch[1] ? nameMatch[1].trim() : 'Unknown',
              vramBytes: vramBytes
            };

          } else {
            // Fallback for Linux: Try lspci (more standard, less detail usually)
            // Might need to grep multiple times or parse complex output
            const result = childProcess.execSync('lspci | grep -i vga', { stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).toString();
            // Simple parsing: just get the first line's description
            const nameMatch = result.match(/VGA compatible controller:\s*(.*)/i);
            gpuInfo = {
              name: nameMatch && nameMatch[1] ? nameMatch[1].trim() : result.split('\n')[0].trim() || 'Unknown', // Use first line if regex fails
              vramBytes: 'Unknown' // lspci often doesn't list VRAM directly
            };
          }
        } catch (e) {
          console.error(`SystemInfo: Failed to get Linux GPU info: ${e.message}`);
          gpuInfo = { name: 'Unknown', vramBytes: 'Unknown' }; // Still return an object
        }
      }
    } catch (e) {
      console.error(`SystemInfo: Failed to get GPU info for ${this.platform}: ${e.message}`);
      gpuInfo = { name: 'Unknown', vramBytes: 'Unknown' }; // Still return an object
    }

    this._cachedGpuInfo = gpuInfo; // Cache the result
    return gpuInfo;
  }

  // Private: Helper to parse VRAM strings (e.g., "4 GB", "1024 MB", "2 GiB") into bytes
  _parseVramString(vramString) {
    if (typeof vramString !== 'string') return 'Unknown';

    const parts = vramString.match(/^(\d+(\.\d+)?)\s*(B|KB|MB|GB|TB|KiB|MiB|GiB|TiB)$/i);
    if (!parts) {
      // Handle simple byte values if not matched by regex
      const byteValue = parseInt(vramString, 10);
      if (!isNaN(byteValue)) return byteValue;
      return 'Unknown';
    }

    const value = parseFloat(parts[1]);
    const unit = parts[3].toLowerCase();

    const byteConversion = {
      'b': 1,
      'kb': 1000, 'mb': 1000 * 1000, 'gb': 1000 * 1000 * 1000, 'tb': 1000 * 1000 * 1000 * 1000, // Base 10
      'kib': 1024, 'mib': 1024 * 1024, 'gib': 1024 * 1024 * 1024, 'tib': 1024 * 1024 * 1024 * 1024 // Base 2
    };

    if (byteConversion[unit]) {
      return Math.round(value * byteConversion[unit]);
    }

    return 'Unknown';
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
