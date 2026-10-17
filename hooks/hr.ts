// 인사 제도. 에이전트 종류로 부서를 정하고, 같은 부서 직원(별칭)이 일을 맡을 때마다 경력이 쌓인다.
// 평가는 실제 기록(완료·실패·도구 오류·거절)으로만 매기고, 부서가 반복한 실수는 "교훈"으로 모아
// 다음에 그 부서 직원이 일을 맡을 때 업무 지시 끝에 짧은 인사 메모로 붙인다. 순수 함수만 둔다.
import type { Dept, Employee, Handoff, HrBook, Lesson } from '../types'

export const DEPTS: Dept[] = ['dev', 'research', 'qa', 'plan', 'docs', 'ops']

export const DEPT_INFO: Record<Dept, { ko: string; en: string; color: number }> = {
  dev: { ko: '개발팀', en: 'DEV', color: 0x5c7cfa },
  research: { ko: '조사팀', en: 'RESEARCH', color: 0x20c997 },
  qa: { ko: '품질팀', en: 'QA', color: 0xff6b6b },
  plan: { ko: '기획팀', en: 'PLANNING', color: 0xfcc419 },
  docs: { ko: '문서팀', en: 'DOCS', color: 0xcc5de8 },
  ops: { ko: '지원팀', en: 'OPS', color: 0xadb5bd },
}

const DEPT_OF: Record<string, Dept> = {
  builder: 'dev', executor: 'dev', 'general-purpose': 'dev', debugger: 'dev', 'code-simplifier': 'dev',
  'test-engineer': 'dev', designer: 'dev', fork: 'dev',
  explore: 'research', 'document-specialist': 'research', scientist: 'research', tracer: 'research',
  'claude-code-guide': 'research', research: 'research',
  reviewer: 'qa', 'code-reviewer': 'qa', verifier: 'qa', critic: 'qa', 'security-reviewer': 'qa', 'qa-tester': 'qa',
  plan: 'plan', planner: 'plan', architect: 'plan', analyst: 'plan',
  writer: 'docs',
}

/** 'oh-my-claudecode:executor' → 'dev' */
export const deptOf = (type: string): Dept => DEPT_OF[(type.split(':').pop() ?? type).toLowerCase()] ?? 'ops'

export const RANKS = [
  { ko: '사원', xp: 0, salary: 3600 },
  { ko: '대리', xp: 20, salary: 4200 },
  { ko: '과장', xp: 60, salary: 5000 },
  { ko: '차장', xp: 120, salary: 6000 },
  { ko: '부장', xp: 200, salary: 7200 },
] as const

export const rankOf = (xp: number) => [...RANKS].reverse().find(r => xp >= r.xp) ?? RANKS[0]

/** 부서 팀장: 일을 한 번이라도 한 직원 중 경력(xp)이 가장 높은 사람 */
export const leadOf = (book: HrBook, dept: Dept): Employee | undefined =>
  book.employees.filter(e => e.dept === dept && e.jobs > 0).sort((a, b) => b.xp - a.xp || a.hiredAt - b.hiredAt)[0]

/** 연봉(만원): 직급 기본급 + 최근 평가 성과급 + 팀장 수당 */
export const salaryOf = (book: HrBook, e: Employee): number => {
  const bonus = Math.max(0, Math.round((e.avgScore ?? 0) * 60))
  const lead = leadOf(book, e.dept)?.nick === e.nick ? 600 : 0
  return rankOf(e.xp).salary + bonus + lead
}

export type JobResult = {
  isDone: boolean
  isKilled: boolean
  errors: number
  /** 부른 도구 수(없으면 일을 안 한 것으로 보고 무오류 가산을 주지 않는다) */
  tools?: number
  /** 마지막 Bash(테스트·빌드)가 실패한 채 끝냈는지 */
  isCheckFailed?: boolean
}

/** 실패한 테스트·빌드를 두고 완료하면, 끝낸 뒤 BOSS가 같은 파일을 다시 고치면 깎는 점수 */
export const CHECK_PENALTY = 4
export const REWORK_PENALTY = 4

/**
 * 한 건의 평가 점수: 완료 10, 실패 -5(중단 -3), 도구 오류 1개당 -1(최대 -5),
 * 도구를 써서 오류 없이 완료하면 +3, 마지막 테스트·빌드가 실패한 채 완료하면 -4
 */
