// 부서 예산. 부서마다 하루(최근 24시간) 비용 한도를 두고, 넘으면 하루에 한 번 알린다. 비용은 모델 API 정가로 어림한 달러로,
// 끝낸 일의 기록(일한 것과 그 일의 결재)과 지금 일하는 사람이 쓴 것을 더한다. 순수 함수만 둔다.
import type { Dept, HrBook, OfficeAgent } from '../types'
import { textOf } from './table'
import type { Block } from './table'
import { DEPT_INFO, DEPTS } from './hr'
import { usdText } from './tokens'

/** 예산을 재는 기간: 최근 24시간(보고서의 "오늘"과 같다) */
export const BUDGET_MS = 24 * 60 * 60_000

/** "개발팀", "개발", "dev", "DEV" → 부서 */
export function deptNamed(name: string): Dept | null {
  const n = name.trim().toLowerCase()
  return DEPTS.find(d => d === n || DEPT_INFO[d].en.toLowerCase() === n || DEPT_INFO[d].ko === name.trim() || DEPT_INFO[d].ko.replace(/팀$/, '') === name.trim()) ?? null
}

/** "$5", "5", "2.5" → 달러(0보다 커야 한다). 그 밖의 꼴(1e3, 0x10, 음수)은 null */
export function dollarsOf(text: string): number | null {
  const m = /^\$?(\d+(?:\.\d+)?)$/.exec(text.trim())
  const n = m === null ? 0 : Number(m[1])
  return n > 0 ? n : null
}

/** 그 부서가 최근 24시간에 쓴 비용: 끝낸 일(일한 것 + 그 일의 결재) + 지금 일하는 사람이 쓴 것 */
export function spentOf(book: HrBook, agents: readonly OfficeAgent[], dept: Dept, now: number): number {
  const done = book.log.filter(r => r.dept === dept && now - r.endedAt <= BUDGET_MS && r.endedAt <= now)
    .reduce((s, r) => s + (r.tokens?.usd ?? 0) + (r.reviewTokens?.usd ?? 0), 0)
  const running = agents.filter(a => a.id !== 'main' && a.dept === dept && a.endedAt === null).reduce((s, a) => s + (a.tokens?.usd ?? 0), 0)
  return done + running
}

export type Overrun = { dept: Dept; spent: number; budget: number }

/** 예산을 넘었는데 최근 24시간 안에 알리지 않은 부서 */
export function overrunsOf(book: HrBook, agents: readonly OfficeAgent[], now: number): Overrun[] {
  return DEPTS.flatMap(dept => {
    const budget = book.budgets[dept]
    if (budget === undefined) return []
    const at = book.budgetNotices[dept]
    if (at !== undefined && now - at <= BUDGET_MS) return []
    const spent = spentOf(book, agents, dept, now)
    return spent >= budget ? [{ dept, spent, budget }] : []
  })
}

/** 알렸다고 적는다(같은 부서는 24시간 동안 다시 알리지 않는다) */
export const noticed = (book: HrBook, depts: readonly Dept[], now: number): HrBook =>
  depts.length === 0 ? book : { ...book, budgetNotices: { ...book.budgetNotices, ...Object.fromEntries(depts.map(d => [d, now])) } }

/** 예산 초과 알림 한 줄 */
export const overrunText = (o: Overrun): string =>
  `${DEPT_INFO[o.dept].ko} 하루 예산 초과: 최근 24시간 ${usdText(o.spent)} / 예산 ${usdText(o.budget)}(${Math.round((o.spent / o.budget) * 100)}%)`

/** 부서별 예산 현황(예산을 둔 부서만, 없으면 빈 목록) */
export function budgetBlocks(book: HrBook, agents: readonly OfficeAgent[], now: number): Block[] {
  const set = DEPTS.filter(d => book.budgets[d] !== undefined)
  if (set.length === 0) return []
  return [
    { t: 'section', text: '하루 예산(최근 24시간, API 정가로 어림)' },
    { t: 'table', head: ['부서', '쓴 비용', '예산', '비율', '상태'], align: ['l', 'r', 'r', 'r', 'l'], rows: set.map(d => {
      const budget = book.budgets[d] as number
      const spent = spentOf(book, agents, d, now)
      return [DEPT_INFO[d].ko, usdText(spent), usdText(budget), `${Math.round((spent / budget) * 100)}%`, spent >= budget ? '초과' : '']
    }) },
  ]
}

/** 부서별 예산 현황 줄(글) */
export const budgetLines = (book: HrBook, agents: readonly OfficeAgent[], now: number): string[] => {
  const blocks = budgetBlocks(book, agents, now)
  return blocks.length === 0 ? [] : textOf(blocks).split('\n')
}

// ── 예산 조치: 한도를 넘은 부서에 새 일을 맡길 때 대표에게 묻는다(계속 / 이번만 / 중단) ─────

/** 확인 창의 고를 것 */
export const BUDGET_CHOICES = {
  go: '계속 맡기기(오늘은 다시 묻지 않음)',
  once: '이번만 맡기기',
  stop: '맡기지 않기',
} as const
export type BudgetChoice = keyof typeof BUDGET_CHOICES

/** 고른 글 → 무엇을 골랐는지. 모르는 글(직접 쓴 답)이나 답이 없으면 맡기지 않는다 */
export const choiceOf = (label: string | undefined): BudgetChoice =>
  label === BUDGET_CHOICES.go ? 'go' : label === BUDGET_CHOICES.once ? 'once' : 'stop'

/** 새 일을 맡기기 전에 물어야 하는 초과: 예산을 넘었고, 최근 24시간 안에 "계속"으로 넘기지 않은 부서면 그 초과, 아니면 null */
export function gateOf(book: HrBook, agents: readonly OfficeAgent[], dept: Dept, now: number): Overrun | null {
  const budget = book.budgets[dept]
  if (budget === undefined) return null
  const at = book.budgetWaivers?.[dept]
  if (at !== undefined && now - at <= BUDGET_MS) return null
  const spent = spentOf(book, agents, dept, now)
  return spent >= budget ? { dept, spent, budget } : null
}

/** "계속"을 골랐다: 24시간 동안 그 부서에 새 일을 맡길 때 다시 묻지 않는다 */
export const waive = (book: HrBook, dept: Dept, now: number): HrBook => ({ ...book, budgetWaivers: { ...book.budgetWaivers, [dept]: now } })

/** 그 부서의 "계속"을 지운다(한도를 바꾸거나 없앨 때) */
export function unwaive(book: HrBook, dept: Dept): HrBook {
  const { [dept]: _was, ...rest } = book.budgetWaivers ?? {}
  const { budgetWaivers: _old, ...others } = book
  return Object.keys(rest).length === 0 ? others : { ...others, budgetWaivers: rest }
}

/** 확인 창의 질문 */
export const budgetQuestion = (o: Overrun, what: string): string =>
  `${overrunText(o)}입니다. ${DEPT_INFO[o.dept].ko}에 새 일(${what || '설명 없음'})을 맡길까요?`

/** 맡기지 않을 때 일을 띄운 쪽(모델)이 받는 글 */
export const budgetDenyText = (o: Overrun): string =>
  `agent-office: ${overrunText(o)}이라 대표가 ${DEPT_INFO[o.dept].ko}에 새 일을 맡기지 않았습니다. 이 일은 서브에이전트 없이 하거나, 대표에게 예산을 물어보세요.`
