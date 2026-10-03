// ══════════════════════════════════════════════════════════════════════════
//  BIBLEDOVE — AUTO UPDATER MODULE
//  Zero-dependency, resilient auto-update system for Windows NSIS & GitHub
//  Lucid Tech. (c) 2026
// ══════════════════════════════════════════════════════════════════════════

const { app } = require('electron');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

class AutoUpdater {
  constructor() {
    this.currentVersion = app ? app.getVersion() : require('./package.json').version;
    this.isChecking = false;
    this.isDownloading = false;
    this.downloadedFilePath = null;
    this.latestInfo = null;
    this.window = null;

    // Settings path
    this.settingsPath = app
      ? path.join(app.getPath('userData'), 'bibledove-update-settings.json')
      : path.join(__dirname, 'bibledove-update-settings.json');

    this.settings = this.loadSettings();
  }

  setWindow(win) {
    this.window = win;
  }

  loadSettings() {
    const defaults = {
      checkOnStartup: true,
      autoInstall: false,
      feedType: 'github',
      githubRepo: 'ItsDragun/BibleDove',
      customUrl: 'https://raw.githubusercontent.com/ItsDragun/BibleDove/main/update.json'
    };

    try {
      if (fs.existsSync(this.settingsPath)) {
        const raw = fs.readFileSync(this.settingsPath, 'utf8');
        return { ...defaults, ...JSON.parse(raw) };
      }
    } catch (err) {
      console.warn('[UPDATER] Failed to read update settings, using defaults:', err.message);
    }
    return defaults;
  }

  saveSettings(newSettings) {
    this.settings = { ...this.settings, ...newSettings };
    try {
      const dir = path.dirname(this.settingsPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.settingsPath, JSON.stringify(this.settings, null, 2), 'utf8');
      console.log('[UPDATER] Saved update settings successfully');
    } catch (err) {
      console.error('[UPDATER] Failed to save settings:', err.message);
    }
    return this.settings;
  }

