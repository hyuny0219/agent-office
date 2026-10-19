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
  return `${out}…`
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
