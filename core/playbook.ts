// 부서 지침(에이전트 개선). 부서별 최근 업무 기록에서 반복되는 흠을 찾아 지침 후보를 만들고(모델을 부르지 않는다),
// 대표가 승인한 지침만 그 부서의 업무 지시 인사 메모에 붙인다. 적용한 때의 부서 성적을 남겨 두고 그 뒤 성적과 견준다.
// 순수 함수만 둔다.
import type { Dept, DeptStats, HrBook, JobRecord, Playbook, PlaybookRule } from '../types'
import { DEPT_INFO, DEPTS, isMuted, MAX_PLAYBOOK_RULES, tipOf } from './hr'
import type { Block } from './table'

/** 후보를 낼 만큼 쌓였다고 보는 업무 수 */
export const MIN_JOBS = 5
/** 흠 하나가 후보가 되려면 적어도 이만큼 일어나야 한다(5건 중 1건으로 지침을 내지 않도록) */
const MIN_HITS = 2
/** 반려율을 재려면 결재된 일이 적어도 이만큼 */
const MIN_JUDGED = 4
/** 성적을 재는 최근 업무 수 */
export const WINDOW = 20
/** 부서마다 둘 수 있는 지침 수 */
export const MAX_RULES = MAX_PLAYBOOK_RULES

const rate = (n: number, of: number): number => (of === 0 ? 0 : n / of)

/** 그 부서의 업무 기록 성적 */
export function statsOf(records: readonly JobRecord[]): DeptStats {
  const n = records.length
  const judged = records.filter(r => r.approval === 'approved' || r.approval === 'rejected')
  return {
    jobs: n,
    avgScore: n === 0 ? 0 : records.reduce((s, r) => s + r.score, 0) / n,
    checkFailRate: rate(records.filter(r => r.isCheckFailed).length, n),
    reworkRate: rate(records.filter(r => r.isReworked).length, n),
    rejectRate: rate(judged.filter(r => r.approval === 'rejected').length, judged.length),
    badRate: rate(records.filter(r => r.bossRating === 'bad').length, n),
    failRate: rate(records.filter(r => r.outcome !== 'done').length, n),
  }
}

/** 최근 업무(최신이 앞) */
const recentOf = (book: HrBook, dept: Dept, since = 0): JobRecord[] => book.log.filter(r => r.dept === dept && r.endedAt > since).slice(0, WINDOW)

/** 지침 후보: 열쇠(같은 흠의 지침은 하나만), 지침 글, 근거 */
export type Proposal = { key: string; text: string; why: string }

const pct = (x: number): string => `${Math.round(x * 100)}%`

/**
 * 지침 후보: 최근 업무에서 흠이 문턱을 넘으면 그 흠을 막는 지침을, 부서가 세 번 넘게 되풀이한 실수에는 그 피하는 법을.
 * 이미 채택한 지침과 같은 열쇠는 내지 않는다
 */
export function proposalsOf(book: HrBook, dept: Dept, now: number): Proposal[] {
  const recent = recentOf(book, dept)
  if (recent.length < MIN_JOBS) return []
  const s = statsOf(recent)
  const hits = (x: number) => Math.round(x * s.jobs) >= MIN_HITS
  const judged = recent.filter(r => r.approval === 'approved' || r.approval === 'rejected').length
  const had = new Set((book.playbooks?.[dept]?.rules ?? []).map(r => r.key))
  const base = `최근 ${s.jobs}건`
  const out: Proposal[] = []
  if (s.checkFailRate >= 0.2 && hits(s.checkFailRate)) out.push({ key: 'check', text: '끝내기 전에 테스트·빌드를 돌리고, 실패하면 고치거나 실패한 채라는 것을 보고 첫 줄에 적는다', why: `${base} 중 테스트·빌드 실패한 채 끝냄 ${pct(s.checkFailRate)}` })
  if (s.reworkRate >= 0.2 && hits(s.reworkRate)) out.push({ key: 'rework', text: '고친 파일은 끝내기 전에 다시 읽어 요구와 맞는지 확인하고, 바꾼 곳과 까닭을 보고에 적는다', why: `${base} 중 끝낸 뒤 BOSS가 다시 고침 ${pct(s.reworkRate)}` })
  if (judged >= MIN_JUDGED && s.rejectRate >= 0.25 && Math.round(s.rejectRate * judged) >= MIN_HITS) out.push({ key: 'report', text: '보고에 한 일·확인한 것(돌린 명령과 결과)·남은 위험을 빠짐없이 적는다', why: `${base} 중 결재된 일의 반려 ${pct(s.rejectRate)}` })
  if (s.badRate >= 0.2 && hits(s.badRate)) out.push({ key: 'ask', text: '지시가 모호하면 시작 전에 무엇을 끝으로 볼지 한 줄로 정리하고, 그 기준으로 끝냈는지 보고한다', why: `${base} 중 대표 아쉬움 ${pct(s.badRate)}` })
  if (s.failRate >= 0.2 && hits(s.failRate)) out.push({ key: 'finish', text: '막히면 같은 방법을 되풀이하지 말고, 지금까지 한 일과 막힌 곳을 보고하고 끝낸다', why: `${base} 중 실패·중단 ${pct(s.failRate)}` })
  // 교육 효과 측정에서 효과 없다고 빼 둔 실수는 지침으로도 다시 넣지 않는다
  for (const l of book.lessons[dept] ?? []) {
    const tip = tipOf(l.pattern)
    if (l.count >= 3 && tip !== null && !isMuted(book, l, now)) out.push({ key: `lesson:${l.tool}|${l.pattern}`, text: tip, why: `${l.tool} "${l.pattern}" ${l.count}회 되풀이` })
  }
  // 같은 지침 글은 하나만
  const seen = new Set<string>()
  return out.filter(p => !had.has(p.key) && !seen.has(p.text) && seen.add(p.text))
}

