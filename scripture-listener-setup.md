# BibleDove — Electron App Setup Guide

## Folder Structure

```
scripture-listener/
├── main.js
├── package.json
├── preload.js
├── .gitignore
├── renderer/
│   ├── index.html        ← your scripture-listener.html renamed
│   └── assets/           ← optional (icons, images)
└── node_modules/         ← auto-generated after npm install
```

---

## Step 1 — Create the folder and install Electron

```bash
mkdir scripture-listener
cd scripture-listener
npm init -y
npm install --save-dev electron
```

---

## Step 2 — `package.json`

Replace what `npm init` generated with this:

```json
{
  "name": "scripture-listener",
  "version": "1.0.0",
  "main": "main.js",
  "scripts": {
    "start": "electron ."
  },
  "devDependencies": {
    "electron": "^30.0.0"
  }
}
```

---

## Step 3 — `main.js`

This is the Electron main process. The `session.defaultSession.webRequest.onHeadersReceived` block strips Google's CORS headers so the app can fetch search results **directly — no external proxy needed**.

```js
const { app, BrowserWindow, session } = require('electron');
const path = require('path');

function createWindow() {
  // Strip CORS headers so Google fetch works natively inside Electron
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Access-Control-Allow-Origin': ['*'],
        'Access-Control-Allow-Headers': ['*'],
      }
    });
  });

  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'Scripture Listener',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    }
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
```

---

## Step 4 — `preload.js`

Just needs to exist. Add `contextBridge` APIs here later if needed.

```js
// preload.js
// Add contextBridge APIs here if you need to expose Node APIs to the renderer
```

---

## Step 5 — Move your HTML file

Create the `renderer/` folder and rename your downloaded HTML file to `index.html`:

```bash
mkdir renderer
mv scripture-listener.html renderer/index.html
```

---

## Step 6 — `.gitignore`

```
node_modules/
```

---

## Step 7 — Run the app

```bash
npm start
```

---

## How the app works

| Feature | Detail |
|---|---|
| **Trigger** | Tap the orb button to start/stop listening |
| **Search frequency** | Every 12 spoken words fires a Google search |
| **Search query format** | `"[12 words] [VERSION]"` e.g. `I am the way and the truth KJV` |
| **Translation** | Dropdown with 14 versions — KJV default |
| **Parsing** | Google HTML is parsed for scripture reference patterns like `John 3:16 — For God so loved...` |
| **Transcript** | Live transcript shown; searched phrases highlighted gold — click to re-search |
| **CORS** | Handled in `main.js` via `session.webRequest` — no external proxy needed |

---

## Troubleshooting

**Microphone not working**
> Electron requires a secure context for `getUserMedia`. Loading via `loadFile()` (local `file://`) satisfies this. Do not use `loadURL('http://...')` in development or the mic will be blocked.

**Speech Recognition not available**
> The Web Speech API (`window.SpeechRecognition`) is available in Electron because it uses Chromium under the hood. If it fails, make sure you are on Electron 28+ and that your system has a working microphone.

**Google search returns no results**
> The CORS fix in `main.js` must be present. If you see a network error in DevTools (`F12`), double-check the `onHeadersReceived` block is registered before `win.loadFile()`.

**To open DevTools for debugging**

Add this line inside `createWindow()` after `win.loadFile(...)`:

```js
win.webContents.openDevTools();
```

---

## Optional: Build a distributable `.exe` / `.dmg`

Install `electron-builder`:

```bash
npm install --save-dev electron-builder
```

Add to `package.json` under `"scripts"`:

```json
"build": "electron-builder"
```

Then run:

```bash
npm run build
```

Output will be in a `dist/` folder.