export const scoreOf = (r: JobResult): number => {
  const base = r.isDone ? 10 : r.isKilled ? -3 : -5
  const isClean = r.isDone && r.errors === 0 && (r.tools ?? 1) > 0 && r.isCheckFailed !== true
  return base - Math.min(5, r.errors) + (isClean ? 3 : 0) - (r.isDone && r.isCheckFailed === true ? CHECK_PENALTY : 0)
}

export const gradeOf = (score: number): string => (score >= 13 ? 'S' : score >= 10 ? 'A' : score >= 6 ? 'B' : score >= 0 ? 'C' : 'D')

export const emptyBook = (): HrBook => ({ version: 2, employees: [], lessons: {}, handoffs: [], isCoaching: true })

/**
 * 저장된 인사 기록을 지금 형식으로 옮긴다. 예전 판(version 1)이나 모르는 판이라도 직원 명부가 있으면
 * 빠진 칸만 채워 살린다(기록을 비우지 않는다). 명부가 없으면 null.
 */
export function migrate(stored: unknown): HrBook | null {
  if (typeof stored !== 'object' || stored === null) return null
  const v = stored as Record<string, unknown>
  if (!Array.isArray(v.employees)) return null
  const num = (x: unknown, or: number): number => (typeof x === 'number' && Number.isFinite(x) ? x : or)
  const numOrNull = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null)
  const isDept = (x: unknown): x is Dept => DEPTS.includes(x as Dept)
  const employees = (v.employees as Record<string, unknown>[])
    .filter(e => typeof e === 'object' && e !== null && typeof e.nick === 'string')
    .map((e): Employee => ({
      // 더 새로운 판이 둔 칸은 그대로 남긴다
      ...(e as object),
      nick: e.nick as string, dept: isDept(e.dept) ? e.dept : 'ops', type: typeof e.type === 'string' ? e.type : 'agent',
      xp: num(e.xp, 0), jobs: num(e.jobs, 0), done: num(e.done, 0), failed: num(e.failed, 0), toolErrors: num(e.toolErrors, 0),
      reworks: num(e.reworks, 0), avgScore: numOrNull(e.avgScore), lastScore: numOrNull(e.lastScore), hiredAt: num(e.hiredAt, 0), lastAt: numOrNull(e.lastAt),
    }))
  const rawLessons = typeof v.lessons === 'object' && v.lessons !== null ? v.lessons as Record<string, unknown> : {}
  const lessons: HrBook['lessons'] = {}
  for (const d of DEPTS) {
    const list = rawLessons[d]
    if (!Array.isArray(list)) continue
    lessons[d] = list.filter((l): l is Lesson => typeof l?.tool === 'string' && typeof l.pattern === 'string' && typeof l.count === 'number' && typeof l.lastAt === 'number')
  }
  const handoffs = (Array.isArray(v.handoffs) ? v.handoffs : []).filter((x): x is Handoff =>
    typeof x?.agentId === 'string' && typeof x.nick === 'string' && Array.isArray(x.files) && typeof x.endedAt === 'number' && typeof x.job === 'number')
  return { ...v, version: 2, employees, lessons, handoffs, isCoaching: v.isCoaching !== false }
}

/** 최근 평가 가중 평균: 최근 일이 30%를 차지한다 */
const EWMA = 0.3
const blend = (avg: number | null, score: number): number => (avg === null ? score : avg * (1 - EWMA) + score * EWMA)

type Moved = { book: HrBook; promotedTo: string | null; demotedTo: string | null }

/** 한 직원의 경력·평가를 고치고, 직급이 바뀌었으면 알려 준다(경력은 깎이면 강등된다) */
function adjust(book: HrBook, nick: string, fn: (e: Employee) => Employee): Moved {
  let promotedTo: string | null = null
  let demotedTo: string | null = null
  const employees = book.employees.map(e => {
    if (e.nick !== nick) return e
    const next = fn(e)
    const before = rankOf(e.xp)
    const after = rankOf(next.xp)
    if (after.xp > before.xp) promotedTo = after.ko
    if (after.xp < before.xp) demotedTo = after.ko
    return next
  })
  return { book: { ...book, employees }, promotedTo, demotedTo }
}

/** 일 한 건을 인사 기록에 반영하고, 승진·강등했으면 새 직급을 돌려준다 */
export function review(book: HrBook, nick: string, r: JobResult, now: number): Moved & { score: number } {
  const score = scoreOf(r)
  const moved = adjust(book, nick, e => ({
    ...e, xp: Math.max(0, e.xp + score), jobs: e.jobs + 1, lastAt: now, lastScore: score, avgScore: blend(e.avgScore, score),
    done: e.done + (r.isDone ? 1 : 0), failed: e.failed + (r.isDone ? 0 : 1), toolErrors: e.toolErrors + r.errors,
  }))
  return { ...moved, score }
}

