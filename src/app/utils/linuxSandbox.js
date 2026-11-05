// Linux sandbox helpers.
//
// Chromium's sandbox needs either a setuid-root chrome-sandbox helper or unprivileged user
// namespaces. On Ubuntu 23.10+ (kernel.apparmor_restrict_unprivileged_userns=1) user
// namespaces are only allowed for binaries attached to an AppArmor profile granting `userns`.
// The .deb/.rpm postinst installs such a profile for /opt/<product>/<executable>, but
// AppImage/zip builds never run a postinst, so this module installs an equivalent profile
// at runtime (via pkexec) for wherever the app is actually running from.
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

function readTrimmed(file) {
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    return null;
  }
}

function suidSandboxUsable() {
  try {
    const stat = fs.statSync(path.join(path.dirname(process.execPath), 'chrome-sandbox'));
    return stat.uid === 0 && (stat.mode & 0o4000) !== 0;
  } catch {
    return false;
  }
}

// Kernel-level switches that disable unprivileged user namespaces outright (no profile helps).
function usernsDisabledByKernel() {
  return readTrimmed('/proc/sys/kernel/unprivileged_userns_clone') === '0' ||
    readTrimmed('/proc/sys/user/max_user_namespaces') === '0';
}

function apparmorRestrictsUserns() {
  return readTrimmed('/proc/sys/kernel/apparmor_restrict_unprivileged_userns') === '1';
}

// AppArmor label of this process: "unconfined" when no profile attached to our executable,
// otherwise e.g. "my-app (unconfined)".
function confinedByProfile() {
  const label = readTrimmed('/proc/self/attr/apparmor/current') ?? readTrimmed('/proc/self/attr/current');
  return !!label && label !== 'unconfined';
}

// Decide sandbox mode before app ready. Returns 'ok', 'needs-profile' or 'unavailable'.
function getSandboxStatus() {
  if (suidSandboxUsable()) return 'ok';
  if (usernsDisabledByKernel()) return 'unavailable';
  if (!apparmorRestrictsUserns() || confinedByProfile()) return 'ok';
  return 'needs-profile';
}

// Path the profile should attach to. AppImages mount at a random /tmp/.mount_XXXXXX dir on
// every launch, so glob that component.
function profileAttachPath() {
  const exeName = path.basename(process.execPath);
  if (process.env.APPIMAGE) {
    const mountDir = path.dirname(process.execPath);
    return path.join(path.dirname(mountDir), '.mount_*', exeName);
  }
  return process.execPath;
}

function profileName() {
  const exeName = path.basename(process.execPath);
  return process.env.APPIMAGE ? `${exeName}-appimage` : `${exeName}-portable`;
}

function buildProfile(name, attachPath) {
  return [
    'abi <abi/4.0>,',
    'include <tunables/global>',
    '',
    `profile "${name}" "${attachPath}" flags=(unconfined) {`,
    '  userns,',
    '',
    '  # Site-specific additions and overrides. See local/README for details.',
    `  include if exists <local/${name}>`,
    '}',
    '',
  ].join('\n');
}

// Writes the profile to tempDir, then installs and loads it as root through pkexec.
// Returns { ok, cancelled, error }.
function installProfile(tempDir) {
  const name = profileName();
  const src = path.join(tempDir, `apparmor-${name}`);
  const dst = path.join('/etc/apparmor.d', name);
  fs.writeFileSync(src, buildProfile(name, profileAttachPath()));

  const script = [
    'set -e',
    'PATH=/usr/sbin:/sbin:/usr/bin:/bin',
    'apparmor_parser --skip-kernel-load "$1" >/dev/null',
    'install -m 0644 "$1" "$2"',
    'apparmor_parser --replace --write-cache --skip-read-cache "$2"',
  ].join('\n');

  const result = spawnSync('pkexec', ['/bin/sh', '-c', script, 'sh', src, dst], { encoding: 'utf8' });
  try { fs.unlinkSync(src); } catch { }

  if (result.error) return { ok: false, error: result.error.message };
  // pkexec: 126 = auth dialog dismissed, 127 = not authorized
  if (result.status === 126 || result.status === 127) return { ok: false, cancelled: true };
  if (result.status !== 0) return { ok: false, error: (result.stderr || `exit ${result.status}`).trim() };
  return { ok: true };
}

function relaunchOptions() {
  const args = process.argv.slice(1);
  return process.env.APPIMAGE ? { execPath: process.env.APPIMAGE, args } : { args };
}

module.exports = { getSandboxStatus, installProfile, relaunchOptions };
