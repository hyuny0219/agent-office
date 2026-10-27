// 테스트: 인사 제도(부서·직급·평가·교훈·재작업·대표 평가·기록 옮기기).
import { expect, test } from 'claude-code/testing'

import type { HrBook, JobRecord } from '../types'
import { briefOf, deptOf, emptyBook, gradeOf, handOff, hire, leadOf, learn, LESSON_TTL_MS, migrate, patternOf, rankOf, rate, review, rework, REWORK_MS, salaryOf, scoreOf, tipOf } from '../core/hr'
import { cardOf, reportOf } from '../core/report'
import { activityOf } from '../core/scene'
import { fitOf, judgeOf } from '../core/org'

test('도구 이름으로 하는 일을, 에이전트 종류로 부서를 고른다', () => {
  expect(activityOf('Edit')).toBe('type')
  expect(activityOf('Grep')).toBe('read')
  expect(activityOf('Bash')).toBe('bash')
  expect(activityOf('mcp__claude_ai_Exa__web_search_exa')).toBe('web')
  expect(activityOf('Agent')).toBe('spawn')
  expect(activityOf('AskUserQuestion')).toBe('think')
  expect(deptOf('builder')).toBe('dev')
  expect(deptOf('Explore')).toBe('research')
  expect(deptOf('oh-my-claudecode:code-reviewer')).toBe('qa')
  expect(deptOf('oh-my-claudecode:planner')).toBe('plan')
  expect(deptOf('statusline-setup')).toBe('ops')
})

test('인사: 평가 점수·등급, 경력으로 승진, 팀장은 경력 1위, 연봉은 직급+성과+팀장 수당', () => {
  expect(scoreOf({ isDone: true, isKilled: false, errors: 0 })).toBe(13)
  expect(scoreOf({ isDone: true, isKilled: false, errors: 2 })).toBe(8)
  expect(scoreOf({ isDone: false, isKilled: false, errors: 9 })).toBe(-10)
  expect(gradeOf(13)).toBe('S')
  expect(gradeOf(8)).toBe('B')
  let b: HrBook = hire(hire(emptyBook(), 'BEAR', 'dev', 'builder', 1).book, 'PANDA', 'dev', 'general-purpose', 2).book
  const first = review(b, 'BEAR', { isDone: true, isKilled: false, errors: 0 }, 10)
  expect(first.promotedTo).toBeNull()
  const second = review(first.book, 'BEAR', { isDone: true, isKilled: false, errors: 0 }, 20)
  expect(second.promotedTo).toBe('대리')
  b = second.book
  const bear = b.employees.find(e => e.nick === 'BEAR')!
  expect(rankOf(bear.xp).ko).toBe('대리')
  expect(leadOf(b, 'dev')?.nick).toBe('BEAR')
  // 대리 4200 + 평균 13점 × 60 + 팀장 600
  expect(salaryOf(b, bear)).toBe(4200 + 780 + 600)
})

test('교훈: 같은 오류를 묶어 세고, 두 번 이상이면 업무 지시 메모에 피하는 법과 함께 붙는다', () => {
  expect(patternOf('String to replace not found in file.\nString: foo')).toBe('String to replace not found in file.')
  expect(patternOf('ENOENT: no such file /Users/a/b.ts line 12')).toBe('ENOENT: no such file <경로> line #')
  expect(patternOf('ENOENT: no such file C:\\Users\\a\\b.ts line 12')).toBe('ENOENT: no such file <경로> line #')
  expect(tipOf(patternOf("grep : The term 'grep' is not recognized as a name of a cmdlet"))).toContain('Select-String')
  expect(tipOf(patternOf("The token '&&' is not a valid statement separator in this version."))).toContain(';로')
  expect(patternOf('Error:/tmp/x failed')).toBe('Error:<경로> failed')
  expect(tipOf('String to replace not found in file.')).toContain('Read')
  let b = hire(emptyBook(), 'BEAR', 'dev', 'builder', 1).book
  b = learn(b, 'dev', 'Edit', 'String to replace not found in file.', 5)
  const bear = b.employees[0]!
  // 한 번뿐이면 메모에 실수 목록이 없다
  expect(briefOf(b, bear)).not.toContain('반복한 실수')
  b = learn(b, 'dev', 'Edit', 'String to replace not found in file.', 6)
  const brief = briefOf(b, bear) ?? ''
  expect(brief).toContain('담당: 개발팀 BEAR 사원')
  expect(brief).toContain('Edit "String to replace not found in file." 2회 → Edit 전에 바꿀 부분을 Read로')
  expect(brief).toContain('평가 기준')
  expect(briefOf({ ...b, isCoaching: false }, bear)).toBeNull()
})

