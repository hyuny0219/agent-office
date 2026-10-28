// oh-my-pi판 화면의 줄 만들기: 입력창 위 2단 패널, 오른쪽 사이드바, 메뉴 화면. omp에 기대지 않는 순수 함수라
// 화면 스냅샷(scripts/snap.ts)과 테스트가 그대로 부른다. 평면도 줄은 부르는 쪽이 만들어 넘긴다(Office는 프레임마다 상태가 있다).
import type { HrBook, JournalEntry, OfficeAgent, Utterance } from '../types'
import { journalBlocks, journalViewOf } from '../core/journal'
import { feedRowsOf, rowsOf } from '../core/rows'
import { budgetBlocks } from '../core/budget'
import { archiveBlocks, cardBlocks, deptMapBlocks, findEmployee, reportBlocks, rosterBlocks } from '../core/report'
import { playbookBlocks, proposalAlert } from '../core/playbook'
import { mdOf, textOf, widthOf } from '../core/table'
import type { Block } from '../core/table'

/** 2단 패널을 쓰는 최소 폭 */
export const TWO_COLUMN_MIN = 90

const CSI_OR_OSC = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g

/** 보이는 칸 수로 자른다(ANSI 코드는 칸을 차지하지 않는다) */
export function clip(line: string, width: number): string {
  let out = ''
  let w = 0
  // 색(SGR)·지우기 같은 CSI와 링크(OSC)는 칸을 차지하지 않는다
  for (const m of line.matchAll(/\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|[\s\S]/gu)) {
    const s = m[0]
    if (s.startsWith('\x1b')) {
      out += s
      continue
    }
    const cw = widthOf(s)
    if (w + cw > width) break
    out += s
    w += cw
  }
  return `${out}\x1b[0m`
}

/** ANSI 코드를 뺀 글(스냅샷·칸 세기용) */
export const plain = (line: string): string => line.replace(CSI_OR_OSC, '')

/** 보이는 칸 수에 맞춰 자르고 모자라면 빈칸으로 채운다 */
export function pad(line: string, width: number): string {
  const cut = clip(line, width)
  return `${cut}${' '.repeat(Math.max(0, width - widthOf(plain(cut))))}`
}

/** 그 칸 수의 평면도 줄(평면도를 켜지 않았으면 null) */
export type PlanLines = ((columns: number) => string[]) | null

export type Scene = { agents: readonly OfficeAgent[]; book: HrBook; feed: readonly Utterance[]; now: number; journal?: readonly JournalEntry[] }

const tinted = (r: { text: string; isOff: boolean; isBad: boolean }): string => (r.isOff ? `\x1b[2m${r.text}\x1b[0m` : r.isBad ? `\x1b[31m${r.text}\x1b[0m` : r.text)

/** 입력창 위 패널: (켜면) 평면도, 그 아래 2단(왼쪽 사무실 목록 | 오른쪽 사내 메신저, 좁으면 위아래로) */
export function widgetLines(width: number, s: Scene, plan: PlanLines): string[] {
  // 새 지침 후보가 있으면 맨 위에 알림 줄(메뉴 6을 볼 때까지)
  const alert = proposalAlert(s.book, s.now, width < 72)
  const lines: string[] = alert === null ? [] : [`\x1b[33m● ${alert}\x1b[0m`]
  if (plan !== null && width >= 72) lines.push(...plan(width))
  const isTwo = width >= TWO_COLUMN_MIN
  const leftW = isTwo ? Math.floor(width * 0.55) : width
  const rightW = isTwo ? width - leftW - 3 : width
  const rows = rowsOf([...s.agents], s.book, s.now, leftW)
  const left = rows.length === 0 ? ['\x1b[2m에이전트 사무실: 아직 일하는 에이전트가 없습니다 (/office menu)\x1b[0m'] : rows.map(tinted)
  const feed = feedRowsOf([...s.feed], s.now).slice(isTwo ? -Math.max(left.length, 3) : -2)
  const right = feed.length === 0 ? ['\x1b[2m사내 메신저: 아직 오간 말이 없습니다\x1b[0m'] : feed.map(f => `\x1b[2m${f.text}\x1b[0m`)
  if (!isTwo) return [...lines, ...left, ...right].map(l => clip(l, width))
  for (let i = 0; i < Math.max(left.length, right.length); i++) lines.push(`${pad(left[i] ?? '', leftW)} \x1b[2m│\x1b[0m ${clip(right[i] ?? '', rightW)}`)
  return lines.map(l => clip(l, width))
}

