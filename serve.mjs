// Servidor local de Masu, sin dependencias. Las imágenes nunca salen de esta PC.
import { spawn } from 'node:child_process';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const roots = [join(root, 'dist'), join(root, 'public')];
const startPort = Number(process.env.PORT) || 4173;
const noOpen = process.argv.includes('--no-open');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

function find(urlPath) {
  const clean = normalize(decodeURIComponent(urlPath)).replace(/^[/\\]+/, '');
  if (clean.split(sep).includes('..')) return null;
  for (const base of roots) {
    const file = join(base, clean || 'index.html');
    if (existsSync(file) && statSync(file).isFile()) return file;
  }
  return null;
}

const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  const file = find(path === '/' ? '/index.html' : path);
  // Aislamiento de origen: sin esto los modelos corren con un solo hilo.
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  if (!file) {
    res.statusCode = 404;
    res.end('No encontrado');
    return;
  }
  res.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream');
  res.setHeader('Content-Length', statSync(file).size);
  createReadStream(file).pipe(res);
});

function openBrowser(url) {
  if (noOpen) return;
  // Ruta completa: el PATH de esta PC no siempre incluye System32.
  const shell = process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe';
  spawn(shell, ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
}

async function isMasu(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1500) });
    return (await res.text()).includes('<title>Masu</title>');
  } catch {
    return false;
  }
}

let port = startPort;
// Solo en esta computadora: nadie más en la red puede abrirlo.
const listen = () => server.listen(port, '127.0.0.1');

server.on('listening', () => {
  const url = `http://localhost:${server.address().port}`;
  console.log(`Masu abierto en ${url}\nCierra esta ventana para apagarlo.`);
  openBrowser(url);
});

server.on('error', async (err) => {
  if (err.code !== 'EADDRINUSE' || port >= startPort + 20) throw err;
  // Los proyectos guardados viven por puerto: otro puerto los mostraría vacíos.
  if (await isMasu(port)) {
    const url = `http://localhost:${port}`;
    console.log(`Masu ya estaba abierto en ${url}`);
    openBrowser(url);
    return;
  }
  port += 1;
  listen();
});

listen();