/** 더 채택할 수 있는 지침 수 */
export const roomOf = (book: HrBook, dept: Dept): number => MAX_RULES - (book.playbooks?.[dept]?.rules.length ?? 0)

/**
 * 후보를 채택한다: 지침에 더하고(이미 있는 열쇠는 빼고, 자리가 모자라면 들어가는 만큼만), 적용한 때와 그때의 부서 성적(최근 업무)을 남긴다.
 * 전후 비교는 마지막으로 채택한 때를 기준으로 한다
 */
export function adopt(book: HrBook, dept: Dept, picked: readonly Proposal[], now: number): HrBook {
  const was = book.playbooks?.[dept]
  const had = new Set((was?.rules ?? []).map(r => r.key))
  const fresh = picked.filter(p => !had.has(p.key)).slice(0, Math.max(0, roomOf(book, dept)))
  if (fresh.length === 0) return book
  const rules: PlaybookRule[] = [...(was?.rules ?? []), ...fresh.map(p => ({ key: p.key, text: p.text, why: p.why, at: now }))]
  const next: Playbook = { rules, appliedAt: now, before: statsOf(recentOf(book, dept)) }
  return { ...book, playbooks: { ...book.playbooks, [dept]: next } }
}

/** 지침 하나를 뺀다(번호는 1부터). 남은 지침이 없으면 그 부서 지침을 없앤다 */
export function dropRule(book: HrBook, dept: Dept, n: number): HrBook {
  const was = book.playbooks?.[dept]
  if (was === undefined || n < 1 || n > was.rules.length) return book
  const rules = was.rules.filter((_, i) => i !== n - 1)
  const { [dept]: _gone, ...rest } = book.playbooks ?? {}
  return { ...book, playbooks: rules.length === 0 ? rest : { ...rest, [dept]: { ...was, rules } } }
}

/** 업무 지시에 붙일 부서 지침 줄. 교육 효과 측정의 비교군에는 실수에서 온 지침을 뺀다(비교군이 실수 목록을 받지 않도록) */
export const playbookLines = (book: HrBook, dept: Dept, isControl = false): string[] =>
  (book.playbooks?.[dept]?.rules ?? []).filter(r => !(isControl && r.key.startsWith('lesson:'))).map(r => r.text)

/** 적용 전과 그 뒤 성적(그 뒤 업무가 없으면 null) */
export function effectOf(book: HrBook, dept: Dept): { before: DeptStats; after: DeptStats } | null {
  const p = book.playbooks?.[dept]
  if (p === undefined || p.appliedAt === null || p.before === null) return null
  // 채택한 뒤에 시작한 일만(채택 전에 지침 없이 지시받은 일은 빼고)
  const after = book.log.filter(r => r.dept === dept && r.startedAt > (p.appliedAt ?? 0)).slice(0, WINDOW)
  return after.length === 0 ? null : { before: p.before, after: statsOf(after) }
}