/** 오른쪽 사이드바: 내용 높이만큼의 테두리 상자(화면 높이를 채우면 omp가 위에서부터 그리는 입력창·상태 줄을 가린다) */
export function sideLines(width: number, s: Scene, plan: PlanLines): string[] {
  const inner = Math.max(10, width - 2)
  const bar = `\x1b[2m│\x1b[0m `
  const lines: string[] = [`\x1b[2m╭${'─'.repeat(Math.max(0, width - 1))}\x1b[0m`, `${bar}\x1b[1m에이전트 사무실\x1b[0m \x1b[2m(/office side 닫기 · /office menu)\x1b[0m`]
  const alert = proposalAlert(s.book, s.now, inner < 72)
  if (alert !== null) lines.push(`${bar}\x1b[33m● ${alert}\x1b[0m`)
  if (plan !== null && inner >= 72) for (const l of plan(inner)) lines.push(`${bar}${l}`)
  const rows = rowsOf([...s.agents], s.book, s.now, inner)
  for (const r of rows.length === 0 ? [{ text: '아직 일하는 에이전트가 없습니다', isOff: true, isBad: false }] : rows) lines.push(`${bar}${tinted(r)}`)
  const feed = feedRowsOf([...s.feed], s.now)
  lines.push(bar, `${bar}\x1b[1m사내 메신저\x1b[0m`, ...(feed.length === 0 ? [`${bar}\x1b[2m아직 오간 말이 없습니다\x1b[0m`] : feed.map(f => `${bar}\x1b[2m${f.text}\x1b[0m`)))
  lines.push(`\x1b[2m╰${'─'.repeat(Math.max(0, width - 1))}\x1b[0m`)
  return lines.map(l => clip(l, width))
}

// ── 메뉴 화면: 0 사무실(평면도·목록, 누르면 인사카드), 1~8로 고른 것을 표로, 설정은 그 자리에서 켜고 끈다 ─────────────

export const MENU = [
  { key: '0', label: '사무실', view: 'office' },
  { key: '1', label: '인사 명부', view: 'hr' },
  { key: '2', label: '일간 보고', view: 'today' },
  { key: '3', label: '주간 보고', view: 'week' },
  { key: '4', label: '예산', view: 'budget' },
  { key: '5', label: '설정', view: 'settings' },
  { key: '6', label: '지침', view: 'playbook' },
  { key: '7', label: '기록', view: 'archive' },
  { key: '8', label: '일지', view: 'journal' },
] as const
export const TOGGLES = [
  { key: 'a', label: '결재', isOn: (b: HrBook) => b.isApproving, flip: (b: HrBook): HrBook => ({ ...b, isApproving: !b.isApproving }) },
  { key: 'r', label: '조직 개편', isOn: (b: HrBook) => b.isReorganizing, flip: (b: HrBook): HrBook => ({ ...b, isReorganizing: !b.isReorganizing }) },
  { key: 'm', label: '인사 메모', isOn: (b: HrBook) => b.isCoaching, flip: (b: HrBook): HrBook => ({ ...b, isCoaching: !b.isCoaching }) },
  { key: 't', label: '교육 효과 측정', isOn: (b: HrBook) => b.isTrialing, flip: (b: HrBook): HrBook => ({ ...b, isTrialing: !b.isTrialing }) },
  { key: 'j', label: '업무 일지 파일 저장(날마다 journal/<날짜>.md)', isOn: (b: HrBook) => b.isJournalSaving === true, flip: (b: HrBook): HrBook => ({ ...b, isJournalSaving: b.isJournalSaving !== true }) },
] as const

