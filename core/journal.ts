// 업무 일지. 서브에이전트가 끝낸 일마다 실제로 한 것(업무·결과·고친 파일·돌린 확인 명령·오류·결재 의견·직원 보고)을 남기고,
// 하루·한 주·한 사람 단위의 보고서(문서 블록)로 엮는다. 사람이 읽는 기록이라 업무 지시에는 붙이지 않는다. 순수 함수만 둔다.
import type { CheckRun, Dept, HrBook, JobRecord, JournalEntry, OfficeAgent, TokenUse } from '../types'
import { DEPT_INFO, DEPTS, gradeOf, rankOf } from './hr'
import { scrub } from './speech'
import { tokensOf, useText } from './tokens'
import type { Block } from './table'

/** 일지는 최근 200건까지(그 전 일은 업무 기록의 월별 요약에 남는다) */
export const MAX_ENTRIES = 200
/** 직원 보고는 앞부분 이만큼만 남긴다 */
export const REPORT_MAX = 1500
const MAX_FILES = 30
/** 결재 의견을 남길 수 */
const MAX_APPROVAL_NOTES = 5

const DAY_MS = 24 * 60 * 60_000
/** 일지 보고서의 기간: 최근 24시간, 최근 7일 */
export const JOURNAL_PERIODS = { today: { ko: '오늘', ms: DAY_MS }, week: { ko: '이번 주', ms: 7 * DAY_MS } } as const
export type JournalPeriod = keyof typeof JOURNAL_PERIODS

/** 보고를 일지에 남길 꼴로: 비밀을 가리고, 줄은 살리되 앞부분만 */
export function reportOf(text: string): string {
  const clean = scrub(text).replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  const chars = Array.from(clean)
  return chars.length <= REPORT_MAX ? clean : `${chars.slice(0, REPORT_MAX - 1).join('')}…`
}

const cut = (s: string, n: number): string => Array.from(s).slice(0, n).join('')

/** 끝낸 일 한 건의 일지 항목. 부서는 업무 기록과 같은 것을 받는다. 업무 설명·파일 경로도 비밀을 가리고 길이를 자른다(omp는 지시 첫 줄이 설명이다) */
export function entryOf(a: OfficeAgent, job: number, outcome: JournalEntry['outcome'], endedAt: number, report: string, dept: Dept = a.dept ?? 'ops'): JournalEntry {
  return {
    nick: a.nick, dept, job, type: a.type, description: cut(scrub(a.description), 200), startedAt: a.startedAt, endedAt, outcome,
    files: [...(a.files ?? [])].slice(-MAX_FILES).map(f => cut(scrub(f), 300)), checks: [...(a.checks ?? [])], errors: [...(a.errLines ?? [])], report: reportOf(report),
    ...(a.tokens === undefined ? {} : { tokens: a.tokens }),
  }
}

/** 일지에 더한다(최근 것이 앞, 같은 사람·같은 일이면 바꾼다) */
export const addEntry = (list: readonly JournalEntry[], e: JournalEntry): JournalEntry[] =>
  [e, ...list.filter(x => !(x.nick === e.nick && x.job === e.job))].slice(0, MAX_ENTRIES)

/** 결재자 의견을 그 일의 항목에 적는다(없으면 그대로) */
export const noteApproval = (list: readonly JournalEntry[], nick: string, job: number, notes: readonly string[]): JournalEntry[] =>
  list.map(x => (x.nick === nick && x.job === job ? { ...x, approvalNotes: notes.map(n => scrub(n).slice(0, 200)).slice(0, MAX_APPROVAL_NOTES) } : x))

