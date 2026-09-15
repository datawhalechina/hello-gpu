#!/usr/bin/env node
// Stage the standalone atlas HTML documents before VitePress copies public assets.
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const vendors = ['amd']

async function stage(vendor) {
  const source = path.join(root, `apps/gpu-atlas/${vendor}/index.html`)
  const destination = path.join(root, `docs/public/atlas/${vendor}`)
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

async function main() {
  for (const vendor of vendors) {
    await stage(vendor)
  }
}

main().catch((error) => {
  console.error(`atlas: ${error.message}`)
  process.exitCode = 1
})
