// 보고서와 인사 기록. 끝낸 일 기록(book.log)으로 기간별 부서 실적을 내고, 직원 명부와 한 명의 인사카드를 만든다.
// 시간대를 모르므로 기간은 "지금부터 거슬러" 잰다(오늘 = 최근 24시간, 이번 주 = 최근 7일). 순수 함수만 둔다.
import type { Employee, HrBook, JobRecord, OfficeAgent, Retiree } from '../types'
import { bonusOf, CHECK_PENALTY, DEPT_INFO, DEPTS, gradeOf, isMuted, LEAD_ALLOWANCE, leadOf, lessonKey, lessonsFor, RANKS, rankOf, REWORK_PENALTY, salaryOf, tipOf } from './hr'
import { REJECT_PENALTY } from './approval'
import { CONTROL_EVERY, effectText } from './trial'
import { accuracyLines } from './org'
import { koNick } from './scene'
import { costText, sumTokens, tokenDetail, tokenText, totalOf, usdText, useText } from './tokens'
import { budgetLines } from './budget'

const HOUR_MS = 60 * 60_000
const DAY_MS = 24 * HOUR_MS

export type Period = 'today' | 'week'

export const PERIODS: Record<Period, { ko: string; span: string; ms: number }> = {
  today: { ko: '일간', span: '최근 24시간', ms: DAY_MS },
  week: { ko: '주간', span: '최근 7일', ms: 7 * DAY_MS },
}

/** 연봉(만원)을 시급으로 바꿀 때 쓰는 한 해 근무 시간(주 40시간 × 52주) */
const WORK_HOURS_PER_YEAR = 2080

const won = (n: number): string => Math.round(n).toLocaleString('en-US')
const pctOf = (n: number, of: number): number => (of === 0 ? 0 : Math.round((n / of) * 100))
const avgOf = (xs: readonly number[]): number | null => (xs.length === 0 ? null : xs.reduce((s, x) => s + x, 0) / xs.length)
const gradeText = (avg: number | null): string => (avg === null ? '-' : `${gradeOf(avg)}(${avg.toFixed(1)})`)
const signed = (n: number): string => `${n >= 0 ? '+' : ''}${n}`

/** 걸린 시간: 1시간 20분, 3분, 40초 */
export function durationText(ms: number): string {
  ms = Math.max(0, ms)
  const m = Math.floor(ms / 60_000)
  if (m === 0) return `${Math.max(0, Math.round(ms / 1000))}초`
  const h = Math.floor(m / 60)
  return h === 0 ? `${m}분` : `${h}시간${m % 60 === 0 ? '' : ` ${m % 60}분`}`
}

/** 지난 시각: 방금, 5분 전, 3시간 전, 2일 전 */
export function agoText(at: number, now: number): string {
  const ms = Math.max(0, now - at)
  if (ms < 60_000) return '방금'
  if (ms < HOUR_MS) return `${Math.floor(ms / 60_000)}분 전`
  if (ms < DAY_MS) return `${Math.floor(ms / HOUR_MS)}시간 전`
  return `${Math.floor(ms / DAY_MS)}일 전`
}

const OUTCOME_KO: Record<JobRecord['outcome'], string> = { done: '완료', failed: '실패', killed: '중단' }

/** 기록 한 건의 흠(없으면 빈 목록) */
const flawsOf = (r: JobRecord): string[] => [
  ...(r.outcome === 'done' ? [] : [OUTCOME_KO[r.outcome]]),
  ...(r.isCheckFailed ? ['테스트·빌드 실패한 채 완료'] : []),
  ...(r.isReworked ? ['재작업'] : []),
  ...(r.alarms > 0 ? [`근태 알림 ${r.alarms}`] : []),
  ...(r.approval === 'rejected' ? [r.isWaived === true ? '결재 반려(감점 유예)' : '결재 반려'] : []),
]