/** 저장된 일지를 읽는다(모양이 틀린 항목은 버린다) */
export function journalOf(x: unknown): JournalEntry[] {
  if (!Array.isArray(x)) return []
  const strs = (v: unknown, n: number, len: number): string[] => (Array.isArray(v) ? v.filter((y): y is string => typeof y === 'string').slice(0, n).map(y => y.slice(0, len)) : [])
  const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
  return x.filter((e): e is Record<string, unknown> => typeof e === 'object' && e !== null && typeof (e as { nick?: unknown }).nick === 'string' && isNum((e as { job?: unknown }).job))
    .map((e): JournalEntry => {
      const checks = (Array.isArray(e.checks) ? e.checks : []).filter((c): c is CheckRun => typeof c?.cmd === 'string' && (c.result === 'pass' || c.result === 'fail' || c.result === 'unsure') && typeof c.tail === 'string').slice(0, 10)
      const tokens: TokenUse | undefined = tokensOf(e.tokens)
      const outcome = e.outcome === 'done' || e.outcome === 'failed' || e.outcome === 'killed' ? e.outcome : 'done'
      return {
        nick: e.nick as string, dept: DEPTS.includes(e.dept as Dept) ? e.dept as Dept : 'ops', job: e.job as number, type: typeof e.type === 'string' ? e.type : 'agent',
        description: typeof e.description === 'string' ? e.description.slice(0, 200) : '', startedAt: isNum(e.startedAt) ? e.startedAt : 0, endedAt: isNum(e.endedAt) ? e.endedAt : 0, outcome,
        files: strs(e.files, MAX_FILES, 300), checks, errors: strs(e.errors, 10, 300), report: typeof e.report === 'string' ? cut(e.report, REPORT_MAX) : '',
        ...(Array.isArray(e.approvalNotes) ? { approvalNotes: strs(e.approvalNotes, 5, 200) } : {}), ...(tokens === undefined ? {} : { tokens }),
      }
    })
    .slice(0, MAX_ENTRIES)
}

