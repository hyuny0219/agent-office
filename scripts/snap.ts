// 화면 스냅샷: 정해 둔 사무실(직원·업무 기록·예산·지침·배치)을 두 판의 화면 줄 만들기에 그대로 넣어 글로 남긴다.
// 테스트는 내용을 보고, 이 스냅샷은 실제 모양(칸 맞춤·줄바꿈·폭에 따라 줄이기)을 미리 본다. ANSI 색은 빼고 남긴다.
// 쓰는 법: bun scripts/snap.ts          스냅샷을 새로 쓴다(snapshots/)
//         bun scripts/snap.ts --check  지금 화면이 남긴 스냅샷과 다르면 다른 곳을 보이고 1로 끝난다
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { HrBook, JobRecord, OfficeAgent, Utterance } from '../types'
import { emptyBook, hire, record, setDept } from '../core/hr'
import { adopt, proposalsOf } from '../core/playbook'
import { feedRowsOf, rowsOf } from '../core/rows'
import { layoutOf, Office } from '../core/scene'
import { textOf } from '../core/table'
import { menuLines, MENU, menuScreen, plain, sideLines, viewBlocks, widgetLines } from '../omp/view'
import type { PlanLines, Scene } from '../omp/view'

// 시간대가 달라도 같은 그림이 나오게(보고서의 달·내보내기 이름은 현지 시각을 쓴다)
process.env.TZ = 'UTC'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dir = join(root, 'snapshots')
const NOW = Date.UTC(2026, 9, 27, 6, 0)
const MIN = 60_000

// ── 정해 둔 사무실 ─────────────

const tokens = (usd: number) => ({ input: 40_000, output: 8_000, cacheRead: 120_000, cacheWrite: 4_000, usd, unpriced: 0 })
const job = (nick: string, dept: JobRecord['dept'], n: number, description: string, agoMin: number, over: Partial<JobRecord> = {}): JobRecord => ({
  nick, dept, job: n, description, startedAt: NOW - (agoMin + 12) * MIN, endedAt: NOW - agoMin * MIN, outcome: 'done', score: 13, errors: 0,
  isCheckFailed: false, isReworked: false, alarms: 0, salary: 4200, tokens: tokens(0.4), ...over,
})

function bookOf(): HrBook {
  let b = emptyBook()
  for (const [nick, dept, type] of [['BEAR', 'dev', 'builder'], ['OTTER', 'dev', 'debugger'], ['OWL', 'research', 'Explore'], ['HAWK', 'qa', 'code-reviewer'], ['FOX', 'plan', 'planner'], ['CRANE', 'docs', 'writer']] as const) {
    b = hire(b, nick, dept, type, NOW - 30 * 24 * 60 * MIN).book
  }
  const jobs: JobRecord[] = [
    job('BEAR', 'dev', 1, '로그인 버그 고치기', 600, { score: 10, errors: 1, approval: 'approved', approver: 'HAWK' }),
    job('BEAR', 'dev', 2, '테스트 실패 고치기', 400, { score: 6, isCheckFailed: true, approval: 'rejected', approver: 'BOSS' }),
    job('OTTER', 'dev', 1, '빌드 경고 정리', 300, { score: 6, isReworked: true, bossRating: 'bad', bossXp: -3 }),
    job('BEAR', 'dev', 3, '결제 화면 고치기', 200, { score: 6, isCheckFailed: true }),
    job('OWL', 'research', 1, '라이브러리 조사', 150, { bossRating: 'good', bossXp: 3, score: 16 }),
    job('BEAR', 'dev', 4, '검색 속도 개선', 90, { score: 2, outcome: 'failed', errors: 4 }),
    job('HAWK', 'qa', 1, 'PR 리뷰', 60, { approval: 'exempt' }),
    job('FOX', 'plan', 1, '이번 주 계획 세우기', 30),
  ]
  for (const r of jobs) b = record(b, r)
  b = { ...b, employees: b.employees.map(e => {
    const mine = jobs.filter(r => r.nick === e.nick)
    const xp = mine.reduce((s, r) => s + Math.max(0, r.score), 0)
    return { ...e, xp, jobs: mine.length, done: mine.filter(r => r.outcome === 'done').length, failed: mine.filter(r => r.outcome !== 'done').length, avgScore: mine.length === 0 ? null : mine.reduce((s, r) => s + r.score, 0) / mine.length, lastScore: mine[mine.length - 1]?.score ?? null, lastAt: mine.length === 0 ? null : NOW - 30 * MIN, tokens: mine.length === 0 ? undefined : tokens(0.4 * mine.length), tokenJobs: mine.length }
  }) }
  // 지난달에 밀려난 오래된 일(월별 요약으로 접혀 있다)
  b = { ...b, archive: [{ month: '2026-09', jobs: 42, done: 38, failed: 4, scoreSum: 420, usd: 12.5, reworks: 3, rejected: 2, good: 5, bad: 1, depts: { dev: { jobs: 30, scoreSum: 300, usd: 10 }, qa: { jobs: 12, scoreSum: 120, usd: 2.5 } } }] }
  b = { ...b, budgets: { dev: 2, qa: 5 } }
  b = adopt(b, 'dev', proposalsOf(b, 'dev', NOW).slice(0, 1), NOW - 100 * MIN)
  b = setDept(b, 'writer', 'qa')
  return b
}

