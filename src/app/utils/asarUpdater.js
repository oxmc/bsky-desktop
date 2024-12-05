const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const axios = require('axios');
const crypto = require('crypto');
const electron = require('electron');
const EventEmitter = require('events');
const dns = require('dns');
const semver = require('semver');

const app = electron.app || electron.remote.app;
const appName = app.getName();
const appPath = app.getAppPath();

class Updater extends EventEmitter {
    constructor() {
        super();
        this.tasks = [];
    }

    _fetchJson(url) {
        return axios.get(url, {
            timeout: 1500,
            headers: this.headers,
            responseType: 'json',
        }).then(response => response.data).catch(error => {
            throw error;
        });
    }

    _fetchFile(url, name) {
        let onProgress = (p) => console.log(p);
        let total = 0;
        let current = 0;
        let timer = null;
        const tempFile = path.resolve(this.options.cacheDirectory, name);

        const promise = new Promise((resolve, reject) => {
            axios({
                url,
                method: 'GET',
                responseType: 'stream',
                headers: this.headers,
                timeout: 3000,
            })
                .then((response) => {
                    if (response.headers['content-length']) {
                        total = parseInt(response.headers['content-length'], 10);
                    } else {
                        onProgress(-1);
                    }

                    timer = setTimeout(() => {
                        response.request.destroy(new Error('Request timed out after 2 minutes'));
                    }, 2 * 60 * 1000);

                    response.data
                        .on('data', (chunk) => {
                            current += chunk.length;
                            total ? onProgress(current / total) : onProgress(-1);
                        })
                        .pipe(zlib.createGunzip())
                        .pipe(fs.createWriteStream(tempFile))
                        .on('finish', () => {
                            clearTimeout(timer);
                            resolve(tempFile);
                        })
                        .on('error', (error) => {
                            clearTimeout(timer);
                            reject(error);
                        });
                })
                .catch((error) => reject(error));
        });

        promise.progress = (callback) => {
            onProgress = callback;
            return promise;
        };

        return promise;
    }

    init(options) {
        const def = {
            tmpdir: os.tmpdir(),
            headers: {},
            name: appName,
        };
        this.options = Object.assign({}, def, options);
        this.options.cacheDirectory = path.resolve(this.options.tmpdir, this.options.name);
        this.options.headers['user-agent'] = this.options.headers['user-agent'] || 'asar-updater/v0.0.2 (https://github.com/zce/asar-updater)';
        fs.existsSync(this.options.cacheDirectory) || fs.mkdirSync(this.options.cacheDirectory);
    }

    setFeedURL(filename, url) {
        if (!path.isAbsolute(filename)) {
            filename = path.resolve(appPath, filename);
        }
        const name = path.basename(filename, '.asar');
        this.tasks.push({ name, filename, url });
    }

    checkForUpdates() {
        this._isOnline()
            .then((online) => {
                if (!online) {
                    this.emit('completed', false, 'offline');
                    return;
                }

                this.manifest = [];
                this.emit('checking-for-update');

                Promise.all(
                    this.tasks
                        .map((t) => this._local(t))
                        .map((t) => this._remote(t))
                        .map((p) => this._compare(p))
                        .map((p) => this._download(p))
                )
                    .then((tasks) => this._allCompleted(tasks))
                    .catch((error) => this.emit('error', error));
            })
            .catch((err) => this.emit('error', err));
    }

    _isOnline(domain = 'google.com') {
        return new Promise((resolve) => {
            dns.lookup(domain, (err) => {
                resolve(!err); // If there's no error, the system is online
            });
        });
    }

    _local(task) {
        try {
            task.local = require(path.resolve(task.filename, 'package.json'));
            if (!task.local.version) throw new Error('There is no version in the package.json');
            return task;
        } catch (e) {
            if (e.code !== 'MODULE_NOT_FOUND') throw e;
            throw new Error(`There is no package.json in the ${task.filename}`);
        }
    }

    _remote(task) {
        return this._fetchJson(`${task.url}?v=${Date.now()}`)
            .then((remote) => {
                task.remote = remote;
                if (!task.remote.version) return Promise.reject(new Error('There is no version in the remote'));
                return task;
            });
    }

    _compare(promise) {
        return promise.then((task) => {
            task.available = semver.gt(semver.clean(task.remote.version), semver.clean(task.local.version));
            this.emit(task.available ? 'available' : 'not-available', task);
            return task;
        });
    }

    _getFileStamp(filename, type) {
        type = type || 'sha1';
        const buffer = fs.readFileSync(filename);
        const hash = crypto.createHash(type);
        hash.update(buffer);
        return hash.digest('hex');
    }

    _download(promise) {
        return promise.then((task) => {
            if (!task.available) return task;
            return this._fetchFile(`${task.remote.url}?v=${Date.now()}`, task.name)
                .progress((p) => this.emit('progress', task, p))
                .then((filename) => {
                    if (task.remote.sha1 === this._getFileStamp(filename)) {
                        this.manifest.push({ from: filename, to: task.filename });
                    }
                    this.emit('downloaded', task);
                    return task;
                });
        });
    }

    _allCompleted(tasks) {
        let updated = false;
        for (let i = tasks.length - 1; i >= 0; i--) {
            if (tasks[i].available) {
                updated = true;
            }
        }

        if (!updated) {
            this.emit('completed', false, tasks);
            return;
        }

        fs.writeFile(path.resolve(this.options.cacheDirectory, 'manifest.json'), JSON.stringify(this.manifest), 'utf8', (error) => {
            if (error) return fs.unlink(this.options.cacheDirectory);
            this.emit('completed', this.manifest, tasks);
            this.manifest = [];
        });
    }

    quitAndInstall(timeout) {
        setTimeout(() => {
            app.relaunch({ args: process.argv.slice(1) + ['--relaunch'] });
            app.exit(0);
        }, timeout || 100);
    }
}

module.exports = new Updater();