/** 현지 시각 날짜: 2026-10-28 */
export function dayOf(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const clockOf = (ms: number): string => {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
const minutes = (e: JournalEntry): string => `${Math.max(0, Math.round((e.endedAt - e.startedAt) / 60_000))}분`
const OUTCOME_KO: Record<JournalEntry['outcome'], string> = { done: '완료', failed: '실패', killed: '중단' }
const CHECK_KO: Record<CheckRun['result'], string> = { pass: '통과', fail: '실패', unsure: '알 수 없음' }
const APPROVAL_KO = { approved: '승인', rejected: '반려', exempt: '전결' } as const

/** 그 일의 업무 기록(점수·결재·대표 평가) */
const recordOf = (book: HrBook, e: JournalEntry): JobRecord | undefined => book.log.find(r => r.nick === e.nick && r.job === e.job)

/** 한 항목의 블록: 제목 줄(시각·누구·무슨 일·결과), 그 아래 결재·파일·확인·오류·보고 */
function entryBlocks(book: HrBook, e: JournalEntry): Block[] {
  const r = recordOf(book, e)
  const emp = [...book.employees, ...book.retired].find(x => x.nick === e.nick)
  const who = `${e.nick}${emp === undefined ? '' : ` ${rankOf(emp.xp).ko}`} (${DEPT_INFO[e.dept].ko})`
  const grade = r === undefined ? '' : ` · 평가 ${gradeOf(r.score)}(${r.score >= 0 ? '+' : ''}${r.score})`
  const out: Block[] = [{ t: 'section', text: `${clockOf(e.endedAt)} ${who} — ${e.description || '(설명 없음)'}` },
    { t: 'bullet', text: `결과: ${OUTCOME_KO[e.outcome]} · ${minutes(e)}${grade}${e.tokens === undefined ? '' : ` · 토큰 ${useText(e.tokens)}`}` }]
  const approval = r?.approval === undefined ? null : `${APPROVAL_KO[r.approval]}${r.approver === undefined ? '' : `(${r.approver})`}${r.isWaived === true ? ', 감점 유예' : ''}`
  if (approval !== null || (e.approvalNotes ?? []).length > 0) out.push({ t: 'bullet', text: `결재: ${approval ?? '의견'}${(e.approvalNotes ?? []).length === 0 ? '' : ` — ${(e.approvalNotes ?? []).join(' / ')}`}` })
  if (r?.bossRating !== undefined || r?.isReworked === true) out.push({ t: 'bullet', text: [r?.bossRating === undefined ? null : `대표 평가: ${r.bossRating === 'good' ? '좋음' : '아쉬움'}`, r?.isReworked === true ? '끝낸 뒤 BOSS가 다시 고침(재작업)' : null].filter(x => x !== null).join(' · ') })
  if (e.files.length > 0) out.push({ t: 'bullet', text: `고친 파일 ${e.files.length}개: ${e.files.map(f => f.split(/[\\/]/).slice(-2).join('/')).join(', ')}` })
  for (const c of e.checks) out.push({ t: 'bullet', text: `확인: ${c.cmd} — ${CHECK_KO[c.result]}${c.tail === '' ? '' : ` (${c.tail})`}` })
  for (const err of e.errors) out.push({ t: 'bullet', text: `오류: ${err}` })
  if (e.report !== '') out.push({ t: 'line', text: '보고:' }, { t: 'quote', lines: e.report.split('\n') })
  return out
}

/** 일지 보고서: 기간(오늘·이번 주) 또는 한 사람의 최근 일(20건), 최근이 앞 */
export function journalBlocks(book: HrBook, entries: readonly JournalEntry[], now: number, want: JournalPeriod | { nick: string }): Block[] {
  const picked = typeof want === 'object'
    ? entries.filter(e => e.nick === want.nick.toUpperCase()).slice(0, 20)
    : entries.filter(e => now - e.endedAt <= JOURNAL_PERIODS[want].ms && e.endedAt <= now)
  const title = typeof want === 'object' ? `업무 일지: ${want.nick.toUpperCase()} (최근 ${picked.length}건)` : `업무 일지: ${JOURNAL_PERIODS[want].ko} (${want === 'today' ? '최근 24시간' : '최근 7일'})`
  const out: Block[] = [{ t: 'title', text: title }]
  if (picked.length === 0) return [...out, { t: 'line', text: '이 기간에 끝낸 일이 없습니다.' }]
  const done = picked.filter(e => e.outcome === 'done').length
  const files = new Set(picked.flatMap(e => e.files)).size
  const fails = picked.filter(e => e.checks.some(c => c.result === 'fail')).length
  out.push({ t: 'line', text: `끝낸 일 ${picked.length}건(완료 ${done} · 실패·중단 ${picked.length - done}) · 고친 파일 ${files}개 · 확인 실패가 있던 일 ${fails}건` },
    { t: 'line', text: '직원이 쓴 보고(> 줄)는 사무실이 옮긴 기록이며, 비밀로 보이는 값은 가렸습니다.' })
  // 날짜가 바뀔 때마다 날짜 줄
  let day = ''
  for (const e of picked) {
    const d = dayOf(e.endedAt)
    if (d !== day) {
      day = d
      out.push({ t: 'gap' }, { t: 'line', text: `── ${d} ──` })
    }
    out.push({ t: 'gap' }, ...entryBlocks(book, e))
  }
  return out
}

/** 메뉴 화면의 일지 보기: journal(오늘)·journal:week·journal:<별칭> */
export function journalViewOf(view: string): JournalPeriod | { nick: string } | null {
  if (view === 'journal' || view === 'journal:today') return 'today'
  if (view === 'journal:week') return 'week'
  const nick = view.startsWith('journal:') ? view.slice(8) : ''
  return /^[A-Za-z][A-Za-z0-9]{0,15}$/.test(nick) ? { nick } : null
}

/** /office journal의 인자 → 메뉴 화면 이름(쓸 수 없는 인자면 null) */
export function journalViewFor(arg: string | undefined): string | null {
  const want = (arg ?? '').trim()
  if (want === '' || want.toLowerCase() === 'today') return 'journal'
  if (want.toLowerCase() === 'week') return 'journal:week'
  // save는 하위 명령(/office journal save on|off)이지 별칭이 아니다
  if (want.toLowerCase() === 'save') return null
  return /^[A-Za-z][A-Za-z0-9]{0,15}$/.test(want) ? `journal:${want.toUpperCase()}` : null
}

/** 그날의 일지 파일 이름과 그날 항목(자동 저장용) */
export const dayEntries = (entries: readonly JournalEntry[], day: string): JournalEntry[] => entries.filter(e => dayOf(e.endedAt) === day)

/** 하루치 일지 블록(그날 끝낸 일 전부, 최근이 앞) */
export function dayBlocks(book: HrBook, entries: readonly JournalEntry[], day: string): Block[] {
  const list = dayEntries(entries, day)
  const out: Block[] = [{ t: 'title', text: `업무 일지 ${day}` }, { t: 'line', text: `끝낸 일 ${list.length}건. 직원이 쓴 보고(> 줄)는 사무실이 옮긴 기록이며, 비밀로 보이는 값은 가렸습니다.` }]
  for (const e of list) out.push({ t: 'gap' }, ...entryBlocks(book, e))
  return out
}