/** 그 화면의 내용 */
export function viewBlocks(view: string, s: Scene): Block[] {
  const b = s.book
  if (view.startsWith('card:')) {
    const who = findEmployee(b, view.slice(5))
    return who === undefined ? [{ t: 'line', text: `${view.slice(5)}라는 직원이 없습니다.` }] : cardBlocks(b, who, s.now)
  }
  if (view === 'today' || view === 'week') return reportBlocks(b, view, s.now, [...s.agents])
  if (view === 'budget') {
    const blocks = budgetBlocks(b, [...s.agents], s.now)
    return blocks.length > 0 ? blocks : [{ t: 'title', text: '부서 예산' }, { t: 'line', text: '부서 예산이 없습니다. /office budget <부서> <달러> (예: /office budget 개발팀 5)' }]
  }
  if (view === 'playbook') return playbookBlocks(b, s.now)
  if (view === 'office') return [{ t: 'title', text: '사무실' }]
  if (view === 'archive') return archiveBlocks(b)
  const jv = journalViewOf(view)
  if (jv !== null) return journalBlocks(b, s.journal ?? [], s.now, jv)
  if (view === 'settings') {
    return [{ t: 'title', text: '설정' }, { t: 'line', text: '글자를 누르면 바로 켜고 끕니다.' }, ...TOGGLES.map(x => ({ t: 'bullet', text: `${x.key}: ${x.isOn(b) ? '[켜짐]' : '[꺼짐]'} ${x.label}` } as const)),
      { t: 'gap' }, ...deptMapBlocks(b)]
  }
  return rosterBlocks(b, s.now)
}

