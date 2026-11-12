/**
 * 「我的 GPU 卡片」（L-07；07 第 7 节 hg.device_card()，04 第 7 节存档）：导入码（HGCARD1.）变成存档里的一张卡，
 * 导入失败时怎么跟读者说。
 *
 * - 解码和检查在 lab.ts 的 decodeCard（同 hello_gpu.codes.check_card，两边跑同一份共享样例）。
 * - 存几张、哪张是当前在 progress.ts（saveDevice / selectDevice / removeDevice / currentDevice），页面经 useProgress 调用。
 * - 界面在 kit/DeviceCard.vue；读当前那张的有 1-2 的全景图（panorama.ts 的 specFromCard）和 2-4 的 Roofline（读 peak）。
 *   它们只读存档、不导入 lab.ts，解码的代码只跟着 DeviceCard 加载。
 *
 * 卡片里的 CU 数是计算单元的个数：按 WGP 计数的卡（RDNA），hello_gpu 已经把 PyTorch 报的 multi_processor_count 乘了 2
 * （lab.py 的 _wgp_mode），这里照用。纯 TS，node --test 可以直接 import。
 */
import { CARD_PREFIX, CREDENTIAL_PREFIX, type LabCard, type LabCodeError, type LabErrorText } from './lab.ts'
import type { DeviceRecord } from './progress.ts'

/** 认卡用的键（同 hello_gpu 峰值缓存的文件名，lab.py 的 _peak_path）：gfx、CU 数和名称，小写，其余字符换成连字符。 */
export function deviceKey(device: { gfx: string; cus: number; name: string }): string {
  return `${device.gfx} ${device.cus}cu ${device.name}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

/** 解码、检查过的卡片换成存档里的样子；导入时间由 saveDevice 记。 */
export function cardRecord(card: LabCard): DeviceRecord {
  const { name, gfx, cus, wave, memory_bytes: memoryBytes } = card.device
  const { rocm, torch, triton } = card.env
  return {
    id: deviceKey(card.device),
    name: name.trim(),
    gfx,
    cus,
    wave: wave ?? null,
    memoryBytes,
    env: { rocm: rocm ?? null, torch: torch ?? null, triton: triton ?? null },
    peak: card.peak ? { gbps: card.peak.gbps, tflops: card.peak.tflops, at: card.at } : null,
    at: card.at,
    importedAt: 0,
  }
}

/** 导入失败时给读者看的话：现象、原因、怎么改（03 第 4 节），同 lab.ts 的 explainLabError。 */
export function explainCardError(error: LabCodeError): LabErrorText {
  const plain = { cause: `${error.message}。`, link: null }
  switch (error.kind) {
    case 'credential':
      return {
        symptom: '贴进来的是通关码，不是「我的 GPU 卡片」的导入码。',
        cause: `${CREDENTIAL_PREFIX} 开头的码由 hg.submit() 生成，记的是一关的成绩，不是这张卡的参数。`,
        fix: `这里要的是 hg.device_card() 打印的、${CARD_PREFIX} 开头的导入码；通关码贴到那一关页面的「导入成绩」里。`,
        link: null,
      }
    case 'version':
      return {
        ...plain,
        symptom: '导入码的版本不对，这一页认不出来。',
        fix: '网页和 hello_gpu 要是同一版：先刷新这一页；还不行就在仓库目录里运行 git pull，再重新运行 hg.device_card()。',
      }
    case 'data':
      return {
        ...plain,
        symptom: '导入码能解开，但里面的数据不对。',
        fix: '重新运行 hg.device_card()，用新打印的导入码；导入码里的内容不要手改。',
      }
    case 'browser':
      return {
        ...plain,
        symptom: '这个浏览器解不开导入码。',
        fix: '换用新版的 Chrome、Edge、Firefox 或 Safari 再导入。',
      }
    default:
      return {
        ...plain,
        symptom: '这串字符不是完整的导入码。',
        fix: `回到 Notebook，把 hg.device_card() 最后打印的、${CARD_PREFIX} 开头的那一整串复制过来。`,
      }
  }
}
