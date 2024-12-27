# Bsky Desktop

Bsky Desktop is an Electron-based application for Bsky that allows users to manage their accounts and feeds directly from the app, rather than through the web interface.

### Features:
- Support for user styles (work in progress; currently only LESS preprocessor is supported)
- Compatibility with both Manifest V2 and V3 Chrome extensions, though only a limited set of Chrome extension APIs are supported. For more information, visit: [Electron Extensions API Documentation](https://www.electronjs.org/docs/latest/api/extensions#supported-extensions-apis)

### Working on:
- Auto updates (for all platforms)

### Build and release status:
[![Build and Release bsky-desktop](https://github.com/oxmc/bsky-desktop/actions/workflows/build-and-release.yml/badge.svg)](https://github.com/oxmc/bsky-desktop/actions/workflows/build-and-release.yml)

[![Packaging status](https://repology.org/badge/vertical-allrepos/bskydesktop.svg?columns=4&exclude_unsupported=1)](https://repology.org/project/bskydesktop/versions)

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
    This will generate the necessary files for the app.