/** 메뉴 화면 맨 위 줄(고른 메뉴는 뒤집어 보인다) */
/** 그 메뉴를 보고 있는지(일지는 journal:week·journal:<별칭>도 8) */
export const isOnView = (m: string, view: string): boolean => m === view || (m === 'journal' && view.startsWith('journal:'))
export const menuHead = (view: string): string => `${MENU.map(m => (isOnView(m.view, view) ? `\x1b[7m ${m.key} ${m.label} \x1b[0m` : ` ${m.key} ${m.label} `)).join(' ')}   \x1b[2mq 닫기\x1b[0m`

/** 메뉴 화면 줄(마크다운 부품이 없으면 글 표로) */
export function menuLines(view: string, width: number, s: Scene, markdown: ((md: string, width: number) => string[]) | null): string[] {
  return menuScreen(view, width, s, markdown, null).lines
}

/** 메뉴 화면 본문이 시작하는 줄(맨 위 메뉴 줄과 빈 줄 다음) */
const BODY_ROW = 2

/** 평면도(부르는 쪽이 프레임마다 그린 것): 그 칸 수의 줄과, 마지막 그림에서 그 칸에 있는 사람 */
export type PlanView = { lines: (columns: number) => string[]; nickAt: (col: number, row: number) => string | null }

/**
 * 누를 수 있는 메뉴 화면: 줄과, 눌린 칸(0부터, 화면 맨 위가 0줄)이 가리키는 것.
 * 맨 위 줄은 메뉴(그 화면으로), 사무실 화면의 평면도는 사람·이름표·명패, 그 밖의 줄은 그 줄에 적힌 직원(인사카드로)
 */
export function menuScreen(view: string, width: number, s: Scene, markdown: ((md: string, width: number) => string[]) | null, plan: PlanView | null, height = Infinity): { lines: string[]; targetAt: (row: number, col: number) => string | null } {
  const head = clip(menuHead(view), width)
  let body: string[]
  // 사무실 화면: 목록 줄(별칭 → 그 줄)과 그 아래 평면도(시작 줄·줄 수)
  let listNicks: (string | null)[] = []
  let planAt = 0
  let planRows = 0
  if (view === 'office') {
    const rows = rowsOf([...s.agents], s.book, s.now, width)
    const list = rows.length === 0 ? ['\x1b[2m아직 일하는 에이전트가 없습니다\x1b[0m'] : rows.map(tinted)
    listNicks = rows.length === 0 ? [null] : rows.map(r => r.nick)
    const note = '\x1b[2m목록 줄이나 평면도의 사람·이름표·책상 명패·말풍선을 누르면 그 직원의 인사카드를 엽니다(이 화면에서만)\x1b[0m'
    // 평면도는 폭이 되고, 메뉴 줄·목록·평면도가 화면 높이에 들어갈 때만
    const fits = plan !== null && width >= 72 && BODY_ROW + list.length + 2 + 27 <= height
    const shown = fits && plan !== null ? plan.lines(width) : []
    planAt = list.length + 1
    planRows = shown.length
    body = [...list, '', ...shown, ...(shown.length > 0 ? [''] : []), note]
  } else {
    const blocks = viewBlocks(view, s)
    body = markdown === null ? textOf(blocks).split('\n') : markdown(mdOf(blocks), width)
  }
  const lines = [head, '', ...body.map(l => clip(l, width))]
  const known = [...s.book.employees, ...s.book.retired].map(e => e.nick)
  const targetAt = (row: number, col: number): string | null => {
    if (row === 0) return tabAt(col)
    const r = row - BODY_ROW
    if (r < 0 || r >= body.length) return null
    if (view === 'office') {
      // 목록 줄은 그 줄의 사람(업무 설명에 다른 별칭이 적혀 있어도)
      if (r < listNicks.length) {
        const nick = listNicks[r] ?? null
        return nick === null || !known.includes(nick) ? null : cardOf(nick)
      }
      if (plan === null || r < planAt || r >= planAt + planRows) return null
      const nick = plan.nickAt(col, r - planAt)
      return nick === null || !known.includes(nick) ? null : cardOf(nick)
    }
    // 줄 누르기는 인사 명부에서만(보고·지침·기록 글 속 별칭을 눌러 뜻밖에 넘어가지 않도록): 그 줄에 직원 별칭이 낱말로 하나만 있으면 그 사람
    if (view !== 'hr') return null
    const text = plain(body[r] ?? '')
    const hits = known.filter(n => new RegExp(`(^|[^A-Z0-9])${n}([^A-Z0-9]|$)`).test(text))
    return hits.length === 1 ? cardOf(hits[0] as string) : null
  }
  return { lines, targetAt }
}

const cardOf = (nick: string): string => `card:${nick}`

/** 맨 위 메뉴 줄에서 그 칸에 있는 메뉴의 화면('q 닫기'면 'close') */
function tabAt(col: number): string | null {
  let x = 0
  for (const m of MENU) {
    const w = widthOf(` ${m.key} ${m.label} `)
    if (col >= x && col < x + w) return m.view
    x += w + 1
  }
  // 메뉴 뒤 빈칸 두 개 다음의 'q 닫기'
  const closeAt = x - 1 + 3
  return col >= closeAt && col < closeAt + widthOf('q 닫기') ? 'close' : null
}

/** 터미널 마우스 보고(SGR: ESC [ < 버튼 ; 열 ; 줄 M) 중 왼쪽 누름이면 0부터 센 칸, 아니면 null */
export function clickOf(data: string): { col: number; row: number } | null {
  const m = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])$/.exec(data)
  if (m === null) return null
  const button = Number(m[1])
  // 놓기·움직임·휠·다른 단추는 누름이 아니다
  if (m[4] !== 'M' || (button & (32 | 64)) !== 0 || (button & 3) !== 0) return null
  return { col: Number(m[2]) - 1, row: Number(m[3]) - 1 }
}

/** 마우스 보고인지(누름이 아니어도 입력창으로 흘리지 않는다) */
export const isMouseReport = (data: string): boolean => data.startsWith('\x1b[<')
