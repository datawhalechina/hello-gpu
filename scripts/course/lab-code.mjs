#!/usr/bin/env node
// 实验室通关码（HGPU1.）和 GPU 卡片导入码（HGCARD1.）的小工具，也用来和 Python 的 hello_gpu 互验。
// 也有的 CompressionStream / DecompressionStream('deflate-raw')，和网页（L-02、L-07）走同一条路。
// 用法：
//   node scripts/course/lab-code.mjs decode <码>                        打印码里的 JSON
//   node scripts/course/lab-code.mjs encode <credential|card> <文件.json>  把 JSON 编成通关码 / 导入码
//   node scripts/course/lab-code.mjs check                              Python ↔ Node 互验
// check 调用 hello_gpu 的 submit() 和 device_card()（设备信息换成伪造数据，不需要 GPU），再用 Node 解码；
// 反过来把 Node 编的码交给 hello_gpu.codes.decode()。需要装了 torch 的 Python（CPU 版即可），
// 用环境变量 PYTHON 指定，默认 python3。
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'

export const CREDENTIAL = 'HGPU1.'
export const CARD = 'HGCARD1.'

const root = fileURLToPath(new URL('../../', import.meta.url))
const USAGE = `用法：
  node scripts/course/lab-code.mjs decode <码>
  node scripts/course/lab-code.mjs encode <credential|card> <文件.json>
  node scripts/course/lab-code.mjs check   （PYTHON=装了 torch 的 Python，默认 python3）`

async function pipe(bytes, transform) {
  const stream = new Blob([bytes]).stream().pipeThrough(transform)
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** 把 JSON 编成码；prefix 是 CREDENTIAL（通关码）或 CARD（GPU 卡片导入码）。 */
export async function encodeCode(prefix, payload) {
  if (prefix !== CREDENTIAL && prefix !== CARD) throw new Error(`前缀只能是 ${CREDENTIAL} 或 ${CARD}`)
  const packed = await pipe(new TextEncoder().encode(JSON.stringify(payload)), new CompressionStream('deflate-raw'))
  return prefix + Buffer.from(packed).toString('base64url')
}

/** 解开码，返回 { prefix, payload }。只解码，不检查内容（内容检查在 hello_gpu.codes 和网页的 lab.ts 里）。 */
export async function decodeCode(code) {
  const text = String(code).replace(/\s+/g, '')
  const prefix = [CREDENTIAL, CARD].find((p) => text.startsWith(p))
  if (!prefix) throw new Error(`开头应该是 ${CREDENTIAL} 或 ${CARD}`)
  const body = text.slice(prefix.length)
  if (!/^[A-Za-z0-9_-]+$/.test(body)) throw new Error('码里有不该出现的字符，或者没有复制完整')
  const raw = await pipe(Buffer.from(body, 'base64url'), new DecompressionStream('deflate-raw'))
  return { prefix, payload: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)) }
}

// 不需要 GPU：把 hello_gpu.lab 里读设备、读 rocminfo、读峰值缓存的私有函数换成伪造数据。
// 这些函数改名时，这里要跟着改。
const PY_MAKE = String.raw`
import json, sys
sys.path.insert(0, "notebooks/common/src")
import hello_gpu as hg
from hello_gpu import lab
lab._require_gpu = lambda caller: None
lab._device = lambda: {"name": "Fixture GPU（伪造数据）", "gfx": "gfx9999", "cus": 10,
                       "wave": 32, "memory_bytes": 1 << 30}
lab._run_rocminfo = lambda: None
lab._cached_peak = lambda device: {"gbps": 610.0, "tflops": 40.0}
submission = hg.submit("forge-softmax", "hip", checks={"passed": 5, "total": 5},
                       metrics={"median_ms": 0.123, "gbps": 366.0, "peak_gbps": 610.0, "torch_ms": 0.15})
card = hg.device_card()
print(json.dumps({"code": submission.code, "link": submission.link, "path": str(submission.path),
                  "card": card}, ensure_ascii=False))
`

const PY_DECODE = String.raw`
import json, sys
sys.path.insert(0, "notebooks/common/src")
from hello_gpu import codes
for code in sys.stdin.read().split():
    print(json.dumps(codes.decode(code)[1], ensure_ascii=False))
`

/** Python ↔ Node 互验；全部通过时返回 true。 */
async function check() {
  const python = process.env.PYTHON || 'python3'
  const artifacts = mkdtempSync(join(tmpdir(), 'hg-lab-code-'))
  const run = (script, input = '') => {
    const result = spawnSync(python, ['-c', script], {
      cwd: root, input, encoding: 'utf8', env: { ...process.env, HELLO_GPU_ARTIFACTS: artifacts },
    })
    if (result.error) throw new Error(`运行 ${python} 失败：${result.error.message}`)
    if (result.status !== 0) throw new Error(`Python 出错：\n${result.stderr}`)
    return result.stdout.trim().split('\n')
  }
  const failures = []
  const expect = (ok, text) => {
    console.log(`${ok ? '✓' : '✗'} ${text}`)
    if (!ok) failures.push(text)
  }
  try {
    const made = JSON.parse(run(PY_MAKE).at(-1))
    const saved = JSON.parse(readFileSync(made.path, 'utf8'))
    const credential = await decodeCode(made.code)
    expect(credential.prefix === CREDENTIAL && isDeepStrictEqual(credential.payload, saved),
      'Python submit() 生成的通关码：Node 解码后和存下的凭证 JSON 一致')
    expect(made.link.endsWith(`/forge/softmax/#lab=${made.code}`),
      '通关链接指向 /forge/softmax/，#lab= 后面就是通关码')
    const card = await decodeCode(made.card.code)
    const { name, gfx, cus, wave, memory_bytes, rocm, torch, triton, peak_gbps, peak_tflops } = made.card
    expect(card.prefix === CARD
      && isDeepStrictEqual(card.payload.device, { name, gfx, cus, wave, memory_bytes })
      && isDeepStrictEqual(card.payload.env, { rocm, torch, triton })
      && isDeepStrictEqual(card.payload.peak, { gbps: peak_gbps, tflops: peak_tflops }),
    'Python device_card() 生成的导入码：Node 解码后和卡片一致')
    const ours = [await encodeCode(CREDENTIAL, saved), await encodeCode(CARD, card.payload)]
    const back = run(PY_DECODE, ours.join('\n')).map((line) => JSON.parse(line))
    expect(isDeepStrictEqual(back, [saved, card.payload]),
      'Node 编码的通关码和导入码：Python（hello_gpu.codes.decode）解码并通过格式检查后一致')
  } finally {
    rmSync(artifacts, { recursive: true, force: true })
  }
  return failures.length === 0
}

async function main([command, ...args]) {
  if (command === 'decode' && args.length === 1) {
    const { prefix, payload } = await decodeCode(args[0])
    console.log(prefix === CREDENTIAL ? '通关码：' : 'GPU 卡片导入码：')
    console.log(JSON.stringify(payload, null, 2))
  } else if (command === 'encode' && args.length === 2 && (args[0] === 'credential' || args[0] === 'card')) {
    const payload = JSON.parse(readFileSync(args[1], 'utf8'))
    console.log(await encodeCode(args[0] === 'card' ? CARD : CREDENTIAL, payload))
  } else if (command === 'check' && args.length === 0) {
    if (!(await check())) process.exitCode = 1
  } else {
    console.error(USAGE)
    process.exitCode = 2
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`出错：${error.message}`)
    process.exitCode = 1
  })
}
