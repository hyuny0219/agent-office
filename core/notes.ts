// 개인 업무 노트. 직원마다 끝낸 일의 보고 요약·고친 파일·난 오류·반려 의견을 남겨 두고, 그 직원에게 다시 일을 맡길 때
// 비슷한 일의 노트를 업무 지시 인사 메모에 붙인다(적임자 배정이 실제로 그 사람의 경험을 쓰도록). 순수 함수만 둔다.
// 업무 지시에는 사무실이 잰 구조화된 칸만 넣는다: 지난 보고·도구 출력의 자유 글은 다음 직원에게 지시처럼 읽힐 수 있고,
// 저장소에 남아 세션을 넘어 계속 붙기 때문이다(자유 글은 인사카드에서만 보인다).
import type { Employee, HrBook, JobRecord, WorkNote } from '../types'
import { isSimilar } from './org'
import { lineOf } from './speech'

/** 직원마다 남기는 노트 수 */
export const NOTE_MAX = 5
/** 업무 지시에 붙이는 노트 수 */
export const BRIEF_NOTES = 3

/** 노트에 남기는 보고 요약: 마크다운 머리·글머리를 걷어 낸 첫 줄다운 줄(한 줄, 비밀 가림) */
export function summaryOf(report: string): string {
  const line = report.split('\n').map(l => l.replace(/^[\s#>*\-+•·]+/, '').replace(/\*\*/g, '').trim())
    .find(l => [...l].length >= 6 && !/^(요약|결과|보고|summary|result)\s*[:：]?$/i.test(l))
  return line === undefined ? '' : lineOf(line, 'first', 120)
}

const baseName = (f: string): string => lineOf(f.split(/[\\/]/).pop() ?? f, 'first', 60)

/** 끝낸 일 한 건의 노트 */
export function noteOf(job: number, description: string, report: string, files: readonly string[], errLines: readonly string[]): WorkNote {
  return { job, description: lineOf(description, 'first', 80), summary: summaryOf(report), files: [...new Set(files.map(baseName))].slice(-3), errors: errLines.slice(-2).map(l => lineOf(l, 'first', 100)) }
}

/** 그 직원의 노트에 더한다(최근 것이 앞, NOTE_MAX까지) */
export const addNote = (book: HrBook, nick: string, note: WorkNote): HrBook => ({
  ...book, employees: book.employees.map(e => (e.nick === nick ? { ...e, notes: [note, ...(e.notes ?? []).filter(n => n.job !== note.job)].slice(0, NOTE_MAX) } : e)),
})

/** 반려되면 그 일의 노트에 결재자 의견을 적는다(다음에 같은 실수를 하지 않도록) */
export const markRejected = (book: HrBook, nick: string, job: number, notes: readonly string[]): HrBook =>
  notes.length === 0 ? book : {
    ...book, employees: book.employees.map(e => (e.nick !== nick ? e : {
      ...e, notes: (e.notes ?? []).map(n => (n.job === job ? { ...n, rejectNotes: notes.slice(0, 2).map(x => lineOf(x, 'first', 100)) } : n)),
    })),
  }

/** 노트 한 건의 흠: 그 일의 기록에서(실패·테스트 실패·재작업·반려·대표 아쉬움) */
const flawsOf = (r: JobRecord | undefined): string[] => r === undefined ? [] : [
  ...(r.outcome === 'failed' ? ['실패'] : r.outcome === 'killed' ? ['중단'] : []),
  ...(r.isCheckFailed ? ['테스트·빌드 실패한 채 끝냄'] : []),
  ...(r.isReworked ? ['끝낸 뒤 BOSS가 다시 고침'] : []),
  ...(r.approval === 'rejected' ? ['결재 반려'] : []),
  ...(r.bossRating === 'bad' ? ['대표 아쉬움'] : r.bossRating === 'good' ? ['대표 좋음'] : []),
]

/** 글자 그대로 보이게: 꺾쇠·대괄호·백틱을 바꿔 표지나 칸을 흉내 내지 못하게 한다 */
const inert = (s: string): string => s.replace(/\s+/g, ' ').replace(/</g, '‹').replace(/>/g, '›').replace(/\[/g, '⟦').replace(/]/g, '⟧').replace(/`/g, "'")

const descOf = (n: WorkNote, r: JobRecord | undefined): string => lineOf(n.description || r?.description || '(설명 없음)', 'first', 80)

/** 인사카드의 노트 한 줄: 구조화된 칸과 자유 글(보고 요약·오류 문구·반려 의견)을 「」로 감싸 함께 */
export function noteLine(n: WorkNote, r: JobRecord | undefined): string {
  const quote = (s: string) => `「${s}」`
  const parts = [
    `"${descOf(n, r)}"`,
    ...flawsOf(r),
    ...(n.summary === '' ? [] : [`보고 ${quote(n.summary)}`]),
    ...(n.files.length === 0 ? [] : [`파일: ${n.files.join(', ')}`]),
    ...(n.errors.length === 0 ? [] : [`오류 ${n.errors.map(quote).join(' ')}`]),
    ...((n.rejectNotes ?? []).length === 0 ? [] : [`반려 의견 ${(n.rejectNotes ?? []).map(quote).join(' ')}`]),
  ]
  return inert(parts.join(' · '))
}

/** 오류가 난 도구 이름("Bash: …" → Bash) */
const toolsOf = (n: WorkNote): string[] => [...new Set(n.errors.map(l => l.split(':')[0]?.trim() ?? '').filter(t => /^[\w.-]{1,40}$/.test(t)))]

/**
 * 업무 지시에 붙이는 노트 한 줄: 사무실이 잰 칸만(설명·흠·파일 이름·오류 난 도구). 보고·출력의 자유 글은 넣지 않는다.
 * 교육 효과 측정의 비교군에는 흠·오류를 빼고 설명·파일만(실수 목록 역할을 하지 않도록)
 */
export function briefLine(n: WorkNote, r: JobRecord | undefined, isControl = false): string {
  const tools = toolsOf(n)
  const files = n.files.filter(f => /^[\w.@+-]{1,60}$/.test(f))
  const parts = [
    `"${descOf(n, r)}"`,
    ...(isControl ? [] : flawsOf(r)),
    // 파일 이름도 직원이 정한 글이라 이름다운 것만(빈칸·문장이 든 이름은 뺀다)
    ...(files.length === 0 ? [] : [`파일: ${files.join(', ')}`]),
    ...(isControl || tools.length === 0 ? [] : [`오류 난 도구: ${tools.join(', ')}`]),
  ]
  return inert(parts.join(' · '))
}

/**
 * 업무 지시에 붙일 노트 줄: 이번 일과 비슷한 일의 노트를 먼저, 그다음 흠 있던 노트, 그다음 최근 것으로 BRIEF_NOTES개까지.
 * 비교군이면 흠으로 순위를 매기지도 않는다
 */
export function briefNotes(book: HrBook, e: Employee, description: string, isControl = false): string[] {
  const notes = e.notes ?? []
  const recordOf = (n: WorkNote) => book.log.find(r => r.nick === e.nick && r.job === n.job)
  const rank = (n: WorkNote): number => {
    const r = recordOf(n)
    return (isSimilar(descOf(n, r), description) ? 2 : 0) + (!isControl && flawsOf(r).some(f => f !== '대표 좋음') ? 1 : 0)
  }
  return notes.map((n, i) => ({ n, i, score: rank(n) }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, BRIEF_NOTES)
    .map(({ n }) => briefLine(n, recordOf(n), isControl))
}
