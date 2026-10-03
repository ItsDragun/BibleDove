const { app, BrowserWindow, session, ipcMain, net } = require('electron');
const path = require('path');
const fs = require('fs');
const updater = require('./updater');

// Google search IPC handler with a failsafe DuckDuckGo fallback
// This completely avoids any CORS blocks, browser redirects, or cookie consent walls!
ipcMain.handle('google-search', async (event, { phrase, version }) => {
  const q = `${phrase} ${version} (site:biblegateway.com OR site:biblehub.com OR site:blueletterbible.org)`;
  const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(q)}&sourceid=chrome&ie=UTF-8`;
  
  console.log(`[MAIN] Fetching Google Search for: "${phrase}" (${version})`);
  
  let html = '';
  let isBlocked = false;
  
  try {
    const res = await net.fetch(googleUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cookie': 'CONSENT=YES+dp.en+',
        'Referer': 'https://www.google.com/'
      }
    });

    if (res.ok) {
      html = await res.text();
      const lowerHtml = html.toLowerCase();
      if (
        lowerHtml.includes("not redirected") || 
        lowerHtml.includes("enablejs") || 
        lowerHtml.includes("captcha") || 
        lowerHtml.includes("unusual traffic") ||
        html.length < 5000
      ) {
        console.warn("[MAIN] Google search returned a redirection, captcha, or challenge page.");
        isBlocked = true;
      }
    } else {
      console.warn(`[MAIN] Google returned HTTP error ${res.status}`);
      isBlocked = true;
    }
  } catch (err) {
    console.warn("[MAIN] Google search direct fetch failed:", err.message);
    isBlocked = true;
  }
  
  if (isBlocked) {
    console.log(`[MAIN] Google blocked or redirected. Falling back to Yahoo Search...`);
    const yahooUrl = `https://search.yahoo.com/search?p=${encodeURIComponent(q)}`;
    try {
      const res = await net.fetch(yahooUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': 'https://search.yahoo.com/'
        }
      });
      if (!res.ok) {
        throw new Error(`Yahoo Search HTTP Error ${res.status}`);
      }
      html = await res.text();
      console.log(`[MAIN] Yahoo Search fallback fetched successfully. HTML length: ${html.length}`);
    } catch (err) {
      console.error("[MAIN] Yahoo Search fallback also failed:", err);
      throw err;
    }
  } else {
    console.log(`[MAIN] Google search fetched successfully. HTML length: ${html.length}`);
  }

  return html;
});

// ══════════════════════════════════════════════════════════════════════════
//  AI SUMMARISE — SERMON NOTES ONLY
//  Deliberately nowhere near search or parsing: those stay deterministic.
//  Keys live in userData/ai-config.json, never in this file and never in the
//  installer — a key hardcoded here ships inside app.asar in plain text.
// ══════════════════════════════════════════════════════════════════════════
const AI_CONFIG_FILE = 'ai-config.json';

// Every one of these is OpenAI chat-completions compatible, so one code path
// covers all four; only the base URL and model id differ.
const AI_PROVIDERS = {
  mistral:    { url: 'https://api.mistral.ai/v1/chat/completions',           model: 'open-mistral-7b' },
  openrouter: { url: 'https://openrouter.ai/api/v1/chat/completions',        model: 'inclusionai/ling-3.0-flash-sante:free' },
  cerebras:   { url: 'https://api.cerebras.ai/v1/chat/completions',          model: 'gpt-oss-120b' },
  nvidia:     { url: 'https://integrate.api.nvidia.com/v1/chat/completions', model: 'meta/llama-3.1-8b-instruct' },
};
const AI_ORDER = ['mistral', 'openrouter', 'cerebras', 'nvidia'];

function loadAiConfig() {
  try {
    const file = path.join(app.getPath('userData'), AI_CONFIG_FILE);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    console.error('[AI] config unreadable:', e.message);
    return null;
  }
}