test('평가: 도구 없이 끝내면 무오류 가산이 없고, 실패한 테스트를 두고 끝내면 깎이며, 감점이 쌓이면 강등된다', () => {
  expect(scoreOf({ isDone: true, isKilled: false, errors: 0, tools: 0 })).toBe(10)
  expect(scoreOf({ isDone: true, isKilled: false, errors: 0, tools: 4, isCheckFailed: true })).toBe(6)
  expect(scoreOf({ isDone: false, isKilled: false, errors: 0, isCheckFailed: true })).toBe(-5)
  let b = hire(emptyBook(), 'BEAR', 'dev', 'builder', 1).book
  b = { ...b, employees: b.employees.map(e => ({ ...e, xp: 22, avgScore: 13 })) }
  const failed = review(b, 'BEAR', { isDone: false, isKilled: false, errors: 3 }, 5)
  expect(failed.score).toBe(-8)
  expect(failed.demotedTo).toBe('사원')
  const bear = failed.book.employees[0]!
  expect(bear.xp).toBe(14)
  // 최근 가중 평균: 13 × 0.7 + (-8) × 0.3
  expect(Math.round((bear.avgScore ?? 0) * 10)).toBe(67)
  expect(review(failed.book, 'BEAR', { isDone: false, isKilled: false, errors: 5 }, 6).book.employees[0]!.xp).toBe(4)
})

test('재작업: 끝낸 직원의 파일을 BOSS가 곧 다시 고치면 한 번만 깎고, 오래 지나면 넘긴다', () => {
  let b = hire(emptyBook(), 'BEAR', 'dev', 'builder', 1).book
  b = review(b, 'BEAR', { isDone: true, isKilled: false, errors: 0, tools: 3 }, 100).book
  b = handOff(b, { agentId: 'a1', nick: 'BEAR', files: ['/r/a.ts'], endedAt: 100, job: 1 })
  expect(rework(b, '/r/other.ts', 200).nick).toBeNull()
  const hit = rework(b, '/r/a.ts', 200)
  expect(hit.nick).toBe('BEAR')
  const bear = hit.book.employees[0]!
  expect(bear.reworks).toBe(1)
  expect(bear.xp).toBe(9)
  expect(bear.lastScore).toBe(9)
  expect(rework(hit.book, '/r/a.ts', 300).nick).toBeNull()
  // 오래 지난 인계 기록은 버린다
  const late = rework(b, '/r/a.ts', 100 + REWORK_MS + 1)
  expect(late.nick).toBeNull()
  expect(late.book.handoffs).toHaveLength(0)
  // 그 뒤에 일을 하나 더 했으면 최근 평가는 그대로 두고, 평균은 줄어든 무게만큼만 고친다
  const next = review(b, 'BEAR', { isDone: true, isKilled: false, errors: 0, tools: 1 }, 150).book
  const after = rework(next, '/r/a.ts', 200).book.employees[0]!
  expect(after.lastScore).toBe(13)
  expect(Math.round((after.avgScore ?? 0) * 100)).toBe(Math.round((13 - 4 * 0.3 * 0.7) * 100))
  // 명부에 없는 직원이면 깎았다고 하지 않는다
  expect(rework({ ...b, employees: [] }, '/r/a.ts', 200).nick).toBeNull()
})

test('교훈: 잦은 옛 실수 8개가 자리를 차지해도 새 실수를 배우고, 2주 넘게 안 난 실수는 메모에서 뺀다', () => {
  let b = hire(emptyBook(), 'BEAR', 'dev', 'builder', 1).book
  for (let i = 0; i < 8; i++) for (let k = 0; k < 3; k++) b = learn(b, 'dev', 'Bash', `old failure kind ${'abcdefgh'[i]}`, 10 + i)
  b = learn(b, 'dev', 'Edit', 'String to replace not found in file.', 100)
  b = learn(b, 'dev', 'Edit', 'String to replace not found in file.', 101)
  const lessons = b.lessons.dev ?? []
  expect(lessons).toHaveLength(8)
  expect(lessons.some(l => l.tool === 'Edit' && l.count === 2)).toBe(true)
  const bear = b.employees[0]!
  expect(briefOf(b, bear, 102)).toContain('String to replace not found')
  expect(briefOf(b, bear, 101 + LESSON_TTL_MS + 1)).not.toContain('반복한 실수')
})

