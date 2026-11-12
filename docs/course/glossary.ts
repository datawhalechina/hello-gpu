/**
 * 术语表（glossary.json，F-07）的类型化读取，以及术语在页面上的写法（05 第 3 节）。
 * 概念卡（ConceptCard）和奖励反馈（收入图鉴的 Toast）用同一个写法。
 */
import glossaryData from './glossary.json' with { type: 'json' }

export interface GlossaryEntry {
  term: string
  en: string
  zone: string
  short: string
  analogy?: string
  analogyLimit?: string
  links: string[]
}

export const GLOSSARY = glossaryData as Record<string, GlossaryEntry>

/** 首次出现写成「中文（English）」；不翻译的术语（中英文写法一样）只写一次；术语表里没有就原样返回键。 */
export function termName(key: string): string {
  const entry = GLOSSARY[key]
  if (!entry) return key
  return entry.en && entry.en !== entry.term ? `${entry.term}（${entry.en}）` : entry.term
}