/** 전후 비교 한 줄: 평균 평가 9.0 → 11.5 · 테스트 실패 완료 30% → 10% … */
export function effectLine(e: { before: DeptStats; after: DeptStats }): string {
  const parts = [
    `평균 평가 ${e.before.avgScore.toFixed(1)} → ${e.after.avgScore.toFixed(1)}`,
    `테스트 실패 완료 ${pct(e.before.checkFailRate)} → ${pct(e.after.checkFailRate)}`,
    `재작업 ${pct(e.before.reworkRate)} → ${pct(e.after.reworkRate)}`,
    `반려 ${pct(e.before.rejectRate)} → ${pct(e.after.rejectRate)}`,
    `대표 아쉬움 ${pct(e.before.badRate)} → ${pct(e.after.badRate)}`,
  ]
  return `${parts.join(' · ')} (적용 뒤 ${e.after.jobs}건${e.after.jobs < MIN_JOBS ? ', 아직 적음' : ''})`
}


/** 부서 지침 화면: 부서마다 채택한 지침(번호)·전후 비교·새 후보(번호). 볼 것이 없으면 안내 한 줄 */
export function playbookBlocks(book: HrBook, now: number): Block[] {
  const out: Block[] = [{ t: 'title', text: '부서 지침(에이전트 개선)' },
    { t: 'line', text: `최근 ${WINDOW}건의 업무 기록에서 반복되는 흠을 찾아 지침 후보를 냅니다(부서마다 ${MIN_JOBS}건 이상 쌓이면). 채택한 지침은 그 부서의 업무 지시에 붙습니다.` }]
  let any = false
  for (const d of DEPTS) {
    const rules = book.playbooks?.[d]?.rules ?? []
    const props = roomOf(book, d) > 0 ? proposalsOf(book, d, now) : []
    if (rules.length === 0 && props.length === 0) continue
    any = true
    out.push({ t: 'gap' }, { t: 'section', text: DEPT_INFO[d].ko })
    if (rules.length > 0) {
      out.push({ t: 'table', head: ['지침', '내용', '근거(채택할 때)'], rows: rules.map((r, i) => [`${i + 1}`, r.text, r.why]), align: ['r', 'l', 'l'], max: [undefined, 60, 40] })
      const e = effectOf(book, d)
      const since = book.playbooks?.[d]?.appliedAt
      out.push({ t: 'line', text: `${e === null ? '전후 비교: 적용 뒤 끝낸 업무가 아직 없습니다' : `전후 비교: ${effectLine(e)}`}${since === null || since === undefined ? '' : ' (마지막 채택 기준)'}` })
      if (roomOf(book, d) <= 0) out.push({ t: 'line', text: `지침이 ${MAX_RULES}개로 찼습니다. 더 채택하려면 먼저 빼세요.` })
    }
    if (props.length > 0) {
      out.push({ t: 'table', head: ['후보', '내용', '근거'], rows: props.map((p, i) => [`${i + 1}`, p.text, p.why]), align: ['r', 'l', 'l'], max: [undefined, 60, 40] })
      out.push({ t: 'line', text: `채택: /office playbook ${DEPT_INFO[d].ko} adopt <후보 번호|all>` })
    }
  }
  if (!any) out.push({ t: 'line', text: '아직 낼 후보가 없습니다(흠이 문턱을 넘은 부서가 없거나 업무가 덜 쌓였습니다).' })
  else out.push({ t: 'gap' }, { t: 'line', text: '빼기: /office playbook <부서> drop <지침 번호>' })
  return out
}

// ── 새 후보 알림: 새로 오른 후보는 한 번 알리고, 대표가 지침 화면을 볼 때까지 사무실 화면에 알림 줄을 둔다 ─────

/** 부서마다 지금 후보. 지침이 꽉 찬 부서는 null(후보를 내지 않을 뿐 사라진 것이 아니니, 알린 목록·본 목록을 그대로 둔다) */
const nowOf = (book: HrBook, now: number): [Dept, Proposal[] | null][] => DEPTS.map(d => [d, roomOf(book, d) > 0 ? proposalsOf(book, d, now) : null])

/** 열쇠 목록이 같은지 */
const sameKeys = (a: readonly string[] | undefined, b: readonly string[]): boolean => (a ?? []).length === b.length && b.every(k => (a ?? []).includes(k))