test('예전 판(version 1) 인사 기록을 비우지 않고 지금 형식으로 옮긴다', () => {
  const old = { version: 1, isCoaching: false, lessons: { dev: [] }, employees: [{ nick: 'BEAR', dept: 'dev', type: 'builder', xp: 30, jobs: 3, done: 3, failed: 0, toolErrors: 1, avgScore: 11, lastScore: 12, hiredAt: 1, lastAt: 2 }] }
  const b = migrate(old)!
  expect(b.version).toBe(2)
  expect(b.isCoaching).toBe(false)
  expect(b.handoffs).toEqual([])
  expect(b.employees[0]).toMatchObject({ nick: 'BEAR', xp: 30, reworks: 0 })
  // 알 수 없는 부서·이상한 칸은 고쳐서 받는다
  const odd = migrate({ employees: [{ nick: 'X', dept: 'sales', xp: null }], lessons: { dev: 'x' }, handoffs: [{ agentId: 'a' }], future: 1 })!
  expect(odd.employees[0]).toMatchObject({ dept: 'ops', xp: 0 })
  expect(odd.lessons.dev).toBeUndefined()
  expect(odd.handoffs).toEqual([])
  expect((odd as unknown as { future: number }).future).toBe(1)
  expect(migrate(undefined)).toBeNull()
  expect(migrate({ version: 1 })).toBeNull()
})

test('대표 평가: 좋음 +3·아쉬움 -3을 점수·경력·평균에 반영하고, 바꾸면 차이만큼, 거두면 되돌리며, 결재 정확도와 적임자 배정에 쓴다', () => {
  let b = hire(emptyBook(), 'BEAR', 'dev', 'builder', 0).book
  b = review(b, 'BEAR', { isDone: true, isKilled: false, errors: 0, tools: 5, isCheckFailed: false }, 1000).book
  const rec: JobRecord = { nick: 'BEAR', dept: 'dev', job: 1, description: '빌드 고치기', startedAt: 0, endedAt: 1000, outcome: 'done', score: 13, errors: 0, isCheckFailed: false, isReworked: false, alarms: 0, approval: 'approved', approver: 'BOSS' }
  b = { ...b, log: [rec] }
  const xp0 = b.employees[0]?.xp ?? 0
  const good = rate(b, 'BEAR', 1, 'good').book
  expect([good.log[0]?.score, good.log[0]?.bossRating, good.employees[0]?.xp]).toEqual([16, 'good', xp0 + 3])
  // 좋음 → 아쉬움은 -6, 거두면 처음으로
  const bad = rate(good, 'BEAR', 1, 'bad').book
  expect([bad.log[0]?.score, bad.log[0]?.bossRating, bad.employees[0]?.xp]).toEqual([10, 'bad', xp0 - 3])
  const cleared = rate(bad, 'BEAR', 1, null).book
  expect([cleared.log[0]?.score, 'bossRating' in (cleared.log[0] ?? {}), cleared.employees[0]?.xp]).toEqual([13, false, xp0])
  expect(Math.abs((cleared.employees[0]?.avgScore ?? 0) - (b.employees[0]?.avgScore ?? 0)) < 1e-9).toBe(true)
  // 없는 일은 그대로
  expect(rate(b, 'BEAR', 9, 'good').book).toBe(b)
  // 결재 정확도: 승인한 일에 아쉬움이면 놓친 승인, 반려한 일에 좋음이면 빗나간 반려(파일을 안 고친 일도, 지켜보는 중이어도)
  expect(judgeOf({ ...rec, bossRating: 'bad' }, 1000)).toBe('missed')
  expect(judgeOf({ ...rec, bossRating: 'good' }, 1000)).toBe('right-approve')
  expect(judgeOf({ ...rec, approval: 'rejected', bossRating: 'good' }, 1000)).toBe('doubtful')
  expect(judgeOf({ ...rec, approval: 'rejected', bossRating: 'bad' }, 1000)).toBe('right-reject')
  expect(judgeOf(rec, 1000)).toBeNull()
  // 적임자 배정: 아쉬움 받은 일은 잘 끝낸 일이 아니다
  expect(fitOf(b, b.employees[0]!, '빌드 고치기').similar).toBe(1)
  expect(fitOf(bad, bad.employees[0]!, '빌드 고치기').slips).toBe(1)
  // 보고서·인사카드에 보인다
  expect(reportOf(bad, 'today', 2000)).toContain('대표 아쉬움 1')
  expect(cardOf(bad, bad.employees[0]!, 2000)).toMatch(/빌드 고치기\s+완료\s+A\(\+10\)\s+아쉬움/)
  // 저장했다 읽어도 남는다
  expect(migrate(JSON.parse(JSON.stringify(bad))).log[0]?.bossRating).toBe('bad')
})
