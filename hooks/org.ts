// 조직 운영. 쌓인 기록을 결정에 쓴다: 결재가 맞았는지 재고(후속 수정으로), 일을 맡길 적임자를 고르고(비슷한 일의 실적),
// 계속 성과가 나쁘거나 오래 일이 없는 직원을 내보낸다(조직 개편). 순수 함수만 둔다.
import type { Dept, Employee, HrBook, JobRecord, Retiree } from '../types'
import { DEPT_INFO, gradeOf, MAX_RETIRED, rankOf, REWORK_MS } from './hr'
import { koNick } from './scene'

// ── 결재 정확도: 끝낸 일의 파일을 곧 다른 사람이 고쳤는지로 잰다 ─────────────

/** 끝낸 뒤 이 시간 안에 다른 사람이 같은 파일을 고치면 후속 수정(재작업 판정과 같은 시간) */
export const FOLLOW_MS = REWORK_MS

/**
 * 끝낸 일의 파일을 다른 사람(BOSS나 다른 직원)이 곧 고쳤다: 그 일 기록에 후속 수정을 적는다.
 * byNick은 고친 사람의 별칭(BOSS 포함). 같은 직원이 다음 일에서 제 파일을 더 고친 것은 세지 않는다.
 */
export function followUp(book: HrBook, file: string, byNick: string, now: number): HrBook {
  const hits = book.handoffs.filter(h => now - h.endedAt <= FOLLOW_MS && h.nick !== byNick && h.files.includes(file))
  if (hits.length === 0) return book
  const isHit = (r: JobRecord) => r.isFollowedUp !== true && hits.some(h => h.nick === r.nick && h.job === r.job)
  if (!book.log.some(isHit)) return book
  return { ...book, log: book.log.map(r => (isHit(r) ? { ...r, isFollowedUp: true } : r)) }
}

/** 결재 한 건의 판정: 맞은 승인·놓친 승인(승인했는데 곧 고쳐짐)·맞은 반려(반려했고 곧 고쳐짐)·빗나간 반려(반려했는데 아무도 안 고침) */
export type Verdict = 'right-approve' | 'missed' | 'right-reject' | 'doubtful'

/** 아직 잴 수 없으면 null: 결재하지 않은 일, 고친 파일이 없는 일(후속 수정으로 잴 수 없다), 지켜보는 중인 일 */
export function judgeOf(r: JobRecord, now: number): Verdict | null {
  if (r.approval !== 'approved' && r.approval !== 'rejected') return null
  if ((r.files ?? 0) === 0) return null
  const isFollowed = r.isFollowedUp === true
  if (!isFollowed && now - r.endedAt <= FOLLOW_MS) return null
  if (r.approval === 'approved') return isFollowed ? 'missed' : 'right-approve'
  return isFollowed ? 'right-reject' : 'doubtful'
}

export type Accuracy = { approver: string; judged: number; right: number; missed: number; doubtful: number; rejects: number; rightRejects: number }

/** 결재자별 정확도(판정한 건이 많은 순) */
export function accuracyOf(book: HrBook, now: number): Accuracy[] {
  const by = new Map<string, Accuracy>()
  for (const r of book.log) {
    const v = judgeOf(r, now)
    if (v === null || r.approver === undefined) continue
    const a = by.get(r.approver) ?? { approver: r.approver, judged: 0, right: 0, missed: 0, doubtful: 0, rejects: 0, rightRejects: 0 }
    a.judged++
    if (v === 'right-approve' || v === 'right-reject') a.right++
    if (v === 'missed') a.missed++
    if (v === 'doubtful') a.doubtful++
    if (v === 'right-reject' || v === 'doubtful') a.rejects++
    if (v === 'right-reject') a.rightRejects++
    by.set(r.approver, a)
  }
  return [...by.values()].sort((x, y) => y.judged - x.judged || (x.approver < y.approver ? -1 : 1))
}

