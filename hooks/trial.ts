// 교육 효과 측정. 인사 메모에 붙이는 "반복한 실수"가 정말 재발을 줄이는지 본다.
// 붙일 실수가 있는 업무 중 몇 건에 한 건은 실수 목록을 빼고 보내(비교군), 일하는 동안 그 실수가 다시 났는지를
// 실수마다 메모군·비교군으로 나눠 센다. 근거가 충분히 모였는데 메모를 붙여도 재발이 줄지 않으면 효과 없음으로 보고
// 한동안 메모에서 뺐다가, 시간이 지나면 처음부터 다시 잰다. 순수 함수만 둔다.
import type { HrBook, TrialArm, TrialStats, TrialTicket } from '../types'
import { patternOf, RETEST_MS } from './hr'

/** 실험에 넣을 업무 몇 건에 한 건을 비교군으로 둔다 */
export const CONTROL_EVERY = 5
/** 판정에 필요한 최소 표본: 메모군·비교군 업무 수 */
export const MIN_MEMO = 10
export const MIN_CONTROL = 5
/** 비교군에서 이만큼은 재발해야 판정한다(재발이 드물면 비교할 거리가 없다) */
export const MIN_CONTROL_HITS = 2
/** 실험 기록은 최근 것 50개까지 */
const MAX_TRIALS = 50

/** 도구 오류 하나의 열쇠: 교훈과 같은 방식으로 다듬는다 */
export const errorLessonKey = (tool: string, text: string): string => `${tool}|${patternOf(text)}`

/**
 * 이번 업무를 어느 쪽에 넣을지 정한다. 붙일 실수가 없거나 실험이 꺼져 있으면 실험하지 않는다(null).
 * 순번으로 고른다: 무작위보다 고르고, 같은 기록이면 늘 같은 결과가 나온다.
 */
export function enroll(book: HrBook, keys: readonly string[]): { book: HrBook; arm: TrialArm } | null {
  if (!book.isTrialing || keys.length === 0) return null
  const seq = book.trialSeq + 1
  return { book: { ...book, trialSeq: seq }, arm: seq % CONTROL_EVERY === 0 ? 'control' : 'memo' }
}

/** 일하는 동안 난 오류가 실험 중인 실수면 재발로 적는다 */
export const markHit = (ticket: TrialTicket, key: string): TrialTicket =>
  ticket.keys.includes(key) && !ticket.hits.includes(key) ? { ...ticket, hits: [...ticket.hits, key] } : ticket

const rate = (s: { jobs: number; hits: number }): number => (s.jobs === 0 ? 0 : s.hits / s.jobs)

export type Verdict = 'effective' | 'ineffective' | 'unknown'

/**
 * 효과 판정. 메모군·비교군 표본이 모이고 비교군에서 재발이 충분히 나야 가른다.
 * 그 전이나 둘 다 재발이 없을 때는 모른다(드문 실수를 근거 없이 빼지 않도록).
 */
export function verdictOf(s: TrialStats | undefined): Verdict {
  if (s === undefined || s.memo.jobs < MIN_MEMO || s.control.jobs < MIN_CONTROL || s.control.hits < MIN_CONTROL_HITS) return 'unknown'
  return rate(s.memo) < rate(s.control) ? 'effective' : 'ineffective'
}

const fresh = (now: number): TrialStats => ({ memo: { jobs: 0, hits: 0 }, control: { jobs: 0, hits: 0 }, lastAt: now })

/**
 * 끝난 업무 하나를 실수별 실험 기록에 더한다. 효과 없음으로 판정되면 그때를 적어 두고(한동안 메모에서 빠진다),
 * 다시 잴 때가 지난 기록은 처음부터 다시 센다.
 */
export function settle(book: HrBook, ticket: TrialTicket, now: number): HrBook {
  const trials = { ...book.trials }
  for (const key of ticket.keys) {
    const had = trials[key]
    const base = had === undefined || (had.ineffectiveAt !== undefined && now - had.ineffectiveAt >= RETEST_MS) ? fresh(now) : had
    const arm = base[ticket.arm]
    const next: TrialStats = { ...base, [ticket.arm]: { jobs: arm.jobs + 1, hits: arm.hits + (ticket.hits.includes(key) ? 1 : 0) }, lastAt: now }
    const { ineffectiveAt: _drop, ...rest } = next
    trials[key] = verdictOf(next) === 'ineffective' ? { ...rest, ineffectiveAt: base.ineffectiveAt ?? now } : rest
  }
  const kept = Object.entries(trials).sort(([, a], [, b]) => b.lastAt - a.lastAt).slice(0, MAX_TRIALS)
  return { ...book, trials: Object.fromEntries(kept) }
}

const pct = (s: { jobs: number; hits: number }): string => `${s.jobs}건 중 재발 ${s.hits}(${Math.round(rate(s) * 100)}%)`

/** /office hr에 보일 효과 한 줄(실험한 적 없으면 빈 문자열) */
export function effectText(s: TrialStats | undefined, isMuted: boolean): string {
  if (s === undefined) return ''
  const v = verdictOf(s)
  const word = v === 'effective' ? '효과 있음' : v === 'ineffective' ? (isMuted ? '효과 없음(2주 동안 메모에서 뺀 뒤 다시 잼)' : '효과 없음') : '측정 중'
  return ` · ${word}: 메모 ${pct(s.memo)} / 비교군 ${pct(s.control)}`
}