const agent = (id: string, nick: string, type: string, over: Partial<OfficeAgent>): OfficeAgent => ({
  id, type, nick, description: '', model: 'claude-sonnet-5-5', startedAt: NOW - 7 * MIN, endedAt: null, activity: 'type', tool: 'Edit', tools: 12, errors: 0, ...over,
})
const AGENTS: OfficeAgent[] = [
  agent('main', 'BOSS', 'main', { activity: 'spawn', tool: 'Agent', model: 'claude-opus-5-5', dept: undefined, tokens: tokens(1.2), meetUntil: NOW + 5000, meetWith: 'BEAR' }),
  agent('a1', 'BEAR', 'builder', { dept: 'dev', description: '결제 화면 고치기', tokens: tokens(0.3), meetUntil: NOW + 5000, meetWith: 'BOSS' }),
  agent('a2', 'OWL', 'Explore', { dept: 'research', activity: 'read', tool: 'Grep', description: '로그 형식 조사', model: 'claude-haiku-5-5', errors: 2 }),
  agent('a3', 'HAWK', 'code-reviewer', { dept: 'qa', activity: 'bash', tool: 'Bash', description: '테스트 돌리고 리뷰', isCheckFailed: true }),
]
const FEED: Utterance[] = [
  { at: NOW - 6 * MIN, kind: 'order', from: 'BOSS', to: 'BEAR', text: '결제 화면 고치기' },
  { at: NOW - 5 * MIN, kind: 'self', from: 'OWL', text: 'grep "level=" logs/' },
  { at: NOW - 3 * MIN, kind: 'error', from: 'HAWK', text: 'Bash: npm test 실패 (2 failed)' },
  { at: NOW - 2 * MIN, kind: 'approval', from: '품질팀장 HAWK', text: 'BEAR "로그인 버그 고치기" 승인' },
  { at: NOW - 1 * MIN, kind: 'hr', from: '인사팀', text: '개발팀 하루 예산 초과: 최근 24시간 $2.40 / 예산 $2.00(120%)' },
]

// ── 그리기 ─────────────

/** 평면도를 사람들이 자리에 앉을 만큼 돌린 뒤의 줄. 그림은 색칠한 반 칸 블록이라 글로는 빈칸으로 두고, 방 이름·명패·사람이 있는 곳만 남긴다 */
const glyph = (c: number): string => (c >= 0x2580 && c <= 0x259f ? ' ' : String.fromCodePoint(c))
function planText(columns: number): string[] {
  const layout = layoutOf(columns)
  const office = new Office(layout)
  let words = new Uint32Array()
  for (let f = 0; f < 120; f++) words = office.draw(AGENTS, f, NOW)
  return Array.from({ length: layout.rows }, (_, y) => Array.from({ length: layout.columns }, (_, x) => glyph(words[(y * layout.columns + x) * 3] ?? 32)).join('').trimEnd())
}
const planLines: PlanLines = (columns: number) => planText(columns)