async function callAiProvider(id, cfg, prompt) {
  const base = AI_PROVIDERS[id];
  const entry = (cfg.providers || {})[id] || {};
  if (!base || !entry.key) return { ok: false, why: 'no key' };

  const res = await net.fetch(base.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${entry.key}` },
    body: JSON.stringify({
      model: entry.model || base.model,
      max_tokens: 900,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  const text = await res.text();
  if (!res.ok) return { ok: false, why: `HTTP ${res.status} ${text.slice(0, 120)}` };
  try {
    const content = JSON.parse(text).choices?.[0]?.message?.content;
    if (!content) return { ok: false, why: 'empty response' };
    return { ok: true, content };
  } catch (e) {
    return { ok: false, why: 'unparseable response' };
  }
}

ipcMain.handle('generate-ai-content', async (event, { prompt }) => {
  const cfg = loadAiConfig();
  if (!cfg) {
    throw new Error('No AI config found. Add ai-config.json to ' + app.getPath('userData'));
  }
  const order = cfg.order || AI_ORDER;
  const failures = [];
  for (const id of order) {
    try {
      const r = await callAiProvider(id, cfg, prompt);
      if (r.ok) {
        console.log(`[AI] summary generated via ${id}`);
        return r.content;
      }
      failures.push(`${id}: ${r.why}`);
      console.warn(`[AI] ${id} unavailable — ${r.why}`);
    } catch (e) {
      failures.push(`${id}: ${e.message}`);
      console.warn(`[AI] ${id} threw — ${e.message}`);
    }
  }
  throw new Error('All AI providers failed. ' + failures.join(' | '));
});

function createWindow() {
  // Grant all permission requests (microphone, speech-recognition, etc.)
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, callback) => {
    callback(true);
  });
  session.defaultSession.setPermissionCheckHandler(() => true);

  // Keep CORS stripping for bible-api or other renderer requests
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const url = details.url;
    const isCorsTarget =
      url.includes('biblegateway.com') ||
      url.includes('bible-api.com') ||
      url.includes('google.com/search') ||
      url.includes('duckduckgo.com') ||
      url.includes('allorigins.win') ||
      url.includes('corsproxy.io') ||
      url.includes('thingproxy.freeboard.io');

    if (isCorsTarget) {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Access-Control-Allow-Origin': ['*'],
          'Access-Control-Allow-Headers': ['*'],
        }
      });
    } else {
      callback({ responseHeaders: details.responseHeaders });
    }
  });

  const win = new BrowserWindow({
    width: 440,
    height: 750,
    minWidth: 280,
    minHeight: 180,
    title: 'BibleDove',
    frame: false,
    icon: path.join(__dirname, 'logo.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    }
  });

  win.removeMenu();

  win.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F5' && input.type === 'keyDown') {
      event.preventDefault();
      if (!win.isDestroyed()) {
        win.webContents.send('focus-search');
      }
    }
  });

  win.on('focus', () => {
    if (!win.isDestroyed()) {
      win.webContents.send('window-focus');
    }
  });

  win.on('blur', () => {
    if (!win.isDestroyed()) {
      win.webContents.send('window-blur');
    }
  });

  win.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`[RENDERER] ${message} (${path.basename(sourceId)}:${line})`);
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  updater.setWindow(win);

  // Auto check for updates on startup if enabled in settings
  if (updater.settings && updater.settings.checkOnStartup) {
    setTimeout(() => {
      if (!win.isDestroyed()) {
        updater.checkForUpdates(false);
      }
    }, 4500);
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ══════════════════════════════════════════════════════════════════════════
//  BIBLEDOVE AUTO-UPDATER IPC HANDLERS
// ══════════════════════════════════════════════════════════════════════════
ipcMain.handle('get-app-version', () => app.getVersion());
ipcMain.handle('check-for-updates', (event, manual) => updater.checkForUpdates(manual));
ipcMain.handle('download-update', (event, url) => updater.downloadUpdate(url));
ipcMain.handle('install-update', (event, silent) => updater.installAndRestart(silent));
ipcMain.handle('get-update-settings', () => updater.settings);
ipcMain.handle('save-update-settings', (event, settings) => updater.saveSettings(settings));

// ══════════════════════════════════════════════════════════════════════════
//  LIGHTWEIGHT PURE NODE.JS HTTP & WEBSOCKET VOICE BRIDGE SERVER
// ══════════════════════════════════════════════════════════════════════════
const http = require('http');
const crypto = require('crypto');
const { shell } = require('electron');
ipcMain.on('open-voice-bridge', () => {
  shell.openExternal('http://localhost:3000/bridge.html');
});

ipcMain.on('open-external', (event, url) => {
  shell.openExternal(url);
});

ipcMain.on('set-always-on-top', (event, flag) => {
  const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  if (win) {
    win.setAlwaysOnTop(flag);
    console.log(`[MAIN] setAlwaysOnTop toggled to: ${flag}`);
  }
});

ipcMain.on('toggle-compact-size', (event, isCompact) => {
  const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  if (win) {
    if (isCompact) {
      // 380 x 220 is a perfect small PiP video size
      win.setSize(380, 220);
    } else {
      win.setSize(440, 750);
    }
    console.log(`[MAIN] toggle-compact-size: isCompact=${isCompact}`);
  }
});

ipcMain.on('window-minimize', () => {
  const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  if (win) win.minimize();
});

ipcMain.on('window-maximize', () => {
  const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  if (win) {
    if (win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }
  }
});

ipcMain.on('window-close', () => {
  const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  if (win) win.close();
});

let voiceBridgeSockets = [];

const server = http.createServer((req, res) => {
  if (req.url === '/bridge' || req.url === '/bridge.html') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>BibleDove - Chrome Voice Bridge</title>
  <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700&family=EB+Garamond:ital,wght@0,400;1,400&display=swap" rel="stylesheet">
  <style>
    body {
      background: #070510;
      color: #ede5d0;
      font-family: 'EB Garamond', Georgia, serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100vh;
      margin: 0;
      text-align: center;
      overflow: hidden;
    }
    body::before {
      content: '';
      position: absolute; inset: 0; pointer-events: none; z-index: 0;
      background: radial-gradient(ellipse 60% 40% at 50% 30%, rgba(107,77,176,.22) 0%, transparent 65%);
    }
    .container {
      position: relative; z-index: 1;
      background: rgba(22, 18, 42, 0.65);
      border: 1px solid #3d3060;
      border-radius: 20px;
      padding: 40px;
      max-width: 550px;
      width: 90%;
      box-shadow: 0 12px 40px rgba(107, 77, 176, 0.15), inset 0 1px 0 rgba(255,255,255,0.05);
      backdrop-filter: blur(8px);
    }
    h1 {
      font-family: 'Cinzel', serif;
      color: #d4a843;
      font-size: 24px;
      letter-spacing: 0.1em;
      margin-bottom: 15px;
      text-shadow: 0 0 10px rgba(212, 168, 67, 0.2);
    }
    p {
      font-size: 15.5px;
      line-height: 1.7;
      color: #ede5d0;
      margin-bottom: 25px;
    }
    #status {
      font-family: 'Cinzel', serif;
      font-size: 11px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      margin: 20px 0;
      color: #9b7de0;
      font-weight: 600;
    }
    .orb-btn {
      width: 90px; height: 90px;
      border-radius: 50%;
      background: radial-gradient(circle at 35% 30%, #1e1640, #0d0920);
      border: 2px solid #3d3060;
      color: #d4a843;
      font-size: 34px;
      cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      box-shadow: 0 0 28px rgba(107,77,176,.16);
      transition: all 0.3s;
      outline: none;
      margin: 0 auto;
    }
    .orb-btn:hover {
      border-color: #9b7de0;
      transform: scale(1.05);
      box-shadow: 0 0 35px rgba(107,77,176,.3);
    }
    .orb-btn.on {
      border-color: #d4a843;
      background: radial-gradient(circle at 35% 30%, #2e2650, #130e28);
      animation: pulse 1.8s infinite;
    }
    @keyframes pulse {
      0% { box-shadow: 0 0 20px rgba(212, 168, 67, 0.2); }
      50% { box-shadow: 0 0 45px rgba(212, 168, 67, 0.5); }
      100% { box-shadow: 0 0 20px rgba(212, 168, 67, 0.2); }
    }
    #transcript {
      margin-top: 30px;
      padding: 15px;
      border-top: 1px solid #2a2045;
      max-height: 120px;
      overflow-y: auto;
      font-size: 16px;
      line-height: 1.8;
      font-style: italic;
      color: #9a9080;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>Chrome Voice Bridge</h1>
    <p>This browser tab is transcribing your microphone input and streaming it securely back to your BibleDove desktop application.</p>
    <button id="orb-btn" class="orb-btn">
      <svg id="mic-icon" xmlns="http://www.w3.org/2000/svg" width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="transition: color 0.3s; color: #d4a843;"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>
    </button>
    <div id="status">Connecting to application...</div>
    
    <div id="transcript">Awaiting speech...</div>
  </div>

  <script>
    const statusEl = document.getElementById('status');
    const orbBtn = document.getElementById('orb-btn');
    const transcriptEl = document.getElementById('transcript');

    let ws = null;
    let recognition = null;
    let isOn = false;

    function connect() {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(proto + '//' + window.location.host);

      ws.onopen = () => {
        statusEl.textContent = 'Voice Bridge Connected! Click the mic button to begin.';
        statusEl.style.color = '#4db87a';
      };

      ws.onclose = () => {
        statusEl.textContent = 'Disconnected. Reconnecting...';
        statusEl.style.color = '#c05858';
        if (isOn) stopSpeech();
        setTimeout(connect, 2000);
      };

      ws.onerror = (err) => {
        console.error('WebSocket error:', err);
      };
    }

    function initSpeech() {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) {
        statusEl.textContent = 'Speech Recognition is not supported in this browser. Please use Google Chrome.';
        statusEl.style.color = '#c05858';
        orbBtn.style.display = 'none';
        return false;
      }

      recognition = new SR();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onstart = () => {
        statusEl.textContent = 'Voice Bridge Active. Speak continuous scriptures...';
        statusEl.style.color = '#ede5d0';
      };

      recognition.onresult = (event) => {
        let interim = '';
        let final = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const text = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            final += text;
            if (ws && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'final', text: text }));
            }
          } else {
            interim += text;
            if (ws && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'interim', text: text }));
            }
          }
        }
        transcriptEl.innerHTML = (final || interim) 
          ? '<span style="color:#ede5d0">' + (final || interim) + '</span>' 
          : 'Awaiting speech...';
      };

      recognition.onerror = (event) => {
        console.error('Speech error:', event.error);
        if (event.error !== 'no-speech' && event.error !== 'aborted') {
          statusEl.textContent = 'Speech Error: ' + event.error;
          statusEl.style.color = '#c05858';
        }
      };

      recognition.onend = () => {
        if (isOn) {
          try { recognition.start(); } catch(e){}
        }
      };

      return true;
    }

    function startSpeech() {
      if (!recognition && !initSpeech()) return;
      try {
        recognition.start();
        isOn = true;
        document.getElementById('mic-icon').style.color = '#ede5d0';
        orbBtn.classList.add('on');
        statusEl.textContent = 'Voice Bridge Active. Speak continuous scriptures...';
        statusEl.style.color = '#f0c96a';
      } catch(e) {
        console.error(e);
      }
    }

    function stopSpeech() {
      if (recognition) {
        recognition.stop();
      }
      isOn = false;
      document.getElementById('mic-icon').style.color = '#d4a843';
      orbBtn.classList.remove('on');
      statusEl.textContent = 'Voice Bridge Connected! Click the mic button to begin.';
      statusEl.style.color = '#4db87a';
    }

    orbBtn.addEventListener('click', () => {
      if (!isOn) {
        startSpeech();
      } else {
        stopSpeech();
      }
    });

    connect();
  </script>
</body>
</html>
    `);
  } else {
    res.writeHead(404);
    res.end();
  }
});

