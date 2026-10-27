// 기록 보관·내보내기. 끝낸 일 기록이 넘쳐 밀려나는 오래된 일은 지우지 않고 월별 요약으로 접어 두고,
// 인사 기록을 JSON(통째로)과 CSV(업무 기록·월별 요약)로 낸다. 순수 함수만 둔다(부서 이름은 부르는 쪽이 준다).
import type { Dept, HrBook, JobRecord, MonthSummary } from '../types'

/** 월별 요약은 최근 10년(120달)까지 */
export const MAX_MONTHS = 120

/** 끝낸 때(현지 시각)의 달: 'YYYY-MM' */
export function monthOf(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const emptyMonth = (month: string): MonthSummary => ({ month, jobs: 0, done: 0, failed: 0, scoreSum: 0, usd: 0, reworks: 0, rejected: 0, good: 0, bad: 0, depts: {} })

const usdOfRecord = (r: JobRecord): number => (r.tokens?.usd ?? 0) + (r.reviewTokens?.usd ?? 0)

/** 한 달 요약에 끝낸 일 한 건을 더한다 */
function add(m: MonthSummary, r: JobRecord): MonthSummary {
  const d = m.depts[r.dept] ?? { jobs: 0, scoreSum: 0, usd: 0 }
  const usd = usdOfRecord(r)
  return {
    ...m, jobs: m.jobs + 1, done: m.done + (r.outcome === 'done' ? 1 : 0), failed: m.failed + (r.outcome === 'done' ? 0 : 1),
    scoreSum: m.scoreSum + r.score, usd: m.usd + usd, reworks: m.reworks + (r.isReworked ? 1 : 0), rejected: m.rejected + (r.approval === 'rejected' ? 1 : 0),
    good: m.good + (r.bossRating === 'good' ? 1 : 0), bad: m.bad + (r.bossRating === 'bad' ? 1 : 0),
    depts: { ...m.depts, [r.dept]: { jobs: d.jobs + 1, scoreSum: d.scoreSum + r.score, usd: d.usd + usd } },
  }
}

/** 월별 요약에 끝낸 일들을 접어 넣는다(최근 달이 앞, 최근 120달까지) */
export function foldInto(months: readonly MonthSummary[], records: readonly JobRecord[]): MonthSummary[] {
  if (records.length === 0) return [...months]
  const by = new Map(months.map(m => [m.month, m]))
  for (const r of records) {
    const k = monthOf(r.endedAt)
    by.set(k, add(by.get(k) ?? emptyMonth(k), r))
  }
  return [...by.values()].sort((a, b) => (a.month < b.month ? 1 : a.month > b.month ? -1 : 0)).slice(0, MAX_MONTHS)
}

/** 보이는 월별 실적: 접어 둔 요약과 아직 남은 업무 기록을 함께 센다(최근 달이 앞) */
export const monthsOf = (book: HrBook): MonthSummary[] => foldInto(book.archive ?? [], book.log)

/** 저장된 월별 요약을 읽는다(모양이 틀린 것은 버린다) */
export function archiveOf(x: unknown, isDept: (d: unknown) => d is Dept): MonthSummary[] | undefined {
  if (!Array.isArray(x)) return undefined
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  const out = x.filter((m): m is Record<string, unknown> => typeof m === 'object' && m !== null && typeof (m as { month?: unknown }).month === 'string' && /^\d{4}-\d{2}$/.test((m as { month: string }).month))
    .map((m): MonthSummary => {
      const depts: MonthSummary['depts'] = {}
      for (const [d, v] of Object.entries(typeof m.depts === 'object' && m.depts !== null ? m.depts as Record<string, unknown> : {})) {
        if (!isDept(d) || typeof v !== 'object' || v === null) continue
        const o = v as Record<string, unknown>
        depts[d] = { jobs: num(o.jobs), scoreSum: num(o.scoreSum), usd: num(o.usd) }
      }
      return { month: m.month as string, jobs: num(m.jobs), done: num(m.done), failed: num(m.failed), scoreSum: num(m.scoreSum), usd: num(m.usd),
        reworks: num(m.reworks), rejected: num(m.rejected), good: num(m.good), bad: num(m.bad), depts }
    })
    // 같은 달이 두 번 있으면 앞의 것만
    .filter((m, i, all) => all.findIndex(y => y.month === m.month) === i)
    .sort((a, b) => (a.month < b.month ? 1 : -1))
    .slice(0, MAX_MONTHS)
  return out.length === 0 ? undefined : out
}

// ── 내보내기 ─────────────

/** 내보내는 꼴 */
export type ExportKind = 'json' | 'csv'

/** 내보낼 파일 이름의 앞부분: agent-office-20261027-153005 */
export function exportBase(now: number): string {
  const d = new Date(now)
  const p = (n: number) => String(n).padStart(2, '0')
  // 초까지 넣는다(같은 분에 다시 내보내도 앞 파일을 덮지 않도록)
  return `agent-office-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

/** 인사 기록 통째(JSON): 내보낸 때와 함께 */
export const jsonOf = (book: HrBook, now: number): string => `${JSON.stringify({ exportedAt: new Date(now).toISOString(), app: 'agent-office', book }, null, 2)}\n`

/**
 * CSV 칸 하나: 쉼표·따옴표·줄바꿈이 있으면 따옴표로 감싸고, 스프레드시트가 수식으로 읽을 글(=·+·-·@로 시작)은 앞에 '를 붙인다
 * (업무 설명은 에이전트가 쓴 글이라 수식이 들어 있을 수 있다)
 */
export function csvCell(v: string | number | boolean | undefined): string {
  if (v === undefined) return ''
  if (typeof v !== 'string') return String(v)
  // 앞 공백을 다듬어 읽는 프로그램과 전각 기호(＝＋－＠)까지 막는다
  const safe = /^[\s]*[=+\-@＝＋－＠]|^[\t\r]/.test(v) ? `'${v}` : v
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

const csvOfRows = (head: readonly string[], rows: readonly (readonly (string | number | boolean | undefined)[])[]): string =>
  `﻿${[head, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n')}\r\n`

const iso = (ms: number): string => new Date(ms).toISOString()
const usd4 = (n: number): string => n.toFixed(4)

/** 업무 기록 CSV(남아 있는 업무 기록 한 줄에 한 건, 최근 것부터). 엑셀이 한글을 읽도록 BOM을 붙인다 */
export const jobsCsvOf = (book: HrBook, deptName: (d: Dept) => string): string => csvOfRows(
  ['별칭', '부서', '몇 번째 일', '업무', '시작', '끝', '결과', '점수', '도구 오류', '테스트 실패 완료', '재작업', '결재', '결재자', '대표 평가', '고친 파일 수', '비용(달러)', '결재 비용(달러)'],
  book.log.map(r => [r.nick, deptName(r.dept), r.job, r.description, iso(r.startedAt), iso(r.endedAt), r.outcome, r.score, r.errors, r.isCheckFailed, r.isReworked,
    r.approval, r.approver, r.bossRating, r.files, usd4(r.tokens?.usd ?? 0), usd4(r.reviewTokens?.usd ?? 0)]),
)

/** 월별 요약 CSV(접어 둔 달과 남은 기록을 함께, 부서별 줄도) */
export const monthsCsvOf = (book: HrBook, deptName: (d: Dept) => string): string => csvOfRows(
  ['달', '부서', '업무', '완료', '실패·중단', '평균 평가', '비용(달러)', '재작업', '반려', '대표 좋음', '대표 아쉬움'],
  monthsOf(book).flatMap(m => [
    [m.month, '전체', m.jobs, m.done, m.failed, m.jobs === 0 ? '' : (m.scoreSum / m.jobs).toFixed(1), usd4(m.usd), m.reworks, m.rejected, m.good, m.bad],
    ...Object.entries(m.depts).map(([d, v]) => [m.month, deptName(d as Dept), v.jobs, '', '', v.jobs === 0 ? '' : (v.scoreSum / v.jobs).toFixed(1), usd4(v.usd), '', '', '', '']),
  ]),
)

/** 내보낼 파일들(이름 → 내용) */
export function exportFiles(book: HrBook, kind: ExportKind, now: number, deptName: (d: Dept) => string): { name: string; text: string }[] {
  const base = exportBase(now)
  return kind === 'json'
    ? [{ name: `${base}.json`, text: jsonOf(book, now) }]
    : [{ name: `${base}-jobs.csv`, text: jobsCsvOf(book, deptName) }, { name: `${base}-months.csv`, text: monthsCsvOf(book, deptName) }]
}
