#!/usr/bin/env node
// Build the independent React document before VitePress copies public assets.
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const app = path.join(root, 'apps/gpu-atlas/nvidia')
const output = path.join(app, 'dist')
const destination = path.join(root, 'docs/public/atlas/nvidia')
const installStamp = path.join(app, 'node_modules/.hello-gpu-install.sha256')

function npm(args) {
  // npm_execpath keeps the same npm version as the enclosing docs command.
  if (process.env.npm_execpath) {
    execFileSync(process.execPath, [process.env.npm_execpath, ...args], {
      cwd: app,
      stdio: 'inherit',
    })
  } else {
    execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, {
      cwd: app,
      stdio: 'inherit',
    })
  }
}

async function main() {
  const [major, minor] = process.versions.node.split('.').map(Number)
  if (!((major === 20 && minor >= 19) || (major === 22 && minor >= 12) || major > 22)) {
    throw new Error('GPU Atlas requires Node.js ^20.19.0 or >=22.12.0 (Vite 7).')
  }

  const manifest = await readFile(path.join(app, 'package.json'))
  const lockfile = await readFile(path.join(app, 'package-lock.json'))
  const fingerprint = createHash('sha256')
    .update(manifest)
    .update(lockfile)
    .update(`${major}:${process.platform}:${process.arch}`)
    .digest('hex')
  const installed = await readFile(installStamp, 'utf8').catch(() => '')

  if (installed !== fingerprint || !existsSync(path.join(app, 'node_modules/vite/package.json'))) {
    console.log('atlas: installing NVIDIA app dependencies from package-lock.json')
    npm(['ci', '--include=dev', '--no-audit', '--no-fund'])
    await writeFile(installStamp, fingerprint)
  }

  // Relative URLs work under both /hello-gpu/atlas/nvidia/ and /atlas/nvidia/.
  npm(['run', 'build', '--', '--base', './'])
  if (!existsSync(path.join(output, 'index.html'))) {
    throw new Error('GPU Atlas build did not produce dist/index.html.')
  }

  // Copy the whole output so any future fonts, textures or chunks travel with it.
  // Never remove the previous staged app until the new build has succeeded.
  await rm(destination, { recursive: true, force: true })
  await mkdir(path.dirname(destination), { recursive: true })
  await cp(output, destination, { recursive: true })
  console.log(`atlas: staged NVIDIA app at ${path.relative(root, destination)}/`)
}

main().catch((error) => {
  console.error(`atlas: ${error.message}`)
  process.exitCode = 1
})