server.on('upgrade', (req, socket, head) => {
  const wsKey = req.headers['sec-websocket-key'];
  if (!wsKey) {
    socket.destroy();
    return;
  }

  const digest = crypto
    .createHash('sha1')
    .update(wsKey + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');

  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${digest}\r\n\r\n`
  );

  console.log('[MAIN] Voice Bridge WebSocket connected!');
  voiceBridgeSockets.push(socket);

  const win = BrowserWindow.getAllWindows()[0];
  if (win && !win.isDestroyed()) {
    win.webContents.send('voice-bridge-state', { connected: true });
  }

  socket.on('data', (buffer) => {
    try {
      let offset = 0;
      while (offset < buffer.length) {
        const firstByte = buffer[offset];
        const opCode = firstByte & 0x0F;

        if (opCode === 8) {
          socket.end();
          return;
        }

        const secondByte = buffer[offset + 1];
        const isMasked = (secondByte & 0x80) !== 0;
        let payloadLength = secondByte & 0x7F;
        let lengthOffset = 2;

        if (payloadLength === 126) {
          payloadLength = buffer.readUInt16BE(offset + 2);
          lengthOffset = 4;
        } else if (payloadLength === 127) {
          payloadLength = Number(buffer.readBigUInt64BE(offset + 2));
          lengthOffset = 10;
        }

        let maskingKey;
        if (isMasked) {
          maskingKey = buffer.slice(offset + lengthOffset, offset + lengthOffset + 4);
          lengthOffset += 4;
        }

        const payload = buffer.slice(offset + lengthOffset, offset + lengthOffset + payloadLength);
        let dataString = '';

        if (isMasked) {
          for (let i = 0; i < payloadLength; i++) {
            dataString += String.fromCharCode(payload[i] ^ maskingKey[i % 4]);
          }
        } else {
          dataString = payload.toString('utf8');
        }

        const msg = JSON.parse(dataString);
        const win = BrowserWindow.getAllWindows()[0];
        if (win && !win.isDestroyed()) {
          win.webContents.send('voice-bridge-transcript', msg);
        }

        offset += lengthOffset + payloadLength;
      }
    } catch (e) {
      // Ignore formatting split frames exceptions
    }
  });

  socket.on('close', () => {
    console.log('[MAIN] Voice Bridge WebSocket disconnected.');
    voiceBridgeSockets = voiceBridgeSockets.filter(s => s !== socket);
    const win = BrowserWindow.getAllWindows()[0];
    if (win && !win.isDestroyed()) {
      win.webContents.send('voice-bridge-state', { connected: false });
    }
  });

  socket.on('error', (err) => {
    console.warn('[MAIN] Voice Bridge socket error:', err.message);
  });
});

server.listen(3000, 'localhost', () => {
  console.log('[MAIN] Voice Bridge HTTP/WS Server running at http://localhost:3000/bridge.html');
});

