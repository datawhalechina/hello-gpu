import { readdir } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

// Reserve the real image ratio before lazy loading, so anchor targets stay put.
export async function createImageDimensionLookup(root) {
  const dimensions = new Map()

  async function scan(directory) {
    const entries = await readdir(directory, { withFileTypes: true })
    await Promise.all(entries.map(async entry => {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') return
      const file = path.join(directory, entry.name)
      if (entry.isDirectory()) return scan(file)
      if (!/\.(png|webp|jpe?g|gif|svg)$/i.test(entry.name)) return
      const { width, height } = await sharp(file).metadata()
      if (width && height) dimensions.set(file, { width, height })
    }))
  }

  await scan(root)
  return (src, pagePath) => {
    if (!pagePath || /^(?:[a-z][\w+.-]*:|\/\/)/i.test(src)) return
    const pathname = decodeURIComponent(src.split(/[?#]/)[0])
    const file = pathname.startsWith('/')
      ? path.join(root, 'public', pathname)
      : path.resolve(path.dirname(path.resolve(root, pagePath)), pathname)
    return dimensions.get(file)
  }
}
