/* eslint-disable @typescript-eslint/no-require-imports */
const { spawnSync } = require('node:child_process')
const { createReadStream, existsSync, readdirSync, statSync, writeFileSync } = require('node:fs')
const { createServer } = require('node:http')
const { extname, join, normalize, resolve } = require('node:path')

const projectRoot = resolve(__dirname, '..')
const exportRoot = join(projectRoot, 'dist')
const buildMarker = join(exportRoot, '.e2e-build-stamp')
const expoCli = join(projectRoot, 'node_modules', 'expo', 'bin', 'cli')

function latestModified(path) {
  if (!existsSync(path)) return 0
  const stat = statSync(path)
  if (stat.isFile()) return stat.mtimeMs
  return readdirSync(path).reduce(
    (latest, entry) => Math.max(latest, latestModified(join(path, entry))),
    stat.mtimeMs,
  )
}

const sourceMtime = Math.max(
  ...['App.tsx', 'index.ts', 'app.json', 'package.json', 'package-lock.json', 'assets', 'src']
    .map((entry) => latestModified(join(projectRoot, entry))),
)
const markerMtime = latestModified(buildMarker)

if (!existsSync(join(exportRoot, 'index.html')) || markerMtime < sourceMtime) {
  const exportResult = spawnSync(
    process.execPath,
    [expoCli, 'export', '--platform', 'web', '--output-dir', exportRoot],
    { cwd: projectRoot, env: process.env, stdio: 'inherit' },
  )

  if (exportResult.status !== 0) process.exit(exportResult.status ?? 1)
  writeFileSync(buildMarker, `${new Date().toISOString()}\n`)
}

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

function safeAssetPath(pathname) {
  const decoded = decodeURIComponent(pathname.split('?')[0])
  const relative = normalize(decoded).replace(/^([/\\])+/, '')
  const candidate = resolve(exportRoot, relative)
  return candidate.startsWith(`${exportRoot}\\`) || candidate.startsWith(`${exportRoot}/`)
    ? candidate
    : null
}

const server = createServer((request, response) => {
  const requested = safeAssetPath(request.url ?? '/')
  const asset = requested && existsSync(requested) && statSync(requested).isFile()
    ? requested
    : join(exportRoot, 'index.html')

  response.statusCode = 200
  response.setHeader('Content-Type', mimeTypes[extname(asset).toLowerCase()] ?? 'application/octet-stream')
  response.setHeader('Cache-Control', 'no-store')
  createReadStream(asset).pipe(response)
})

server.listen(8082, '127.0.0.1', () => {
  process.stdout.write('E2E Expo export available at http://127.0.0.1:8082\n')
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)))
}