/** 반려 정확도를 판정하는 데 필요한 판정된 반려 수 */
export const MIN_REJECTS = 3
/** 판정된 반려 중 맞은 것이 이 비율 아래면 그 결재자의 반려는 감점하지 않는다(의견은 그대로 전한다) */
export const TRUST_FLOOR = 1 / 3

/** 이 결재자의 반려로 감점해도 되는가: 근거가 모자라면 믿는다 */
export function isRejectTrusted(book: HrBook, approver: string, now: number): boolean {
  const a = accuracyOf(book, now).find(x => x.approver === approver)
  if (a === undefined || a.rejects < MIN_REJECTS) return true
  return a.rightRejects / a.rejects >= TRUST_FLOOR
}

const pct = (n: number, of: number): number => (of === 0 ? 0 : Math.round((n / of) * 100))
const approverName = (book: HrBook, nick: string): string => {
  if (nick === 'BOSS') return '대표 BOSS'
  const e = book.employees.find(x => x.nick === nick)
  return e === undefined ? nick : `${DEPT_INFO[e.dept].ko}장 ${nick}(${koNick(nick)})`
}

/** 보고서에 싣는 결재 정확도 줄(판정한 건이 없으면 빈 목록) */
export function accuracyLines(book: HrBook, now: number): string[] {
  const list = accuracyOf(book, now)
  if (list.length === 0) return []
  return [
    '결재 정확도(지금까지, 끝낸 뒤 10분 안에 다른 사람이 같은 파일을 고쳤는지로 잼):',
    ...list.map(a => `  ${approverName(book, a.approver)}: 판정 ${a.judged}건 · 맞음 ${a.right}(${pct(a.right, a.judged)}%)`
      + `${a.missed > 0 ? ` · 놓친 승인 ${a.missed}` : ''}${a.doubtful > 0 ? ` · 빗나간 반려 ${a.doubtful}` : ''}`
      + `${isRejectTrusted(book, a.approver, now) ? '' : ' · 반려 감점 유예(반려가 자주 빗나감)'}`),
  ]
}

// ── 적임자 배정: 비슷한 일을 잘 끝낸 직원에게 맡긴다 ─────────────

const wordsOf = (s: string): string[] => [...new Set(s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(w => [...w].length >= 2))]
/**
 * 같은 낱말: 한쪽이 다른 쪽으로 시작하면 같다고 본다("빌드"·"빌드를", "test"·"tests").
 * 짧은 영문 낱말은 그대로 같을 때만("go"와 "golang"은 다르다)
 */
const isSameWord = (a: string, b: string): boolean => {
  if (a === b) return true
  const [short, long] = a.length <= b.length ? [a, b] : [b, a]
  return short.length >= (/^[\x00-\x7f]+$/.test(short) ? 4 : 2) && long.startsWith(short)
}

/** 업무 설명 둘이 비슷한가: 짧은 쪽 낱말의 절반 이상이 겹친다 */
export function isSimilar(a: string, b: string): boolean {
  const x = wordsOf(a)
  const y = wordsOf(b)
  if (x.length === 0 || y.length === 0) return false
  const shared = x.filter(w => y.some(v => isSameWord(w, v))).length
  return shared / Math.min(x.length, y.length) >= 0.5
}

/** 평가가 아직 없는 직원의 평균(보통 B) */
const NEW_AVG = 6
/** 비슷한 일을 잘 끝냈는가: 완료했고, 반려(감점을 유예한 반려는 빼고)·재작업이 없다 */
const isClean = (r: JobRecord): boolean => r.outcome === 'done' && !(r.approval === 'rejected' && r.isWaived !== true) && !r.isReworked

export type Fit = { employee: Employee; score: number; similar: number; slips: number }

/** 적합도: 평균 평가 + 비슷한 일을 잘 끝낸 건당 +3(3건까지) − 비슷한 일에서 그르친 건당 4(2건까지) + 경력(2까지) */
export function fitOf(book: HrBook, e: Employee, description: string): Fit {
  const past = book.log.filter(r => r.nick === e.nick && isSimilar(r.description, description)).slice(0, 10)
  const similar = past.filter(isClean).length
  const slips = past.length - similar
  const score = (e.avgScore ?? NEW_AVG) + 3 * Math.min(similar, 3) - 4 * Math.min(slips, 2) + Math.min(2, e.xp / 60)
  return { employee: e, score, similar, slips }
}

