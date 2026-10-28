// 글자 칸 맞춤 표. 터미널에서 한글·전각은 두 칸이라 글자 수가 아니라 칸 수로 맞춘다. 순수 함수만 둔다.

/** 터미널에서 차지하는 칸 수(한글·한자·전각·이모지는 두 칸) */
export function widthOf(s: string): number {
  let n = 0
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0
    n += (c >= 0x1100 && c <= 0x115f) || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3)
      || (c >= 0xf900 && c <= 0xfaff) || (c >= 0xfe30 && c <= 0xfe4f) || (c >= 0xff00 && c <= 0xff60) || (c >= 0xffe0 && c <= 0xffe6)
      || (c >= 0x1f300 && c <= 0x1faff) ? 2 : 1
  }
  return n
}

/** 칸 수로 채운다: 왼쪽 맞춤('l')은 뒤에, 오른쪽 맞춤('r')은 앞에 빈칸 */
export const pad = (s: string, width: number, align: 'l' | 'r' = 'l'): string => {
  const fill = ' '.repeat(Math.max(0, width - widthOf(s)))
  return align === 'r' ? `${fill}${s}` : `${s}${fill}`
}

/** 셀 하나로 다듬는다: 줄바꿈·탭 같은 공백은 한 칸으로, 칸 수가 max를 넘으면 잘라 …를 붙인다 */
export function cellOf(s: string, max = Infinity): string {
  const flat = s.replace(/\s+/g, ' ').trim()
  if (widthOf(flat) <= max) return flat
  let out = ''
  for (const ch of flat) {
    if (widthOf(out + ch) > max - 1) break
    out += ch
  }
  return `${out.trimEnd()}…`
}

/**
 * 머리줄·구분줄·내용 줄로 된 표. 칸 사이는 두 칸 띄운다. align은 칸마다('r'은 수), 없으면 왼쪽.
 * max는 칸마다 최대 칸 수(업무 설명처럼 긴 글이 칸 전체를 넓히지 않도록), 없으면 끝없이.
 * 맨 끝 칸은 왼쪽 맞춤이면 채우지 않고, 줄 끝 빈칸은 지운다.
 */
export function tableLines(head: readonly string[], rows: readonly (readonly string[])[], align: readonly ('l' | 'r')[] = [], max: readonly (number | undefined)[] = []): string[] {
  const body = rows.map(r => head.map((_, i) => cellOf(r[i] ?? '', max[i])))
  const widths = head.map((h, i) => Math.max(widthOf(h), ...body.map(r => widthOf(r[i] ?? ''))))
  const last = head.length - 1
  const line = (cells: readonly string[]) => cells.map((c, i) => (i === last && (align[i] ?? 'l') === 'l' ? c : pad(c, widths[i] ?? 0, align[i] ?? 'l'))).join('  ')
  return [line(head), widths.map(w => '─'.repeat(w)).join('  '), ...body.map(line)].map(l => l.trimEnd())
}

// ── 문서 블록: 같은 내용을 글(명령 답)과 마크다운(메뉴 화면) 두 가지로 그린다 ─────────────

export type Block =
  | { t: 'title'; text: string }
  | { t: 'line'; text: string }
  | { t: 'gap' }
  | { t: 'section'; text: string }
  | { t: 'bullet'; text: string }
  | { t: 'field'; label: string; value: string }
  /** 옮겨 적은 글(직원 보고 등): 줄마다 > 로, 마크다운에서는 인용(안의 글은 서식으로 읽히지 않게 이스케이프) */
  | { t: 'quote'; lines: readonly string[] }
  | { t: 'table'; head: readonly string[]; rows: readonly (readonly string[])[]; align?: readonly ('l' | 'r')[]; max?: readonly (number | undefined)[] }

/** 이름표 줄의 이름 폭 */
const FIELD_WIDTH = 12

/** 글로: 표는 칸 맞춤, 절 머리는 ■, 글머리는 -, 이름표는 폭을 맞춘다 */
export function textOf(blocks: readonly Block[]): string {
  return blocks.flatMap(b => {
    switch (b.t) {
      case 'title': case 'line': return [b.text]
      case 'gap': return ['']
      case 'section': return [`■ ${b.text}`]
      case 'bullet': return [`- ${b.text}`]
      case 'field': return [`${pad(b.label, FIELD_WIDTH)}${cellOf(b.value)}`]
      case 'quote': return b.lines.map(l => `> ${l}`)
      case 'table': return tableLines(b.head, b.rows, b.align, b.max)
    }
  }).join('\n')
}