/** 그 일의 인건비(원): 그때 연봉(예전 기록이면 지금 연봉)을 시급으로 환산해 걸린 시간을 곱한다 */
function costOf(book: HrBook, r: JobRecord): number {
  const e = book.employees.find(x => x.nick === r.nick)
  const salary = r.salary ?? (e === undefined ? RANKS[0].salary : salaryOf(book, e))
  return (salary * 10_000 / WORK_HOURS_PER_YEAR) * (Math.max(0, r.endedAt - r.startedAt) / HOUR_MS)
}

/** 기간 안에 끝낸 일 */
export const jobsIn = (book: HrBook, period: Period, now: number): JobRecord[] =>
  book.log.filter(r => now - r.endedAt <= PERIODS[period].ms && r.endedAt <= now)

/** 여러 건을 한 줄로: 업무 N건 · 완료 a / 실패 b · 평균 평가 */
function tally(list: readonly JobRecord[]): string {
  const done = list.filter(r => r.outcome === 'done').length
  return `${list.length}건 · 완료 ${done} / 실패 ${list.length - done}(완료율 ${pctOf(done, list.length)}%) · 평균 평가 ${gradeText(avgOf(list.map(r => r.score)))}`
}

/** /office report: 기간 안에 끝낸 일로 부서별 실적, MVP, 살펴볼 일. 일간 보고에는 하루 예산 현황(지금 일하는 사람 몫까지)도 싣는다 */
export function reportOf(book: HrBook, period: Period, now: number, agents: readonly OfficeAgent[] = []): string {
  const p = PERIODS[period]
  const list = jobsIn(book, period, now)
  const lines = [`에이전트 사무실 ${p.ko} 보고 (${p.span})`]
  const budget = period === 'today' ? budgetLines(book, agents, now) : []
  if (list.length === 0) {
    lines.push('이 기간에 끝낸 업무가 없습니다.')
    if (budget.length > 0) lines.push('', ...budget)
    return lines.join('\n')
  }
  const worked = list.reduce((s, r) => s + Math.max(0, r.endedAt - r.startedAt), 0)
  const cost = list.reduce((s, r) => s + costOf(book, r), 0)
  const used = sumTokens(list.map(r => r.tokens))
  const reviewed = sumTokens(list.map(r => r.reviewTokens))
  lines.push(`전체: 업무 ${tally(list)} · 근무 ${durationText(worked)} · 인건비 약 ${won(cost)}원(연봉을 시급으로 환산)`)
  const both = sumTokens([used, reviewed])
  if (both !== undefined) {
    lines.push(`토큰: 업무 ${used === undefined ? '0' : useText(used)}${reviewed === undefined ? '' : ` · 결재 ${useText(reviewed)}`} · 비용 합계 약 ${costText(both)}(API 정가로 어림, 토큰은 입력·출력·캐시를 모두 더함)`)
  }
  const decided = (a: JobRecord['approval']) => list.filter(r => r.approval === a).length
  if (list.some(r => r.approval !== undefined)) lines.push(`결재: 승인 ${decided('approved')} · 반려 ${decided('rejected')} · 전결 ${decided('exempt')}`)

  lines.push('', '부서별:')
  for (const d of DEPTS) {
    const mine = list.filter(r => r.dept === d)
    if (mine.length === 0) continue
    const sum = (f: (r: JobRecord) => number) => mine.reduce((s, r) => s + f(r), 0)
    const counts: [string, number][] = [['재작업', sum(r => (r.isReworked ? 1 : 0))], ['테스트 실패 완료', sum(r => (r.isCheckFailed ? 1 : 0))], ['근태 알림', sum(r => r.alarms)], ['결재 반려', sum(r => (r.approval === 'rejected' ? 1 : 0))]]
    const spent = sumTokens(mine.flatMap(r => [r.tokens, r.reviewTokens]))
    const extra = [`도구 오류 ${sum(r => r.errors)}`, ...counts.filter(([, n]) => n > 0).map(([k, n]) => `${k} ${n}`), ...(spent === undefined ? [] : [`토큰(결재 포함) ${useText(spent)}`])]
    lines.push(`  ${DEPT_INFO[d].ko}: ${tally(mine)} · ${extra.join(' · ')}`)
  }

  // MVP: 기간 안 평가 합계가 가장 높은 직원(같으면 건수가 적은 쪽, 그다음 별칭 순)
  const byNick = new Map<string, JobRecord[]>()
  for (const r of list) byNick.set(r.nick, [...(byNick.get(r.nick) ?? []), r])
  const ranked = [...byNick].map(([nick, rs]) => ({ nick, n: rs.length, total: rs.reduce((s, r) => s + r.score, 0) }))
    .sort((a, b) => b.total - a.total || a.n - b.n || (a.nick < b.nick ? -1 : 1))
  const mvp = ranked[0]
  if (mvp !== undefined && mvp.total > 0) {
    const e = book.employees.find(x => x.nick === mvp.nick)
    lines.push('', `MVP: ${mvp.nick} ${koNick(mvp.nick)}${e === undefined ? '' : ` ${rankOf(e.xp).ko}`} (${mvp.n}건, 평가 합계 ${signed(mvp.total)})`)
  }

  // 토큰을 많이 쓴 직원(세 명까지): 한 건 평균도 함께(토큰을 센 일로만)
  const spenders = [...byNick].map(([nick, rs]) => rs.filter(r => totalOf(r.tokens) > 0))
    .map(rs => ({ nick: rs[0]?.nick ?? '', n: rs.length, total: rs.reduce((s, r) => s + totalOf(r.tokens), 0), cost: costText(sumTokens(rs.map(r => r.tokens))) }))
    .filter(x => x.total > 0).sort((a, b) => b.total - a.total || (a.nick < b.nick ? -1 : 1)).slice(0, 3)
  if (spenders.length > 0) lines.push(`토큰을 많이 쓴 직원: ${spenders.map(x => `${x.nick} ${tokenText(x.total)}(${x.cost}, ${x.n}건, 한 건 ${tokenText(x.total / x.n)})`).join(' · ')}`)

  if (budget.length > 0) lines.push('', ...budget)

  const accuracy = accuracyLines(book, now)
  if (accuracy.length > 0) lines.push('', ...accuracy)

  const flawed = list.filter(r => flawsOf(r).length > 0)
  if (flawed.length > 0) {
    lines.push('', `살펴볼 일(${flawed.length}건${flawed.length > 5 ? ', 최근 5건' : ''}):`)
    for (const r of flawed.slice(0, 5)) {
      lines.push(`  - ${agoText(r.endedAt, now)} ${r.nick} ${r.description || '(설명 없음)'}: ${flawsOf(r).join(' · ')} · 평가 ${gradeOf(r.score)}(${signed(r.score)})`)
    }
  }
  return lines.join('\n')
}

