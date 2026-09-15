#!/usr/bin/env node
// Stage the standalone atlas HTML documents before VitePress copies public assets.
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const staging = path.join(root, 'docs/public/atlas')
const vendors = ['amd']

async function stage(vendor) {
  const source = path.join(root, `apps/gpu-atlas/${vendor}/index.html`)
  const destination = path.join(staging, vendor)
  const html = await readFile(source, 'utf8')
  if (!/<!doctype html>/i.test(html) || !/<html\b/i.test(html) || !/<\/html\s*>/i.test(html)) {
    throw new Error(`GPU Atlas source must be a complete HTML document: apps/gpu-atlas/${vendor}/index.html.`)
  }
  if (!html.includes('<meta name="atlas-build" content="obfuscated">')) {
    throw new Error(`GPU Atlas must use the obfuscated single-file release from the private source repository: ${vendor}.`)
  }
  if (/sourceMappingURL\s*=/.test(html)) {
    throw new Error(`GPU Atlas release must not embed or reference a source map: ${vendor}.`)
  }

  // Validate first, then remove any assets left by earlier multi-file builds.
  await rm(destination, { recursive: true, force: true })
  await mkdir(destination, { recursive: true })
  await writeFile(path.join(destination, 'index.html'), html)
  console.log(`atlas: staged ${vendor.toUpperCase()} HTML at ${path.relative(root, destination)}/index.html`)
}

// Drop output for vendors that are no longer published, so an existing clone cannot
// carry a removed exhibit into dist through docs/public/.
async function prune() {
  let entries
  try {
    entries = await readdir(staging, { withFileTypes: true })
  } catch (error) {
    if (error.code === 'ENOENT') return
    throw error
  }

  for (const entry of entries) {
    if (vendors.includes(entry.name)) continue
    const stale = path.join(staging, entry.name)
    await rm(stale, { recursive: true, force: true })
    console.log(`atlas: removed stale output ${path.relative(root, stale)}`)
  }
}

async function main() {
  for (const vendor of vendors) {
    await stage(vendor)
  }
  await prune()
}

main().catch((error) => {
  console.error(`atlas: ${error.message}`)
  process.exitCode = 1
})