const scene: Scene = { agents: AGENTS, book: bookOf(), feed: FEED, now: NOW }
const lines = (xs: readonly string[]) => `${xs.map(l => plain(l).trimEnd()).join('\n')}\n`

const shots: Record<string, string> = {
  // Claude Code판 사무실 패널(평면도 아래 목록·메신저): 패널 폭에 따라 칸을 줄인다
  'claude-rows-80.txt': lines([...rowsOf(AGENTS, scene.book, NOW, 78).map(r => r.text), '', '사내 메신저', ...feedRowsOf(FEED, NOW).map(f => f.text)]),
  'claude-rows-120.txt': lines([...rowsOf(AGENTS, scene.book, NOW, 118).map(r => r.text), '', '사내 메신저', ...feedRowsOf(FEED, NOW).map(f => f.text)]),
  'plan-96.txt': lines(planText(96)),
  // omp판 입력창 위 패널과 사이드바
  'omp-widget-80.txt': lines(widgetLines(80, scene, null)),
  'omp-widget-140.txt': lines(widgetLines(140, scene, null)),
  'omp-side-48.txt': lines(sideLines(48, scene, null)),
  'omp-side-74-plan.txt': lines(sideLines(74, scene, planLines)),
  'omp-menu-settings-100.txt': lines(menuLines('settings', 100, scene, null)),
  // omp 메뉴 0 사무실: 평면도와 목록(누르면 인사카드)
  'omp-menu-office-100.txt': lines(menuScreen('office', 100, scene, null, { lines: planText, nickAt: () => null }).lines),
  // 대표가 아직 보지 않은 새 지침 후보가 있을 때(채택한 지침을 빼 두면 그 흠이 다시 후보로 오른다): 맨 위 알림 줄
  'omp-widget-140-alert.txt': lines(widgetLines(140, { ...scene, book: { ...scene.book, playbooks: undefined } }, null)),
  'omp-side-48-alert.txt': lines(sideLines(48, { ...scene, book: { ...scene.book, playbooks: undefined } }, null)),
}
// 메뉴 화면(두 판이 같은 블록을 쓴다: Claude Code는 마크다운으로, omp는 이 글 표로)
for (const m of MENU) if (m.view !== 'settings' && m.view !== 'office') shots[`menu-${m.key}-${m.view}.txt`] = lines(textOf(viewBlocks(m.view, scene)).split('\n'))
shots['menu-card-BEAR.txt'] = lines(textOf(viewBlocks('card:BEAR', scene)).split('\n'))

const isCheck = process.argv.includes('--check')
if (!isCheck) mkdirSync(dir, { recursive: true })
let bad = 0
for (const [name, text] of Object.entries(shots)) {
  const path = join(dir, name)
  if (!isCheck) {
    writeFileSync(path, text)
    continue
  }
  const was = existsSync(path) ? readFileSync(path, 'utf8') : null
  if (was === text) continue
  bad++
  console.log(`다름: snapshots/${name}${was === null ? ' (없음)' : ''}`)
  if (was !== null) {
    const a = was.split('\n')
    const b = text.split('\n')
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i] === b[i]) continue
      console.log(`  ${i + 1}줄\n  - ${a[i] ?? ''}\n  + ${b[i] ?? ''}`)
    }
  }
}
if (isCheck) {
  const stale = existsSync(dir) ? readdirSync(dir).filter(f => !(f in shots)) : []
  for (const f of stale) console.log(`남은 스냅샷(지금은 만들지 않음): snapshots/${f}`)
  if (bad > 0 || stale.length > 0) process.exit(1)
  console.log(`스냅샷 ${Object.keys(shots).length}개가 모두 같습니다.`)
} else console.log(`스냅샷 ${Object.keys(shots).length}개를 썼습니다: ${dir}`)