/** 별칭(영문, 대소문자 무관)이나 한글 이름으로 직원을 찾는다(떠난 직원도) */
export const findEmployee = (book: HrBook, name: string): Employee | Retiree | undefined =>
  [...book.employees, ...book.retired].find(e => e.nick === name.toUpperCase() || koNick(e.nick) === name)

const isRetiree = (e: Employee | Retiree): e is Retiree => 'retiredAt' in e

/** /office hr <별칭>: 한 직원의 인사카드 */
export function cardOf(book: HrBook, e: Employee | Retiree, now: number): string {
  const rank = rankOf(e.xp)
  const gone = isRetiree(e) ? e : null
  const isLead = gone === null && leadOf(book, e.dept)?.nick === e.nick
  const next = RANKS.find(r => r.xp > e.xp)
  const lines = [
    `인사카드: ${e.nick} ${koNick(e.nick)} — ${DEPT_INFO[e.dept].ko} ${rank.ko}${isLead ? ' · 팀장' : ''}${gone === null ? '' : ' · 퇴사'} (${e.type})`,
    ...(gone === null ? [] : [`퇴사 ${agoText(gone.retiredAt, now)} · ${gone.reason}`]),
    `경력 ${e.xp}${next === undefined ? ' · 최고 직급' : ` · ${next.ko}까지 ${next.xp - e.xp}`}`,
    `${gone === null ? '' : '마지막 '}연봉 ${won(salaryOf(book, e))}만원 = 기본급 ${won(rank.salary)} + 성과급 ${won(bonusOf(e))}${isLead ? ` + 팀장 수당 ${LEAD_ALLOWANCE}` : ''}`,
  ]
  if (e.jobs === 0) {
    lines.push(`아직 끝낸 업무가 없습니다 · 입사 ${agoText(e.hiredAt, now)}`)
    return lines.join('\n')
  }
  lines.push(
    `업무 ${e.jobs}건 · 완료 ${e.done} / 실패 ${e.failed}(완료율 ${pctOf(e.done, e.jobs)}%) · 평균 평가 ${gradeText(e.avgScore)} · 최근 평가 ${e.lastScore === null ? '-' : gradeOf(e.lastScore)}`,
    `도구 오류 ${e.toolErrors} · 재작업 ${e.reworks} · 근태 알림 ${e.alarms} · 결재 반려 ${e.rejections}`,
    `입사 ${agoText(e.hiredAt, now)}${e.lastAt === null ? '' : ` · 마지막 업무 ${agoText(e.lastAt, now)}`}`,
  )
  // 한 건 평균은 토큰을 센 업무로만 낸다(토큰을 세기 전에 끝낸 일은 빼고)
  const counted = e.tokenJobs ?? 0
  if (e.tokens !== undefined && totalOf(e.tokens) > 0) lines.push(`토큰 누적 ${tokenDetail(e.tokens)}${counted > 0 ? ` · 한 건 평균 ${tokenText(totalOf(e.tokens) / counted)}` : ''}`)
  const recent = book.log.filter(r => r.nick === e.nick).slice(0, 5)
  if (recent.length > 0) {
    lines.push('', '최근 업무:')
    for (const r of recent) {
      const flaws = flawsOf(r).filter(f => f !== OUTCOME_KO[r.outcome])
      lines.push(`  - ${agoText(r.endedAt, now)} ${r.description || '(설명 없음)'} · ${OUTCOME_KO[r.outcome]} ${gradeOf(r.score)}(${signed(r.score)}) · ${durationText(r.endedAt - r.startedAt)}${r.errors > 0 ? ` · 도구 오류 ${r.errors}` : ''}${r.tokens !== undefined && totalOf(r.tokens) > 0 ? ` · 토큰 ${useText(r.tokens)}` : ''}${flaws.length > 0 ? ` · ${flaws.join(' · ')}` : ''}`)
    }
  }
  const lessons = lessonsFor(book, e.dept, now)
  if (lessons.length > 0) {
    lines.push('', `${DEPT_INFO[e.dept].ko}이 반복한 실수(업무 지시에 붙음):`)
    for (const l of lessons) {
      const tip = tipOf(l.pattern)
      lines.push(`  - ${l.tool} "${l.pattern}" ${l.count}회${tip === null ? '' : ` → ${tip}`}`)
    }
  }
  return lines.join('\n')
}