// ── 재작업: 끝낸 일의 파일을 BOSS가 곧 다시 고치면 그 직원의 평가를 깎는다 ─────

/** 끝낸 뒤 이 시간 안에 BOSS가 같은 파일을 고치면 재작업 */
export const REWORK_MS = 10 * 60_000

/** 끝낸 일의 파일을 남긴다(최근 20건) */
export function handOff(book: HrBook, h: Handoff): HrBook {
  if (h.files.length === 0) return book
  return { ...book, handoffs: [h, ...book.handoffs.filter(x => x.agentId !== h.agentId)].slice(0, 20) }
}

/**
 * BOSS가 파일을 고쳤다: 최근 끝낸 일 중 그 파일을 고친 것이 있으면 재작업으로 깎는다.
 * 한 일은 한 번만 깎고, 오래된 인계 기록은 버린다.
 */
export function rework(book: HrBook, file: string, now: number): Moved & { nick: string | null } {
  const live = book.handoffs.filter(h => now - h.endedAt <= REWORK_MS)
  const hit = live.find(h => h.files.includes(file))
  const kept = { ...book, handoffs: live.filter(h => h !== hit) }
  if (hit === undefined) return { book: kept, promotedTo: null, demotedTo: null, nick: null }
  if (!kept.employees.some(e => e.nick === hit.nick)) return { book: kept, promotedTo: null, demotedTo: null, nick: null }
  const moved = adjust(kept, hit.nick, e => {
    // 그 일 뒤에 일을 더 했으면 그만큼 평균 속 그 일의 무게가 줄었다
    const later = Math.max(0, e.jobs - hit.job)
    const isLatest = later === 0
    return {
      ...e, xp: Math.max(0, e.xp - REWORK_PENALTY), reworks: e.reworks + 1,
      lastScore: isLatest && e.lastScore !== null ? e.lastScore - REWORK_PENALTY : e.lastScore,
      avgScore: e.avgScore === null ? null : e.avgScore - REWORK_PENALTY * EWMA * (1 - EWMA) ** later,
    }
  })
  return { ...moved, nick: hit.nick }
}

/**
 * 일을 맡길 직원: 그 부서에서 지금 일하지 않는 직원 중 경력이 가장 높은 사람.
 * 없으면 새로 뽑는다(별칭은 hire가 정한다).
 */
export function assign(book: HrBook, dept: Dept, busy: ReadonlySet<string>): Employee | undefined {
  return book.employees.filter(e => e.dept === dept && !busy.has(e.nick)).sort((a, b) => b.xp - a.xp || a.hiredAt - b.hiredAt)[0]
}

export function hire(book: HrBook, nick: string, dept: Dept, type: string, now: number): { book: HrBook; employee: Employee } {
  const employee: Employee = { nick, dept, type, xp: 0, jobs: 0, done: 0, failed: 0, toolErrors: 0, reworks: 0, avgScore: null, lastScore: null, hiredAt: now, lastAt: null }
  return { book: { ...book, employees: [...book.employees, employee] }, employee }
}

// ── 교훈: 도구 오류 문구를 모아 다음 업무 지시에 붙인다 ─────────────

const TIPS: [RegExp, string][] = [
  [/string to replace not found|old_string/i, 'Edit 전에 바꿀 부분을 Read로 다시 읽어 원문을 그대로 옮긴다'],
  [/has not been read|read it first|must read/i, 'Edit·Write 전에 그 파일을 먼저 Read한다'],
  [/modified since|changed on disk/i, '파일이 바뀌었으니 다시 Read한 뒤 고친다'],
  [/found \d+ matches|not unique|multiple matches/i, 'Edit의 old_string을 주변 줄까지 넣어 하나로 좁힌다'],
  [/no matches found/i, 'zsh 글롭은 따옴표로 감싸거나 일치 없음에 대비한다'],
  [/command not found/i, '명령 경로를 확인하고(node_modules/.bin 등) 그 경로로 부른다'],
  [/timed out|timeout/i, '오래 걸리는 명령은 범위를 줄이거나 백그라운드로 돌린다'],
  [/enoent|no such file|does not exist/i, '경로를 Glob·ls로 먼저 확인한다'],
  [/denied|not allowed|blocked|refus/i, '막힌 명령은 같은 방식으로 다시 시도하지 말고 다른 길을 찾거나 보고한다'],
  [/exit code [1-9]|failed/i, '명령이 실패하면 출력의 마지막 줄을 읽고 원인부터 고친다'],
]