  send(channel, data) {
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send(channel, data);
    }
  }

  /**
   * Semver comparison:
   * returns 1 if v1 > v2, -1 if v1 < v2, 0 if v1 == v2
   */
  compareVersions(v1, v2) {
    const clean = (v) => v.replace(/^v/i, '').trim().split('-')[0];
    const p1 = clean(v1).split('.').map(Number);
    const p2 = clean(v2).split('.').map(Number);

    for (let i = 0; i < Math.max(p1.length, p2.length); i++) {
      const num1 = p1[i] || 0;
      const num2 = p2[i] || 0;
      if (num1 > num2) return 1;
      if (num1 < num2) return -1;
    }
    return 0;
  }

  /**
   * Helper to perform HTTP/HTTPS GET requests following redirects
   */
  fetchUrl(urlStr, headers = {}) {
    return new Promise((resolve, reject) => {
      const url = new URL(urlStr);
      const client = url.protocol === 'https:' ? https : http;

      const reqHeaders = {
        'User-Agent': 'BibleDove-Updater/1.0',
        'Accept': 'application/json, text/plain, */*',
        ...headers
      };

      const req = client.get(urlStr, { headers: reqHeaders }, (res) => {
        // Handle HTTP 3xx Redirects
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const redirectUrl = new URL(res.headers.location, urlStr).toString();
          return resolve(this.fetchUrl(redirectUrl, headers));
        }

        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`Server returned HTTP ${res.statusCode}: ${res.statusMessage}`));
        }

        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => resolve(body));
      });

      req.on('error', reject);
      req.setTimeout(12000, () => {
        req.destroy(new Error('Update check request timed out'));
      });
    });
  }

  /**
   * Check for updates using GitHub Releases or Custom Feed
   */
  async checkForUpdates(isManual = false) {
    if (this.isChecking) return;
    this.isChecking = true;
    this.send('update-status', { status: 'checking', isManual });
    console.log(`[UPDATER] Checking for updates (current version: v${this.currentVersion})...`);

    try {
      let updateData = null;

      if (this.settings.feedType === 'custom' && this.settings.customUrl) {
        // Custom JSON manifest
        console.log(`[UPDATER] Querying custom feed: ${this.settings.customUrl}`);
        const raw = await this.fetchUrl(this.settings.customUrl);
        const json = JSON.parse(raw);
        updateData = {
          version: json.version,
          notes: json.notes || json.description || 'No release notes provided.',
          downloadUrl: json.downloadUrl || json.url,
          releaseDate: json.releaseDate || new Date().toISOString()
        };
      } else {
        // Default: GitHub Releases API
        const repo = this.settings.githubRepo || 'LucidTech/BibleDove';
        const ghUrl = `https://api.github.com/repos/${repo}/releases/latest`;
        console.log(`[UPDATER] Querying GitHub Releases: ${ghUrl}`);
        
        try {
          const raw = await this.fetchUrl(ghUrl);
          const release = JSON.parse(raw);

          // Find the Windows installer (.exe)
          const exeAsset = (release.assets || []).find(
            (a) => a.name.toLowerCase().endsWith('.exe') && !a.name.toLowerCase().includes('blockmap')
          );

          updateData = {
            version: release.tag_name ? release.tag_name.replace(/^v/i, '') : '0.0.0',
            notes: release.body || 'No release notes provided.',
            downloadUrl: exeAsset ? exeAsset.browser_download_url : null,
            releaseDate: release.published_at || new Date().toISOString(),
            assetName: exeAsset ? exeAsset.name : null
          };
        } catch (ghErr) {
          // If GitHub repo doesn't exist yet or rate limit, check custom manifest fallback if set
          console.warn('[UPDATER] GitHub release lookup failed:', ghErr.message);
          throw new Error(`Could not connect to update server (${ghErr.message}). Please check your internet connection.`);
        }
      }

      if (!updateData || !updateData.version) {
        throw new Error('Received invalid update data from server.');
      }

      console.log(`[UPDATER] Found remote version: v${updateData.version} (current: v${this.currentVersion})`);
      const hasUpdate = this.compareVersions(updateData.version, this.currentVersion) > 0;

      if (hasUpdate) {
        this.latestInfo = updateData;
        this.send('update-status', {
          status: 'available',
          currentVersion: this.currentVersion,
          latestVersion: updateData.version,
          notes: updateData.notes,
          downloadUrl: updateData.downloadUrl,
          releaseDate: updateData.releaseDate,
          isManual
        });

        // If user configured full automatic update, initiate download immediately
        if (this.settings.autoInstall && updateData.downloadUrl) {
          this.downloadUpdate(updateData.downloadUrl);
        }
      } else {
        this.send('update-status', {
          status: 'not-available',
          currentVersion: this.currentVersion,
          latestVersion: updateData.version,
          isManual
        });
      }
    } catch (err) {
      console.warn('[UPDATER] Check failed:', err.message);
      this.send('update-status', {
        status: 'error',
        error: err.message,
        isManual
      });
    } finally {
      this.isChecking = false;
    }
  }

  /**
   * Download the update installer file
   */
  async downloadUpdate(downloadUrl) {
    const targetUrl = downloadUrl || (this.latestInfo && this.latestInfo.downloadUrl);
    if (!targetUrl) {
      this.send('update-status', { status: 'error', error: 'No download URL available for update.' });
      return;
    }

    if (this.isDownloading) return;
    this.isDownloading = true;

    const fileName = `BibleDove-Setup-${this.latestInfo ? this.latestInfo.version : 'latest'}.exe`;
    const tempPath = path.join(os.tmpdir(), fileName);
    this.downloadedFilePath = tempPath;

    console.log(`[UPDATER] Downloading update from ${targetUrl} to ${tempPath}...`);
    this.send('update-status', { status: 'downloading', percent: 0, receivedBytes: 0, totalBytes: 0 });

    try {
      await this.downloadFileWithProgress(targetUrl, tempPath, (progress) => {
        this.send('update-status', {
          status: 'downloading',
          percent: progress.percent,
          receivedBytes: progress.received,
          totalBytes: progress.total,
          speed: progress.speed
        });
      });

      console.log('[UPDATER] Update download complete:', tempPath);
      this.send('update-status', {
        status: 'downloaded',
        filePath: tempPath,
        version: this.latestInfo ? this.latestInfo.version : 'latest'
      });

      if (this.settings.autoInstall) {
        this.installAndRestart();
      }
    } catch (err) {
      console.error('[UPDATER] Download error:', err);
      this.send('update-status', { status: 'error', error: `Download failed: ${err.message}` });
    } finally {
      this.isDownloading = false;
    }
  }

  /**
   * Streaming file download with progress calculation & redirect support
   */
  downloadFileWithProgress(urlStr, destPath, onProgress) {
    return new Promise((resolve, reject) => {
      const url = new URL(urlStr);
      const client = url.protocol === 'https:' ? https : http;

      const req = client.get(urlStr, {
        headers: { 'User-Agent': 'BibleDove-Updater/1.0' }
      }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const redirectUrl = new URL(res.headers.location, urlStr).toString();
          return resolve(this.downloadFileWithProgress(redirectUrl, destPath, onProgress));
        }

        if (res.statusCode !== 200) {
          return reject(new Error(`Download failed with HTTP ${res.statusCode}: ${res.statusMessage}`));
        }

        const totalBytes = parseInt(res.headers['content-length'] || '0', 10);
        let receivedBytes = 0;
        let lastTime = Date.now();
        let lastBytes = 0;
        let speed = 0;

        const fileStream = fs.createWriteStream(destPath);

        res.on('data', (chunk) => {
          receivedBytes += chunk.length;
          const now = Date.now();
          if (now - lastTime >= 150) {
            speed = Math.round(((receivedBytes - lastBytes) / ((now - lastTime) / 1000)));
            lastTime = now;
            lastBytes = receivedBytes;

            const percent = totalBytes > 0 ? Math.round((receivedBytes / totalBytes) * 100) : 0;
            onProgress({
              percent,
              received: receivedBytes,
              total: totalBytes,
              speed
            });
          }
        });

        res.pipe(fileStream);

        fileStream.on('finish', () => {
          fileStream.close(() => {
            onProgress({
              percent: 100,
              received: receivedBytes,
              total: totalBytes || receivedBytes,
              speed: 0
            });
            resolve(destPath);
          });
        });

        fileStream.on('error', (err) => {
          fs.unlink(destPath, () => {});
          reject(err);
        });
      });

      req.on('error', (err) => {
        fs.unlink(destPath, () => {});
        reject(err);
      });

      req.setTimeout(60000, () => {
        req.destroy(new Error('Download timed out'));
      });
    });
  }

  /**
   * Run the downloaded NSIS installer and quit app to apply update
   */
  installAndRestart(silent = true) {
    if (!this.downloadedFilePath || !fs.existsSync(this.downloadedFilePath)) {
      this.send('update-status', { status: 'error', error: 'No downloaded installer found to execute.' });
      return;
    }

    const appExe = process.execPath;
    const installer = this.downloadedFilePath;
    const runnerScript = path.join(os.tmpdir(), 'bibledove-update-runner.bat');

    console.log(`[UPDATER] Launching update runner to install and restart ${appExe}...`);

    const batContent = `@echo off
timeout /t 1 /nobreak >nul
start /wait "" "${installer}" /S
timeout /t 1 /nobreak >nul
start "" "${appExe}"
del "%~f0"
`;

    try {
      fs.writeFileSync(runnerScript, batContent, 'utf8');

      const child = spawn('cmd.exe', ['/c', runnerScript], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true
      });
      child.unref();

      // Gracefully shut down current app process
      setTimeout(() => {
        if (app) {
          app.isQuitting = true;
          app.quit();
        } else {
          process.exit(0);
        }
      }, 500);
    } catch (err) {
      console.error('[UPDATER] Failed to launch update runner:', err);
      this.send('update-status', { status: 'error', error: `Failed to launch installer: ${err.message}` });
    }
  }
}

module.exports = new AutoUpdater();