/** /office hr: 부서별 직원·직급·연봉·평가, 부서가 반복한 실수 */
export function rosterText(b: HrBook, now: number): string {
  const on = (x: boolean) => (x ? '켜짐' : '꺼짐')
  const lines = [`에이전트 사무실 인사 기록 (업무 지시 인사 메모: ${on(b.isCoaching)} · 교육 효과 측정: ${on(b.isTrialing)} · 결재: ${on(b.isApproving)} · 조직 개편: ${on(b.isReorganizing)})`]
  if (b.employees.length === 0) lines.push('아직 직원이 없습니다. 서브에이전트가 일을 맡으면 부서에 배치됩니다.')
  for (const d of DEPTS) {
    const staffList = b.employees.filter(e => e.dept === d).sort((x, y) => y.xp - x.xp)
    if (staffList.length === 0) continue
    const lead = leadOf(b, d)
    lines.push('', `${DEPT_INFO[d].ko}${lead === undefined ? '' : ` — 팀장 ${lead.nick}(${koNick(lead.nick)})`}`)
    for (const e of staffList) {
      const grade = e.lastScore === null ? '-' : gradeOf(e.lastScore)
      lines.push(`  ${e.nick} ${koNick(e.nick)} · ${rankOf(e.xp).ko} · 연봉 ${won(salaryOf(b, e))}만원 · 최근 평가 ${grade} · 완료 ${e.done} / 실패 ${e.failed} · 도구 오류 ${e.toolErrors}${e.reworks > 0 ? ` · 재작업 ${e.reworks}` : ''}${e.alarms > 0 ? ` · 근태 알림 ${e.alarms}` : ''}${e.rejections > 0 ? ` · 결재 반려 ${e.rejections}` : ''}${e.tokens !== undefined && totalOf(e.tokens) > 0 ? ` · 토큰 ${useText(e.tokens)}` : ''} · 경력 ${e.xp}`)
    }
  }
  if (b.retired.length > 0) {
    lines.push('', `떠난 직원(${b.retired.length}명${b.retired.length > 5 ? ', 최근 5명' : ''}):`)
    for (const e of b.retired.slice(0, 5)) lines.push(`  ${e.nick} ${koNick(e.nick)} · ${DEPT_INFO[e.dept].ko} ${rankOf(e.xp).ko} · ${agoText(e.retiredAt, now)} · ${e.reason}`)
  }
  const lessonLines = DEPTS.flatMap(d => (b.lessons[d] ?? []).slice(0, 3).map(l => {
    const tip = tipOf(l.pattern)
    return `  ${DEPT_INFO[d].ko}: ${l.tool} "${l.pattern}" ${l.count}회${tip === null ? '' : ` → ${tip}`}${effectText(b.trials[lessonKey(l)], isMuted(b, l, now))}`
  }))
  if (lessonLines.length > 0) {
    lines.push('', '부서별 반복 실수(2회 이상이면 다음 업무 지시에 붙음):', ...lessonLines)
    if (b.isTrialing) lines.push(`  효과: 실수 목록을 ${CONTROL_EVERY}건에 한 건은 빼고 보내 재발률을 비교합니다. 근거가 모였는데 붙여도 재발이 줄지 않으면 2주 동안 메모에서 뺐다가 다시 잽니다.`)
  }
  lines.push('', `평가: 완료 +10, 실패 -5(중단 -3), 도구 오류 1개당 -1(최대 -5), 오류 없이 완료 +3, 테스트·빌드 실패한 채 완료 -${CHECK_PENALTY}, 끝낸 뒤 BOSS가 같은 파일을 다시 고치면 재작업 -${REWORK_PENALTY}, 결재 반려 -${REJECT_PENALTY}.`,
    '직급: 사원 0 · 대리 20 · 과장 60 · 차장 120 · 부장 200(경력, 감점이면 깎여 강등). 평균 평가는 최근 일에 무게를 둡니다.',
    `예산: ${DEPTS.some(d => b.budgets[d] !== undefined) ? DEPTS.flatMap(d => (b.budgets[d] === undefined ? [] : [`${DEPT_INFO[d].ko} 하루 ${usdText(b.budgets[d] ?? 0)}`])).join(' · ') : '없음'}(넘으면 하루 한 번 알림, /office budget <부서> <달러>|off).`,
    '배정: 쉬고 있는 부서 직원 중 비슷한 일을 잘 끝낸 사람·평균 평가가 높은 사람에게 맡깁니다. 조직 개편: 계속 평가가 나쁘면 권고사직, 오래 일이 없으면 계약 종료(/office reorg on|off).',
    '한 사람의 인사카드는 /office hr <별칭>, 부서 실적 보고는 /office report [today|week].')
  return lines.join('\n')
}
