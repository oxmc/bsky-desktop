// Self-updater for portable zip builds, which electron-updater doesn't support.
//
// Reads the zip entry from the same latest-*.yml feed electron-updater uses (build-app.js
// adds it), downloads and verifies the zip, extracts it next to the current install, then on
// quit a detached shell script swaps the folders once this process has exited and relaunches.
// Folder swapping is Linux-only; other platforms, and installs in folders the user can't
// write to, get the download link instead.
const { spawn } = require('child_process');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const yaml = require('js-yaml');
const semver = require('semver');
const AdmZip = require('adm-zip');
const { app } = require('electron');

const installDir = path.dirname(process.execPath);

function channelFile(channel = 'latest') {
    if (process.platform === 'linux') return `${channel}-linux${process.arch === 'x64' ? '' : `-${process.arch}`}.yml`;
    if (process.platform === 'darwin') return `${channel}-mac.yml`;
    return `${channel}.yml`;
}

function feedBase(feedUrl) {
    return feedUrl.endsWith('/') ? feedUrl : `${feedUrl}/`;
}

// Returns { version, url, sha512, size } when a newer zip is published, otherwise null.
async function check(feedUrl, channel, headers = {}) {
    const ymlUrl = new URL(channelFile(channel), feedBase(feedUrl)).href;
    const { data } = await axios.get(`${ymlUrl}?noCache=${Date.now()}`, { headers, responseType: 'text', timeout: 15000 });
    const info = yaml.load(data);
    if (!info || !info.version) throw new Error(`No version in ${ymlUrl}`);
    if (!semver.gt(info.version, app.getVersion())) return null;

    const file = (info.files || []).find((f) => f.url && f.url.endsWith('.zip'));
    if (!file) throw new Error(`No zip listed in ${ymlUrl}`);
    return { version: info.version, url: new URL(file.url, feedBase(feedUrl)).href, sha512: file.sha512, size: file.size };
}

// Swapping needs write access to the install folder and the folder containing it.
function canSelfUpdate() {
    if (process.platform !== 'linux') return false;
    try {
        fs.accessSync(installDir, fs.constants.W_OK);
        fs.accessSync(path.dirname(installDir), fs.constants.W_OK);
        return true;
    } catch {
        return false;
    }
}

function stagingDir(version) {
    return `${installDir}.update-${version}`;
}

// Downloads the zip into tempDir, verifies it and extracts it beside the install folder.
// Electron's fs treats any path ending in .asar as an archive to read into, so writing,
// chmod-ing or deleting the new resources/app.asar *file* fails (ENOENT) unless asar
// support is switched off around it.
function withoutAsar(fn) {
    const previous = process.noAsar;
    process.noAsar = true;
    try {
        return fn();
    } finally {
        process.noAsar = previous;
    }
}

// Returns the staging folder path.
async function download(update, tempDir, headers = {}, onProgress = () => { }) {
    const zipPath = path.join(tempDir, path.basename(new URL(update.url).pathname));
    const response = await axios.get(update.url, { headers, responseType: 'stream', timeout: 30000 });
    const total = parseInt(response.headers['content-length'], 10) || update.size || 0;
    const hash = crypto.createHash('sha512');
    let received = 0;

    await new Promise((resolve, reject) => {
        const out = fs.createWriteStream(zipPath);
        response.data.on('data', (chunk) => {
            hash.update(chunk);
            received += chunk.length;
            if (total) onProgress(received / total);
        });
        response.data.on('error', reject);
        out.on('error', reject);
        out.on('finish', resolve);
        response.data.pipe(out);
    });

    if (update.sha512 && hash.digest('base64') !== update.sha512) {
        fs.rmSync(zipPath, { force: true });
        throw new Error('Downloaded zip failed sha512 verification');
    }

    const staging = stagingDir(update.version);
    withoutAsar(() => {
        fs.rmSync(staging, { recursive: true, force: true });
        new AdmZip(zipPath).extractAllTo(staging, true, true);
        fs.rmSync(zipPath, { force: true });

        // Make sure the binaries stay executable even if the zip didn't record permissions
        for (const exe of [path.basename(process.execPath), 'chrome_crashpad_handler', 'chrome-sandbox']) {
            const target = path.join(staging, exe);
            if (fs.existsSync(target)) fs.chmodSync(target, 0o755);
        }
    });
    return staging;
}

// Exits the app; a detached script swaps in the staged folder and relaunches it.
function install(staging, tempDir) {
    const script = path.join(tempDir, 'zip-update.sh');
    fs.writeFileSync(script, [
        '#!/bin/sh',
        '# $1 = pid to wait for, $2 = install dir, $3 = staged dir, $4 = executable name, rest = app args',
        'pid="$1"; dir="$2"; stage="$3"; exe="$4"; shift 4',
        'while kill -0 "$pid" 2>/dev/null; do sleep 0.2; done',
        'if mv "$dir" "$dir.old"; then',
        '  if mv "$stage" "$dir"; then rm -rf "$dir.old"; else mv "$dir.old" "$dir"; fi',
        'fi',
        'exec "$dir/$exe" "$@"',
        '',
    ].join('\n'), { mode: 0o755 });

    spawn('/bin/sh', [script, String(process.pid), installDir, staging, path.basename(process.execPath), ...process.argv.slice(1)], {
        detached: true,
        stdio: 'ignore',
    }).unref();
    app.exit(0);
}

module.exports = { check, canSelfUpdate, download, install };
