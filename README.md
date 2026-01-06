# Bsky Desktop

Bsky Desktop is an Electron-based application for Bsky that allows users to manage their accounts and feeds directly from the app, rather than through the web interface.

### Features:
- Support for user styles (work in progress; currently only LESS and Stylus preprocessor is supported)
- Compatibility with both Manifest V2 and V3 Chrome extensions, though only a limited set of Chrome extension APIs are supported. For more information, visit: [Electron Extensions API Documentation](https://www.electronjs.org/docs/latest/api/extensions#supported-extensions-apis)
- **Intelligent performance optimization** - Automatic system detection and performance tuning for optimal experience across all hardware

### Working on:
- Auto updates (for all platforms)

### Build and release status:
[![Build and Release bsky-desktop](https://github.com/oxmc/bsky-desktop/actions/workflows/build-and-release.yml/badge.svg)](https://github.com/oxmc/bsky-desktop/actions/workflows/build-and-release.yml)

[![Packaging status](https://repology.org/badge/vertical-allrepos/bskydesktop.svg?columns=4&exclude_unsupported=1)](https://repology.org/project/bskydesktop/versions)
[![Packaging status](https://repology.org/badge/vertical-allrepos/bsky-desktop-bin.svg)](https://repology.org/project/bsky-desktop-bin/versions)

#### Windows install options:
- Zip (x64, arm64, ia32)
- Setup
  - exe (x64, arm64, ia32)
  - msi (x64, arm64, ia32)
  - appx (x64, arm64, ia32)

#### Mac install options:
- Zip (x64, arm64)
- Dmg (x64, arm64)

> [!NOTE]
> Bsky Desktop no longer builds pkg files for macOS as there is no support for auto updating with electron-updater.

#### Linux install options:
- Zip (x64, arm64, ia32)
- AppImage (x64, arm64, ia32)
- RPM (x64, arm64, ia32)
- Deb (x64, arm64, ia32)

### Performance Optimization

Bsky Desktop automatically detects your hardware and applies optimizations for the best experience:

#### Standard Systems (Windows, macOS, Linux):
- **High-end systems** (8GB+ RAM, discrete GPU):
  - Full GPU acceleration and hardware compositing
  - Metal API on macOS, DirectX on Windows
  - 4GB JavaScript heap allocation
  - Maximum rendering performance

- **Mid-range systems** (4-8GB RAM, integrated GPU):
  - Selective GPU features with Skia renderer
  - 2GB JavaScript heap allocation
  - Balanced performance and resource usage

- **Low-end systems** (< 4GB RAM, no dedicated GPU):
  - Disabled GPU compositing and hardware acceleration
  - 1GB JavaScript heap allocation
  - Aggressive memory management and caching
  - Optimized for stability over performance

#### Raspberry Pi Systems:

**Supported Models:**
- **Raspberry Pi 5** - Full performance with hardware acceleration
- **Raspberry Pi 4** - Moderate optimization with hardware video decoding
- **Raspberry Pi 3 / 3B+** - Aggressive optimization for smooth operation
- **Raspberry Pi 2** - Memory-optimized configuration
- **Raspberry Pi 1 / Zero / Zero 2 W** - Highly optimized for low-resource devices
- **Compute Module** (all variants)

**Recommended Hardware:**
- **Minimum**: Raspberry Pi 3B+ with 1GB RAM
- **Recommended**: Raspberry Pi 4 with 4GB+ RAM or Raspberry Pi 5
- **Note**: Pi 1/2/Zero models will run but may experience performance limitations with complex feeds

**Pi-Specific Optimizations:**
- **Pi 5**: Hardware video encoding/decoding, EGL rendering, GPU rasterization, 2-3GB heap
- **Pi 4**: Hardware video decoding (VAAPI), EGL rendering, 1-2GB heap
- **Pi 3 and older**: Software rendering, disabled GPU compositing, 256MB-1GB heap, single/dual thread rendering
- Automatic generation detection and performance profiling
- Adaptive memory management with aggressive garbage collection
- Reduced disk cache (25-50MB vs 50MB on standard systems)
- Optimized for ARM architecture

All systems benefit from:
- Disabled unnecessary features (spell checking, background sync, notifications, etc.)
- Periodic cache clearing and memory monitoring
- Automatic garbage collection on high memory pressure
- Process-per-site isolation for stability

### Build Instructions for Bsky Desktop

To build and run Bsky Desktop locally, follow these steps:

1. **Clone the repository:**
```sh
    git clone https://github.com/oxmc/bsky-desktop.git
    cd bsky-desktop
```

2. **Install dependencies:**
```sh
    npm install
```

**(Optional) Run the application locally:**
  If you want to test the application locally before building it, use the following command:
```sh
    npm run start
```
  This step is **not required for building** but is useful if you want to see the app in action during development.

3. **Build the application:**
  To compile the application, run:
```sh
    npm run build
```