/** 마크다운 화면이 한 번에 그리는 글자 수(엔진 한도) */
export const MD_MAX = 100_000

/**
 * 마크다운에 넣을 글: 터미널 제어 문자와 글 방향 뒤집기를 지우고(엔진은 tab·줄바꿈 말고는 받지 않는다), 공백을 한 칸으로 접고,
 * 마크다운 문법 글자는 글자 그대로 보이게 이스케이프한다(업무 설명 "fix __init__"이 굵게 그려지지 않도록)
 */
export const mdText = (s: string, max?: number): string =>
  cellOf(s.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/[\x00-\x08\x0b-\x1f\x7f‪-‮⁦-⁩]/g, ' '), max)
    .replace(/[\\`*_[\]<>|#~]/g, ch => `\\${ch}`)

/** 마크다운으로: 제목 ##, 절 ###, 표는 마크다운 표(수는 오른쪽 정렬), 이름표는 줄바꿈으로 잇고, 나머지는 문단 */
/**
 * 줄 앞의 블록 표시를 글자로: 목록(- +)은 앞에 \\, 번호 목록(1.)은 점 앞에 \\(\\1.은 이스케이프가 아니라 그대로 보인다).
 * isQuote면 제목 밑줄(=== ---)·빈 글머리도 막는다
 */
const escapeLead = (md: string, isQuote = false): string =>
  md.replace(isQuote ? /^([-+=]+)(?=\s|$)/ : /^([-+])(?= )/, '\\$1').replace(isQuote ? /^(\d+)\.(?=\s|$)/ : /^(\d+)\.(?= )/, '$1\\.')

/** max: 화면이 한 번에 그리는 한도(파일로 쓸 때는 Infinity) */
export function mdOf(blocks: readonly Block[], max = MD_MAX): string {
  const parts: { t: Block['t']; md: string }[] = []
  for (const b of blocks) {
    switch (b.t) {
      case 'title': parts.push({ t: b.t, md: `## ${mdText(b.text)}` }); break
      // 줄이 목록 표시(- , + , 1. )로 시작하면 목록으로 그려지지 않게 앞을 이스케이프한다
      case 'line': parts.push({ t: b.t, md: escapeLead(mdText(b.text)) }); break
      case 'gap': break
      case 'section': parts.push({ t: b.t, md: `### ${mdText(b.text)}` }); break
      case 'bullet': parts.push({ t: b.t, md: `- ${mdText(b.text)}` }); break
      case 'field': parts.push({ t: b.t, md: `**${mdText(b.label)}** ${mdText(b.value)}` }); break
      // 줄마다 끊어(줄 끝 두 칸) 한 인용으로
      // 옮겨 적은 글은 서식으로 읽히지 않게: 줄 앞의 목록·제목 밑줄(-, +, =, 1.) 표시와 맨 주소의 자동 링크(://)도 끊는다
      case 'quote': parts.push({ t: b.t, md: b.lines.map(l => `> ${escapeLead(mdText(l), true).replace(/:\/\//g, ':\\/\\/')}`).join('  \n') }); break
      case 'table': {
        const row = (cells: readonly string[]) => `| ${cells.join(' | ')} |`
        parts.push({ t: b.t, md: [
          row(b.head.map(h => mdText(h))),
          row(b.head.map((_, i) => ((b.align?.[i] ?? 'l') === 'r' ? '---:' : '---'))),
          ...b.rows.map(r => row(b.head.map((_, i) => mdText(r[i] ?? '', b.max?.[i])))),
        ].join('\n') })
      }
    }
  }
  // 글머리끼리는 이어 목록으로, 이름표끼리는 줄바꿈(줄 끝 두 칸)으로 잇고, 나머지는 문단으로 띄운다
  const md = parts.reduce((s, x, i) => {
    if (i === 0) return x.md
    const prev = parts[i - 1]?.t
    if (prev === 'bullet' && x.t === 'bullet') return `${s}\n${x.md}`
    if (prev === 'field' && x.t === 'field') return `${s}  \n${x.md}`
    return `${s}\n\n${x.md}`
  }, '')
  return md.length <= max ? md : `${md.slice(0, max - 20)}\n\n…(잘림)`
}
