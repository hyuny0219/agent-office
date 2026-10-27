// 평면도 칸(글자·글자색·배경색)을 ANSI 트루컬러 줄로 바꾼다. 평면도 계산은 core/scene.ts 그대로이고, 여기서는 칠하기만 한다.

/** 칸 배열(칸마다 글자 코드·글자색·배경색 0xRRGGBB, 행 우선)을 줄마다 ANSI 문자열로 */
export function ansiLines(words: Uint32Array, columns: number, rows: number): string[] {
  const out: string[] = []
  for (let y = 0; y < rows; y++) {
    let line = ''
    let lastFg = -1
    let lastBg = -1
    for (let x = 0; x < columns; x++) {
      const o = (y * columns + x) * 3
      const ch = words[o] ?? 32
      const fg = words[o + 1] ?? 0
      const bg = words[o + 2] ?? 0
      if (fg !== lastFg) line += `\x1b[38;2;${(fg >> 16) & 255};${(fg >> 8) & 255};${fg & 255}m`
      if (bg !== lastBg) line += `\x1b[48;2;${(bg >> 16) & 255};${(bg >> 8) & 255};${bg & 255}m`
      lastFg = fg
      lastBg = bg
      line += String.fromCodePoint(ch)
    }
    out.push(`${line}\x1b[0m`)
  }
  return out
}