/** 오류 문구를 같은 종류끼리 묶을 수 있게 다듬는다(경로·숫자·따옴표 안 내용 제거) */
export const patternOf = (text: string): string =>
  (text.split('\n').find(l => l.trim() !== '') ?? '')
    .replace(/(\/[\w.@-]+)+/g, '<경로>')
    .replace(/(["'`]).*?\1/g, '"…"')
    .replace(/\d+/g, '#')
    .trim()
    .slice(0, 80)

export const tipOf = (pattern: string): string | null => TIPS.find(([re]) => re.test(pattern))?.[1] ?? null

const MAX_LESSONS = 8
/** 이 기간 동안 다시 나지 않은 실수는 업무 지시 메모에 붙이지 않는다 */
export const LESSON_TTL_MS = 14 * 24 * 60 * 60_000

/**
 * 부서의 교훈에 오류 하나를 더한다(같은 도구·문구면 횟수만). 부서마다 8개까지 두고,
 * 넘치면 가장 오래 안 난 것을 버린다: 횟수로 자르면 자주 난 옛 실수가 자리를 막아 새 실수를 영영 못 배운다.
 */
export function learn(book: HrBook, dept: Dept, tool: string, text: string, now: number): HrBook {
  const pattern = patternOf(text)
  if (pattern === '') return book
  const list = book.lessons[dept] ?? []
  const had = list.find(l => l.tool === tool && l.pattern === pattern)
  const next: Lesson[] = had === undefined
    ? [...list, { tool, pattern, count: 1, lastAt: now }]
    : list.map(l => (l === had ? { ...l, count: l.count + 1, lastAt: now } : l))
  const kept = [...next].sort((a, b) => b.lastAt - a.lastAt).slice(0, MAX_LESSONS)
  kept.sort((a, b) => b.count - a.count || b.lastAt - a.lastAt)
  return { ...book, lessons: { ...book.lessons, [dept]: kept } }
}

/**
 * 업무 지시 끝에 붙일 인사 메모(짧게). 코칭이 꺼져 있으면 null.
 * 실수는 최근에 난 것부터 붙이고, now를 주면 2주 넘게 안 난 것은 뺀다.
 */
export function briefOf(book: HrBook, e: Employee, now?: number): string | null {
  if (!book.isCoaching) return null
  const dept = DEPT_INFO[e.dept]
  const lead = leadOf(book, e.dept)
  const rank = rankOf(e.xp).ko
  const lines = [
    '[사내 인사 메모 · agent-office]',
    `담당: ${dept.ko} ${e.nick} ${rank}${lead !== undefined && lead.nick !== e.nick ? ` (팀장 ${lead.nick} ${rankOf(lead.xp).ko})` : lead?.nick === e.nick ? ' · 팀장' : ''}.` +
      (e.jobs > 0 ? ` 지난 기록: 완료 ${e.done} · 실패 ${e.failed} · 도구 오류 ${e.toolErrors}${e.reworks > 0 ? ` · 재작업 ${e.reworks}` : ''}, 최근 평가 ${gradeOf(e.lastScore ?? 0)}.` : ' 첫 업무입니다.'),
  ]
  const lessons = (book.lessons[e.dept] ?? [])
    .filter(l => l.count >= 2 && (now === undefined || now - l.lastAt <= LESSON_TTL_MS))
    .sort((a, b) => b.lastAt - a.lastAt)
    .slice(0, 3)
  if (lessons.length > 0) {
    lines.push(`${dept.ko}이 최근 반복한 실수입니다. 이번에는 피하세요:`)
    for (const l of lessons) {
      const tip = tipOf(l.pattern)
      lines.push(`- ${l.tool} "${l.pattern}" ${l.count}회${tip === null ? '' : ` → ${tip}`}`)
    }
  }
  lines.push('평가 기준: 맡은 일을 끝까지 완료할 것, 도구 오류를 줄일 것, 실패한 테스트·빌드를 두고 끝내지 말 것. 끝낼 때 한 일·확인한 것·남은 위험을 짧게 보고할 것.')
  return lines.join('\n')
}
