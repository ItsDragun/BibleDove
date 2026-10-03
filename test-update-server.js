// ══════════════════════════════════════════════════════════════════════════
//  LOCAL TEST UPDATE SERVER FOR BIBLEDOVE
// ══════════════════════════════════════════════════════════════════════════
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3001;
const distDir = path.join(__dirname, 'dist');

function getLatestExe() {
  const v102 = path.join(distDir, 'BibleDove Setup 1.0.2.exe');
  if (fs.existsSync(v102)) return { file: v102, version: '1.0.2' };
  const v101 = path.join(distDir, 'BibleDove Setup 1.0.1.exe');
  if (fs.existsSync(v101)) return { file: v101, version: '1.0.1' };
  return null;
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = req.url.split('?')[0];

  if (url === '/update.json') {
    const latest = getLatestExe();
    const ver = latest ? latest.version : '1.0.2';
    const manifest = {
      version: ver,
      notes: "🕊️ BibleDove v1.0.2 Update:\n• Verified in-app self-update system (v1.0.1 → v1.0.2)!\n• Added golden dove title badge\n• Improved real-time scripture search responsiveness",
      downloadUrl: `http://localhost:${PORT}/BibleDove-Setup-${ver}.exe`,
      releaseDate: new Date().toISOString()
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(manifest, null, 2));
    console.log(`[LOCAL UPDATE SERVER] Served /update.json to app (version ${ver})`);
    return;
  }

  if (url.toLowerCase().endsWith('.exe')) {
    const latest = getLatestExe();
    if (!latest || !fs.existsSync(latest.file)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Installer not found or still compiling.');
      return;
    }
    const stat = fs.statSync(latest.file);
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': stat.size,
      'Content-Disposition': `attachment; filename="${path.basename(latest.file)}"`
    });
    console.log(`[LOCAL UPDATE SERVER] Streaming ${path.basename(latest.file)} (${(stat.size / 1024 / 1024).toFixed(1)} MB)...`);
    const stream = fs.createReadStream(latest.file);
    stream.pipe(res);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

server.listen(PORT, () => {
  console.log(`[LOCAL UPDATE SERVER] Running on http://localhost:${PORT}`);
  console.log(`[LOCAL UPDATE SERVER] Manifest endpoint: http://localhost:${PORT}/update.json`);
});