/** 부서 → 열쇠 표를 고친다(빈 목록은 빼고, 다 비면 칸째 없앤다). 바뀐 것이 없으면 같은 기록 */
function setKeys(book: HrBook, field: 'proposalsTold' | 'proposalsSeen', next: (d: Dept, was: string[] | undefined) => string[] | undefined): HrBook {
  const out: Partial<Record<Dept, string[]>> = {}
  let isChanged = false
  for (const d of DEPTS) {
    const was = book[field]?.[d]
    const keys = next(d, was) ?? was
    if (keys !== undefined && keys.length > 0) out[d] = keys
    if (!sameKeys(was, keys ?? [])) isChanged = true
  }
  if (!isChanged) return book
  const { [field]: _old, ...rest } = book
  return Object.keys(out).length === 0 ? rest : { ...rest, [field]: out }
}

/**
 * 아직 알리지 않은 새 후보를 고르고, 알린 것으로 적는다. 사라진 후보는 알린 목록과 본 목록에서 함께 빼(나중에 다시 오르면
 * 다시 알리고 알림 줄도 다시 뜬다). 지침이 꽉 찬 부서는 건드리지 않는다. 바뀐 것이 없으면 같은 기록을 돌려준다(저장하지 않도록)
 */
export function tellProposals(book: HrBook, now: number): { book: HrBook; fresh: { dept: Dept; p: Proposal }[] } {
  const current = new Map(nowOf(book, now))
  const fresh: { dept: Dept; p: Proposal }[] = []
  for (const [d, props] of current) for (const p of props ?? []) if (!(book.proposalsTold?.[d] ?? []).includes(p.key)) fresh.push({ dept: d, p })
  const keysOf = (d: Dept) => current.get(d)?.map(p => p.key)
  const told = setKeys(book, 'proposalsTold', keysOf)
  const pruned = setKeys(told, 'proposalsSeen', (d, was) => {
    const keys = keysOf(d)
    return keys === undefined ? undefined : (was ?? []).filter(k => keys.includes(k))
  })
  return { book: pruned, fresh }
}

/** 지침 화면을 봤다: 지금 후보를 모두(only를 주면 그 부서만) 본 것(알린 것)으로 적는다. 바뀐 것이 없으면 같은 기록 */
export function markSeen(book: HrBook, now: number, only?: Dept): HrBook {
  const current = new Map(nowOf(book, now))
  const keysOf = (d: Dept) => (only === undefined || d === only ? current.get(d)?.map(p => p.key) : undefined)
  return setKeys(setKeys(book, 'proposalsTold', keysOf), 'proposalsSeen', keysOf)
}

/** 대표가 그 부서의 지침을 채택·뺐다: 그 결과로 그 부서에 드러난 후보는 대표가 이미 보고 있으니 조용히 알린 것·본 것으로 적는다(다른 부서는 그대로) */
export const settled = (book: HrBook, dept: Dept, now: number): HrBook => markSeen(book, now, dept)

/** 대표가 아직 지침 화면에서 보지 못한 후보(부서별 수) */
export function unseenOf(book: HrBook, now: number): { dept: Dept; count: number }[] {
  return nowOf(book, now).flatMap(([d, props]) => {
    const n = (props ?? []).filter(p => !(book.proposalsSeen?.[d] ?? []).includes(p.key)).length
    return n === 0 ? [] : [{ dept: d, count: n }]
  })
}

/** 사무실 화면의 알림 줄(못 본 후보가 없으면 null). 좁은 화면에는 짧게 */
export function proposalAlert(book: HrBook, now: number, isShort = false): string | null {
  const unseen = unseenOf(book, now)
  if (unseen.length === 0) return null
  const total = unseen.reduce((s, u) => s + u.count, 0)
  return isShort ? `새 지침 후보 ${total}건 — 메뉴 6` : `새 지침 후보 ${total}건(${unseen.map(u => `${DEPT_INFO[u.dept].ko} ${u.count}`).join(' · ')}) — 메뉴 6 지침에서 채택하거나 넘기세요`
}

/** 새 후보의 알림 글(토스트·메신저): 부서마다 한 줄로 묶는다(쌓여 있던 후보가 한꺼번에 올라도 알림이 쏟아지지 않도록) */
export function proposalNotices(fresh: readonly { dept: Dept; p: Proposal }[]): string[] {
  return DEPTS.flatMap(d => {
    const mine = fresh.filter(f => f.dept === d).map(f => f.p)
    const first = mine[0]
    if (first === undefined) return []
    return [mine.length === 1
      ? `${DEPT_INFO[d].ko} 지침 후보: ${first.text} (근거: ${first.why}). 메뉴 6 지침에서 채택`
      : `${DEPT_INFO[d].ko} 지침 후보 ${mine.length}건: ${first.text} 외 ${mine.length - 1}건. 메뉴 6 지침에서 채택`]
  })
}