export type Assignment = { employee: Employee; why: string | null }

/**
 * 그 부서에서 쉬고 있는 직원 중 적임자. 아무도 없으면 null(새로 뽑는다).
 * 고를 사람이 둘 이상일 때만 까닭을 단다(비슷한 일의 실적, 없으면 평균 평가).
 */
export function pickFor(book: HrBook, dept: Dept, busy: ReadonlySet<string>, description: string): Assignment | null {
  const pool = book.employees.filter(e => e.dept === dept && !busy.has(e.nick))
  const ranked = pool.map(e => fitOf(book, e, description))
    .sort((a, b) => b.score - a.score || b.employee.xp - a.employee.xp || a.employee.hiredAt - b.employee.hiredAt)
  const top = ranked[0]
  if (top === undefined) return null
  if (ranked.length === 1) return { employee: top.employee, why: null }
  const e = top.employee
  const why = top.similar > 0 ? `비슷한 일 ${top.similar}건을 잘 끝냄`
    : e.avgScore === null ? `${rankOf(e.xp).ko}, 아직 평가 없음` : `평균 평가 ${gradeOf(e.avgScore)}(${e.avgScore.toFixed(1)})`
  return { employee: e, why }
}

// ── 조직 개편: 계속 성과가 나쁘면 권고사직, 오래 일이 없으면 계약 종료 ─────────────

/** 권고사직을 보는 최소 업무 수와 평균 평가(이 아래면) */
export const RETIRE_JOBS = 5
export const RETIRE_AVG = 0
/** 일을 이만큼 이하로 하고 이 기간 일이 없으면 계약 종료 */
export const IDLE_JOBS = 2
export const IDLE_MS = 30 * 24 * 60 * 60_000

/** 내보낼 까닭(없으면 null) */
export function departureOf(e: Employee, now: number): string | null {
  if (e.jobs >= RETIRE_JOBS && e.avgScore !== null && e.avgScore < RETIRE_AVG) {
    return `권고사직: 업무 ${e.jobs}건, 최근 평균 평가 ${gradeOf(e.avgScore)}(${e.avgScore.toFixed(1)})`
  }
  const idle = now - (e.lastAt ?? e.hiredAt)
  if (e.jobs <= IDLE_JOBS && idle > IDLE_MS) return `계약 종료: ${Math.floor(idle / (24 * 60 * 60_000))}일 동안 일이 없음`
  return null
}

/** 조직 개편: 건드리면 안 되는 직원(일하는 중·배정됐는데 아직 안 들어옴·평가와 결재가 덜 끝남)을 빼고, 내보낼 사람을 떠난 직원 명부로 옮긴다 */
export function reorgOf(book: HrBook, busy: ReadonlySet<string>, now: number): { book: HrBook; gone: Retiree[] } {
  const gone: Retiree[] = []
  for (const e of book.employees) {
    if (busy.has(e.nick)) continue
    const reason = departureOf(e, now)
    if (reason !== null) gone.push({ ...e, retiredAt: now, reason })
  }
  if (gone.length === 0) return { book, gone }
  const left = new Set(gone.map(e => e.nick))
  return {
    book: { ...book, employees: book.employees.filter(e => !left.has(e.nick)), retired: [...gone, ...book.retired].slice(0, MAX_RETIRED) },
    gone,
  }
}

/** 떠난 직원이 다시 일을 맡았다(내보낸 뒤에 끝난 일이 들어온 경우): 새로 뽑지 않고 그 기록 그대로 복직시킨다 */
export function reinstate(book: HrBook, nick: string): HrBook {
  const had = book.retired.find(e => e.nick === nick)
  if (had === undefined) return book
  const { retiredAt: _at, reason: _why, ...employee } = had
  return { ...book, employees: [...book.employees, employee], retired: book.retired.filter(e => e !== had) }
}
