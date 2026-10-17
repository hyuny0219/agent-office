import { expect, test } from 'claude-code/testing'

import type { HrBook, JobRecord, OfficeAgent } from '../types'
import { briefOf, deptOf, emptyBook, gradeOf, handOff, hire, isMuted, leadOf, learn, LESSON_TTL_MS, lessonKey, migrate, RETEST_MS, patternOf, rankOf, review, rework, REWORK_MS, salaryOf, scoreOf, tipOf } from './hr'
import { agoText, cardOf, durationText, findEmployee, jobsIn, reportOf } from './report'
import { CONTROL_EVERY, effectText, enroll, markHit, MIN_CONTROL, MIN_MEMO, settle, verdictOf } from './trial'
import { callKeyOf, errorKeyOf, isAlarm, isOvertime, isPolling, nudgeOf, OVERTIME_MS, stepOf } from './watch'
import { activityOf, encodeCells, koNick, layoutOf, nickFor, Office, PLAN_ROWS } from './scene'

const agent = (id: string, over: Partial<OfficeAgent> = {}): OfficeAgent => ({
  id, type: 'builder', nick: 'BEAR', dept: 'dev', description: '빌드', model: null, startedAt: 0, endedAt: null, activity: 'type', tool: 'Edit', tools: 3, ...over,
})
const boss = agent('main', { type: 'main', nick: 'BOSS', dept: undefined, activity: 'think' })

/** 사람들이 다 걸어갈 때까지 프레임을 돌린다 */
const run = (office: Office, agents: OfficeAgent[], frames: number, now = 0) => {
  let words: Uint32Array = new Uint32Array()
  for (let f = 0; f < frames; f++) words = office.draw(agents, f, now)
  return words
}
const rowOf = (words: Uint32Array, columns: number, cy: number) =>
  Array.from({ length: columns }, (_, cx) => String.fromCharCode(words[(cy * columns + cx) * 3] ?? 0)).join('')
const screen = (words: Uint32Array, columns: number) => Array.from({ length: PLAN_ROWS }, (_, cy) => rowOf(words, columns, cy)).join('\n')

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

test('별칭: 종류별 별칭을 먼저 주고, 이미 쓴 별칭은 피하며, 다 쓰면 번호를 붙인다', () => {
  expect(nickFor('main', [])).toBe('BOSS')
  expect(nickFor('Explore', [])).toBe('OWL')
  expect(nickFor('oh-my-claudecode:executor', [])).toBe('BEAR')
  expect(nickFor('builder', [agent('a')])).not.toBe('BEAR')
  const names = ['OWL', 'BEAR', 'HAWK', 'FOX', 'CAT', 'CRANE', 'OTTER', 'WHALE', 'PANDA', 'TIGER', 'KOALA', 'WOLF', 'DEER', 'SEAL', 'MOLE', 'LYNX']
  expect(nickFor('builder', names.map((nick, i) => agent(`x${i}`, { nick })))).toBe('OWL2')
  expect(koNick('OWL2')).toBe('부엉이2')
  expect(koNick('BOSS')).toBe('보스')
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

test('근태: 같은 것을 연달아 세고, 문턱과 그 배수마다 알리며, 호출 열쇠는 겉봉 칸을 빼고 입력만 본다', () => {
  let s = stepOf(undefined, 'a')
  s = stepOf(s, 'a')
  expect(isAlarm(s, 3)).toBe(false)
  s = stepOf(s, 'a')
  expect(isAlarm(s, 3)).toBe(true)
  expect(isAlarm(stepOf(s, 'a'), 3)).toBe(false)
  expect(stepOf(s, 'b')).toEqual({ key: 'b', count: 1 })
  expect(callKeyOf({ tool: 'Read', file_path: '/a', agentId: 'x', tool_use_id: '1' })).toBe(callKeyOf({ tool: 'Read', agentId: 'y', tool_use_id: '2', file_path: '/a' }))
  expect(callKeyOf({ tool: 'Read', file_path: '/a' })).not.toBe(callKeyOf({ tool: 'Read', file_path: '/b' }))
  // 경로·숫자만 다른 오류는 같은 실수
  expect(errorKeyOf('Read', 'ENOENT: no such file /a/b line 3')).toBe(errorKeyOf('Read', 'ENOENT: no such file /c line 9'))
  // Bash는 "Exit code N" 줄을 건너뛰고 명령 이름으로 가른다
  expect(errorKeyOf('Bash', 'Exit code 1\nFAIL src/a.test.ts', { command: 'npm test' })).toBe('Bash|npm: FAIL src<경로>')
  expect(errorKeyOf('Bash', 'Exit code 1', { command: 'grep foo .' })).not.toBe(errorKeyOf('Bash', 'Exit code 1', { command: 'CI=1 npm test' }))
  expect(errorKeyOf('Bash', 'Exit code 1', { command: 'CI=1 npm test' })).toBe('Bash|npm: ')
  const nudge = nudgeOf('error', 'Edit', { key: errorKeyOf('Edit', 'String to replace not found in file.'), count: 3 })
  expect(nudge).toContain('같은 오류가 3번 연달아')
  expect(nudge).toContain('Read로 다시 읽어')
  expect(nudge).toContain('보고하고 끝내세요')
  expect(isPolling('TaskGet')).toBe(true)
  expect(isPolling('Grep')).toBe(false)
  expect(isOvertime(0, null, OVERTIME_MS)).toBe(true)
  expect(isOvertime(0, 5, OVERTIME_MS)).toBe(false)
})

test('교육 효과: 순번으로 비교군을 두고, 근거가 모여야 판정하며, 효과 없는 실수는 2주 동안만 빼고 다시 잰다', () => {
  let b = hire(emptyBook(), 'BEAR', 'dev', 'builder', 1).book
  b = learn(learn(b, 'dev', 'Edit', 'String to replace not found in file.', 5), 'dev', 'Edit', 'String to replace not found in file.', 6)
  const lesson = b.lessons.dev![0]!
  const key = lessonKey(lesson)
  expect(enroll(b, [])).toBeNull()
  expect(enroll({ ...b, isTrialing: false }, [key])).toBeNull()
  const arms: string[] = []
  for (let i = 0; i < CONTROL_EVERY; i++) {
    const r = enroll(b, [key])!
    arms.push(r.arm)
    b = r.book
  }
  expect(arms).toEqual(['memo', 'memo', 'memo', 'memo', 'control'])
  expect(markHit({ arm: 'memo', keys: [key], hits: [] }, 'Bash|other').hits).toEqual([])

  const run = (book: HrBook, memoHits: number, controlHits: number, at: number) => {
    for (let i = 0; i < MIN_MEMO; i++) book = settle(book, { arm: 'memo', keys: [key], hits: i < memoHits ? [key] : [] }, at)
    for (let i = 0; i < MIN_CONTROL; i++) book = settle(book, { arm: 'control', keys: [key], hits: i < controlHits ? [key] : [] }, at)
    return book
  }
  // 드문 실수(둘 다 재발 없음)나 비교군 재발이 적으면 모른다: 근거 없이 빼지 않는다
  expect(verdictOf(run(b, 0, 0, 10).trials[key])).toBe('unknown')
  expect(verdictOf(run(b, 5, 1, 10).trials[key])).toBe('unknown')
  // 메모군 재발이 더 적으면 효과 있음
  expect(verdictOf(run(b, 1, 3, 10).trials[key])).toBe('effective')

  // 붙여도 비교군만큼 재발: 효과 없음 → 2주 동안 메모에서 빠진다
  const bad = run(b, 6, 3, 10)
  expect(verdictOf(bad.trials[key])).toBe('ineffective')
  expect(bad.trials[key]?.ineffectiveAt).toBe(10)
  expect(isMuted(bad, lesson, 11)).toBe(true)
  expect(effectText(bad.trials[key], true)).toContain('효과 없음(2주 동안 메모에서 뺀 뒤 다시 잼): 메모 10건 중 재발 6(60%) / 비교군 5건 중 재발 3(60%)')
  expect(briefOf(bad, bad.employees[0]!, 11)).not.toContain('반복한 실수')
  // 측정을 끄면 다시 붙는다
  expect(briefOf({ ...bad, isTrialing: false }, bad.employees[0]!, 11)).toContain('반복한 실수')
  // 2주가 지나면 다시 붙고, 다음 집계는 처음부터 센다
  expect(isMuted(bad, lesson, 10 + RETEST_MS)).toBe(false)
  const again = settle(bad, { arm: 'memo', keys: [key], hits: [] }, 10 + RETEST_MS)
  expect(again.trials[key]).toEqual({ memo: { jobs: 1, hits: 0 }, control: { jobs: 0, hits: 0 }, lastAt: 10 + RETEST_MS })

  // 교훈이 밀려나도 측정 기록은 남는다
  let evicted = bad
  for (let i = 0; i < 8; i++) evicted = learn(evicted, 'dev', 'Bash', `other ${'abcdefgh'[i]}`, 100 + i)
  expect(evicted.lessons.dev!.some(l => lessonKey(l) === key)).toBe(false)
  expect(evicted.trials[key]).toBeDefined()

  // 망가진 측정 기록도 고쳐 받는다
  const odd = migrate({ employees: [], trials: { [key]: { memo: {}, lastAt: 'x' }, bad: 3 } })!
  expect(odd.trials).toEqual({ [key]: { memo: { jobs: 0, hits: 0 }, control: { jobs: 0, hits: 0 }, lastAt: 0 } })
})

test('보고서·인사카드: 기간 안 일만 모아 부서별 실적·MVP·살펴볼 일을 내고, 재작업은 그 일의 기록에도 적힌다', () => {
  const H = 60 * 60_000
  const now = 10 * 24 * H
  const job = (over: Partial<JobRecord>): JobRecord => ({
    nick: 'BEAR', dept: 'dev', job: 1, description: '빌드', startedAt: now - H, endedAt: now - 30 * 60_000, outcome: 'done',
    score: 13, errors: 0, isCheckFailed: false, isReworked: false, alarms: 0, ...over,
  })
  let b: HrBook = hire(hire(emptyBook(), 'BEAR', 'dev', 'builder', 0).book, 'OWL', 'research', 'Explore', 0).book
  b = review(b, 'BEAR', { isDone: true, isKilled: false, errors: 0 }, now).book
  b = { ...b, log: [
    job({ job: 2, description: '고치기', score: 3, errors: 3, isCheckFailed: true, alarms: 1 }),
    job({ nick: 'OWL', dept: 'research', description: '조사', outcome: 'failed', score: -5, startedAt: now - 3 * H, endedAt: now - 2 * H }),
    job({}),
    // 8일 전: 주간 보고에도 들지 않는다
    job({ description: '옛일', startedAt: now - 8 * 24 * H - H, endedAt: now - 8 * 24 * H }),
  ] }
  expect(jobsIn(b, 'today', now)).toHaveLength(3)
  expect(jobsIn(b, 'week', now)).toHaveLength(3)
  const today = reportOf(b, 'today', now)
  expect(today).toContain('에이전트 사무실 일간 보고 (최근 24시간)')
  expect(today).toContain('전체: 업무 3건 · 완료 2 / 실패 1(완료율 67%)')
  expect(today).toContain('근무 2시간')
  expect(today).toContain('개발팀: 2건 · 완료 2 / 실패 0(완료율 100%) · 평균 평가 B(8.0) · 도구 오류 3 · 테스트 실패 완료 1 · 근태 알림 1')
  expect(today).toContain('조사팀: 1건')
  expect(today).toContain('MVP: BEAR 곰 사원 (2건, 평가 합계 +16)')
  expect(today).toContain('살펴볼 일(2건):')
  expect(today).toContain('BEAR 고치기: 테스트·빌드 실패한 채 완료 · 근태 알림 1 · 평가 C(+3)')
  expect(today).toContain('OWL 조사: 실패')
  expect(today).not.toContain('옛일')
  expect(reportOf(emptyBook(), 'week', now)).toContain('이 기간에 끝낸 업무가 없습니다.')

  // 재작업은 그 일(같은 직원·같은 순번)의 기록에도 적는다
  b = handOff(b, { agentId: 'x', nick: 'BEAR', files: ['/r/a.ts'], endedAt: now, job: 2 })
  b = rework(b, '/r/a.ts', now + 1000).book
  expect(b.log[0]?.isReworked).toBe(true)
  expect(b.log[0]?.score).toBe(-1)
  expect(b.log[2]?.isReworked).toBe(false)

  expect(findEmployee(b, 'bear')?.nick).toBe('BEAR')
  expect(findEmployee(b, '부엉이')?.nick).toBe('OWL')
  expect(findEmployee(b, 'NOBODY')).toBeUndefined()
  const card = cardOf(b, findEmployee(b, 'BEAR') as never, now)
  expect(card).toContain('인사카드: BEAR 곰 — 개발팀 사원 · 팀장 (builder)')
  expect(card).toContain('대리까지')
  expect(card).toContain('+ 팀장 수당 600')
  expect(card).toContain('최근 업무:')
  expect(card).toContain('고치기 · 완료 D(-1) · 30분 · 도구 오류 3 · 테스트·빌드 실패한 채 완료 · 재작업 · 근태 알림 1')
  expect(card).not.toContain('조사')
  expect(cardOf(b, findEmployee(b, 'OWL') as never, now)).toContain('아직 끝낸 업무가 없습니다')

  expect(durationText(40_000)).toBe('40초')
  expect(durationText(-5 * 60_000)).toBe('0초')
  // 그때 연봉을 적어 두면 인건비는 그것으로 잰다(나중에 승진해도 지난 일 값이 바뀌지 않는다): 3600만원/2080시간 × 1시간
  expect(reportOf({ ...b, log: [job({ startedAt: now - 2 * H, endedAt: now - H, salary: 3600 })] }, 'today', now)).toContain('인건비 약 17,308원')
  expect(durationText(80 * 60_000)).toBe('1시간 20분')
  expect(agoText(now - 3 * H, now)).toBe('3시간 전')
  // 예전 기록에는 log가 없다: 빈 목록으로 채우고, 망가진 칸은 버린다
  expect(migrate({ employees: [] })?.log).toEqual([])
  expect(migrate({ employees: [], log: [job({}), { nick: 'X' }, null] })?.log).toHaveLength(1)
  // 모르는 부서(더 새 판)는 지원팀으로 살리고, 망가진 연봉 칸은 버린다
  const moved = migrate({ employees: [], log: [{ ...job({}), dept: 'future', salary: 'x' }] })?.log[0]
  expect(moved?.dept).toBe('ops')
  expect(moved?.salary).toBeUndefined()
})

test('평면도: 방 표지, 부서 섬 표지와 명패, 셀 인코딩', () => {
  const layout = layoutOf(96)
  expect(layout).toEqual({ columns: 96, rows: PLAN_ROWS })
  expect(layoutOf(30).columns).toBe(72)
  const office = new Office(layout)
  const words = run(office, [boss, agent('a1'), agent('a2', { nick: 'HAWK', dept: 'qa', type: 'reviewer' })], 2)
  expect(words.length).toBe(96 * PLAN_ROWS * 3)
  const all = screen(words, 96)
  expect(rowOf(words, 96, 0)).toContain('AGENT OFFICE  working 2')
  for (const name of ['CEO', 'MEETING', 'LIBRARY', 'SERVER', 'WC']) expect(rowOf(words, 96, 1)).toContain(name)
  for (const name of ['OFFICE', 'PANTRY']) expect(rowOf(words, 96, 13)).toContain(name)
  expect(all).toContain('DEV')
  expect(all).toContain('QA')
  // 팀원 책상 명패(팀장이 정해지지 않았으면 팀원 자리)
  expect(all).toContain('BEAR')
  expect(all).toContain('HAWK')
  // 팀장이면 팀장 책상(6칸)에 앉는다
  const leadWords = new Office(layout).draw([boss, agent('a1')], 0, 0, { dev: 'BEAR' })
  expect(screen(leadWords, 96)).toContain('BEAR  ')
  expect(encodeCells(words).length).toBe(Math.ceil((words.length * 4) / 3) * 4)
})

test('하는 일에 따라 방을 옮기고, 새 사람은 입구에서 걸어 들어온다', () => {
  const office = new Office(layoutOf(96))
  run(office, [boss, agent('a1')], 1)
  expect(office.whereIs('main')?.room).toBe('ceo')
  expect(office.whereIs('a1')?.room).toBe('office')
  const owl = agent('a2', { nick: 'OWL', type: 'Explore', dept: 'research', activity: 'read', tool: 'Grep' })
  run(office, [boss, agent('a1'), owl], 1)
  expect(office.whereIs('a2')).toEqual({ room: 'corridor', isMoving: true })
  run(office, [boss, agent('a1'), owl], 80)
  expect(office.whereIs('a2')).toEqual({ room: 'library', isMoving: false })
  run(office, [boss, agent('a1', { activity: 'bash', tool: 'Bash' }), owl], 80)
  expect(office.whereIs('a1')).toEqual({ room: 'server', isMoving: false })
  // 기다리는 동안에만 쉰다(탕비실·화장실)
  run(office, [boss, agent('a1', { activity: 'idle' }), owl], 80)
  expect(['pantry', 'wc']).toContain(office.whereIs('a1')?.room)
})

test('대화하면 회의실에 모이고, 끝내면 보고한 뒤 입구로 퇴근한다', () => {
  const office = new Office(layoutOf(96))
  run(office, [boss, agent('a1')], 1, 0)
  const talking = [boss, agent('a1')].map(a => ({ ...a, meetUntil: 10_000 }))
  run(office, talking, 80, 1000)
  expect(office.whereIs('main')).toEqual({ room: 'meet', isMoving: false })
  expect(office.whereIs('a1')).toEqual({ room: 'meet', isMoving: false })
  expect(rowOf(run(office, talking, 1, 1000), 96, 0)).toContain('meeting 2')
  run(office, [boss, agent('a1')], 80, 20_000)
  expect(office.whereIs('main')?.room).toBe('ceo')
  expect(office.whereIs('a1')?.room).toBe('office')
  const done = agent('a1', { activity: 'done', endedAt: 30_000, meetUntil: 38_000 })
  run(office, [boss, done], 80, 31_000)
  expect(office.whereIs('a1')?.room).toBe('meet')
  run(office, [boss, done], 100, 40_000)
  expect(office.whereIs('a1')).toBeNull()
})

const PROPS = { title: '에이전트 사무실', isFocused: false, bodyColumns: 96, placement: 'dock', scroll: { offset: 0, bodyRows: 50 }, view: {} } as const
const RUN = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } } as const
const SPAWN = { provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5', background: true, fork: false } as const

test('서브에이전트가 뜨면 부서 직원에게 맡기고, 업무 지시에 인사 메모를 붙이며, 끝나면 평가한다', async ($, on) => {
  const store = new Map<string, unknown>()
  on('store.get', (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', (_$, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('clock.now', () => ({ value: 65_000 }))
  let prompt = ''
  on('agent.spawn', (_$, e) => {
    prompt = e.prompt
    return { model: 'claude-sonnet-5-5', agentId: 'a1' }
  })
  let status: 'running' | 'completed' = 'running'
  on('agent.list', () => ({ value: [{ id: 'a1', description: 'T139 빌드', type: 'builder', status }] }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  const toasts: string[] = []
  on('ui.toast', (_$, e) => {
    toasts.push(JSON.stringify(e))
    return { value: undefined }
  })
  let peek: () => Promise<string> = async () => ''
  let during = ''
  on('tool.call', async () => {
    during = await peek()
    return { result: 'ok' }
  })
  on('turn.complete', () => ({ text: '' }))

  await $.agent.spawn({ tool_use_id: 't1', prompt: '만들어', description: 'T139 빌드', subagentType: 'builder', ...SPAWN })
  expect(prompt).toContain('만들어\n\n[사내 인사 메모 · agent-office]')
  expect(prompt).toContain('담당: 개발팀 BEAR 사원')
  const opened = await $.command.run({ command: 'office', args: '', ...RUN })
  expect(JSON.stringify(opened)).toContain('열었습니다')

  const ui = await $.ui.mount({ plugin: 'agent-office', surface: 'terminal', component: 'Pane', requestId: 'agent-office', props: PROPS, viewport: { columns: 96, rows: 50 } })
  expect((await ui.find({ key: 'row-a1' }))?.text).toContain('BEAR 곰 사원 (개발팀) · 회의실: 보스와 대화')
  expect((await ui.find({ key: 'row-main' }))?.text).toContain('BOSS 보스 대표 · 회의실: 곰과 대화')
  expect(await ui.find({ type: 'Raster' })).toBeDefined()

  peek = async () => (await ui.find({ key: 'row-a1' }))?.text ?? ''
  await $.tool.call({ tool: 'Bash', command: 'ls', agentId: 'a1' })
  expect(during).toContain('도구 1회')

  // 끝나면 평가(오류 없이 완료 S +13) 토스트와 인사 기록
  status = 'completed'
  await $.turn.complete({ answer: '끝', durationMs: 1, isAborted: false, turnId: 'x', agentId: 'a1', reason: 'answer' })
  expect(toasts.join()).toContain('BEAR 사원 평가 S (+13)')
  const roster = JSON.stringify(await $.command.run({ command: 'office', args: 'hr', ...RUN }))
  expect(roster).toContain('개발팀 — 팀장 BEAR(곰)')
  expect(roster).toContain('완료 1 / 실패 0')
  const report = JSON.stringify(await $.command.run({ command: 'office', args: 'report', ...RUN }))
  expect(report).toContain('업무 1건 · 완료 1 / 실패 0')
  expect(report).toContain('MVP: BEAR 곰')
  expect(JSON.stringify(await $.command.run({ command: 'office', args: 'report week', ...RUN }))).toContain('주간 보고')
  expect(JSON.stringify(await $.command.run({ command: 'office', args: 'report month', ...RUN }))).toContain('쓰는 법')
  expect(JSON.stringify(await $.command.run({ command: 'office', args: 'report WEEK', ...RUN }))).toContain('주간 보고')
  expect(JSON.stringify(await $.command.run({ command: 'office', args: 'hr ab', ...RUN }))).toContain('쓰는 법: /office hr ab on|off')
  const card = JSON.stringify(await $.command.run({ command: 'office', args: 'hr bear', ...RUN }))
  expect(card).toContain('인사카드: BEAR 곰')
  expect(card).toContain('T139 빌드 · 완료 S(+13)')
  expect(JSON.stringify(await $.command.run({ command: 'office', args: 'hr NOBODY', ...RUN }))).toContain('NOBODY라는 직원이 없습니다')
})

test('테스트가 실패한 채 끝내면 깎이고, 끝낸 파일을 BOSS가 다시 고치면 재작업으로 깎인다', async ($, on) => {
  const store = new Map<string, unknown>()
  on('store.get', (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', (_$, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('clock.now', () => ({ value: 1000 }))
  on('agent.spawn', () => ({ model: 'm', agentId: 'b1' }))
  let status: 'running' | 'completed' = 'running'
  on('agent.list', () => ({ value: [{ id: 'b1', description: '고치기', type: 'builder', status }] }))
  const toasts: string[] = []
  on('ui.toast', (_$, e) => {
    toasts.push(JSON.stringify(e))
    return { value: undefined }
  })
  on('tool.call', (_$, e) => {
    const f = (e as { file_path?: string }).file_path
    if (f === '/r/denied.ts' || (e as { new_string?: string }).new_string === 'DENY') return { deny: '사용자가 거절함' }
    return e.tool === 'Bash' ? { result: 'exit 1', isError: true } : { result: 'ok' }
  })
  on('turn.complete', () => ({ text: '' }))

  await $.agent.spawn({ tool_use_id: 't3', prompt: '고쳐', description: '고치기', subagentType: 'builder', ...SPAWN })
  await $.tool.call({ tool: 'Edit', file_path: '/r/a.ts', old_string: 'a', new_string: 'b', agentId: 'b1' })
  await $.tool.call({ tool: 'Edit', file_path: '/r/denied.ts', old_string: 'a', new_string: 'b', agentId: 'b1' })
  await $.tool.call({ tool: 'Bash', command: 'npm test', agentId: 'b1' })
  // 테스트가 아닌 명령의 실패는 검증 결과를 바꾸지 않는다
  await $.tool.call({ tool: 'Bash', command: 'grep -r foo .', agentId: 'b1' })
  status = 'completed'
  await $.turn.complete({ answer: '끝', durationMs: 1, isAborted: false, turnId: 'y', agentId: 'b1', reason: 'answer' })
  // 완료 10 - 도구 오류 3(거절·npm test·grep) - 테스트 실패 4
  expect(toasts.join()).toContain('BEAR 사원 평가 C (+3) · 테스트·빌드 실패한 채 완료 -4')

  // 거절된 수정은 고친 게 아니다: 직원 쪽이든 BOSS 쪽이든 재작업이 아니다
  await $.tool.call({ tool: 'Edit', file_path: '/r/denied.ts', old_string: 'b', new_string: 'c' })
  await $.tool.call({ tool: 'Edit', file_path: '/r/a.ts', old_string: 'b', new_string: 'DENY' })
  expect(toasts.join()).not.toContain('다시 고쳤습니다')
  await $.tool.call({ tool: 'Edit', file_path: '/r/a.ts', old_string: 'b', new_string: 'c' })
  expect(toasts.join()).toContain('BOSS가 BEAR의 작업(a.ts)을 다시 고쳤습니다 · 재작업 -4')
  const roster = JSON.stringify(await $.command.run({ command: 'office', args: 'hr', ...RUN }))
  expect(roster).toContain('재작업 1')
})

test('같은 실수를 연달아 하면 알리고 그 직원에게 근태 알림을 붙이며, 제자리걸음·야근도 알린다', async ($, on) => {
  const store = new Map<string, unknown>()
  on('store.get', (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', (_$, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  let clock = 1000
  on('clock.now', () => ({ value: clock }))
  on('agent.spawn', () => ({ model: 'm', agentId: 'c1' }))
  on('agent.list', () => ({ value: [{ id: 'c1', description: '고치기', type: 'builder', status: 'running' }] }))
  const toasts: string[] = []
  on('ui.toast', (_$, e) => {
    toasts.push(JSON.stringify(e))
    return { value: undefined }
  })
  on('tool.call', (_$, e) => (e.tool === 'Edit' ? { result: 'x', isError: true, text: 'String to replace not found in file.' } : { result: 'ok' }))
  on('turn.complete', () => ({ text: '' }))
  await $.agent.spawn({ tool_use_id: 't4', prompt: '고쳐', description: '고치기', subagentType: 'builder', ...SPAWN })

  const edit = { tool: 'Edit', file_path: '/r/a.ts', old_string: 'a', new_string: 'b', agentId: 'c1' } as const
  const first = await $.tool.call(edit)
  expect(first.context ?? []).toHaveLength(0)
  await $.tool.call({ tool: 'Read', file_path: '/r/a.ts', agentId: 'c1' })
  await $.tool.call({ ...edit, old_string: 'c' })
  const third = await $.tool.call({ ...edit, old_string: 'd' })
  expect(toasts.join()).toContain('BEAR가 같은 실수를 3번 연달아 하고 있습니다: Edit')
  expect((third.context ?? []).join()).toContain('[사내 근태 알림 · agent-office] 같은 오류가 3번 연달아')

  // 같은 입력의 Grep을 네 번: 제자리걸음
  for (let i = 0; i < 3; i++) await $.tool.call({ tool: 'Grep', pattern: 'foo', agentId: 'c1' })
  const fourth = await $.tool.call({ tool: 'Grep', pattern: 'foo', agentId: 'c1' })
  expect(toasts.join()).toContain('같은 Grep를 같은 입력으로 4번')
  expect((fourth.context ?? []).join()).toContain('결과는 바뀌지 않습니다')

  // 코칭을 끄면 토스트만 남기고 직원에게는 붙이지 않는다
  await $.command.run({ command: 'office', args: 'hr off', ...RUN })
  for (let i = 0; i < 3; i++) await $.tool.call({ tool: 'Grep', pattern: 'bar', agentId: 'c1' })
  const quiet = await $.tool.call({ tool: 'Grep', pattern: 'bar', agentId: 'c1' })
  expect(quiet.context ?? []).toHaveLength(0)
  expect(JSON.stringify(await $.command.run({ command: 'office', args: 'hr', ...RUN }))).toContain('근태 알림 3')

  clock += OVERTIME_MS
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 'z', agentId: 'c1', reason: 'answer' })
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 'z2', agentId: 'c1', reason: 'answer' })
  expect(toasts.filter(t => t.includes('20분째 야근 중')).length).toBe(1)
})

test('근태 경계: 폴링은 알림을 다시 울리지 않고, 거절은 세지 않으며, 나란히 난 오류도 정확히 한 번 알리고, 끝난 사람은 야근이 아니다', async ($, on) => {
  const store = new Map<string, unknown>()
  on('store.get', (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', (_$, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  let clock = 1000
  on('clock.now', () => ({ value: clock }))
  let n = 0
  on('agent.spawn', () => ({ model: 'm', agentId: `d${++n}` }))
  const status: Record<string, 'running' | 'completed'> = { d1: 'running', d2: 'running' }
  on('agent.list', () => ({ value: Object.entries(status).map(([id, s]) => ({ id, description: id, type: 'builder', status: s })) }))
  const toasts: string[] = []
  on('ui.toast', (_$, e) => {
    toasts.push(JSON.stringify(e))
    return { value: undefined }
  })
  on('tool.call', async (_$, e) => {
    await Promise.resolve()
    if (e.tool === 'Write') return { deny: '사용자가 거절함' }
    return e.tool === 'Edit' ? { result: 'x', isError: true, text: 'String to replace not found in file.' } : { result: 'ok' }
  })
  on('turn.complete', () => ({ text: '' }))
  await $.agent.spawn({ tool_use_id: 't5', prompt: 'a', description: 'd1', subagentType: 'builder', ...SPAWN })
  await $.agent.spawn({ tool_use_id: 't6', prompt: 'b', description: 'd2', subagentType: 'builder', ...SPAWN })
  const count = (s: string) => toasts.filter(t => t.includes(s)).length

  // 거절 세 번: 실수가 아니다
  for (let i = 0; i < 3; i++) await $.tool.call({ tool: 'Write', file_path: `/r/${i}.ts`, content: '', agentId: 'd1' })
  expect(count('같은 실수')).toBe(0)

  // 나란히 실패한 Edit 셋: 알림은 정확히 한 번
  await Promise.all([1, 2, 3].map(i => $.tool.call({ tool: 'Edit', file_path: '/r/a.ts', old_string: `${i}`, new_string: 'b', agentId: 'd1' })))
  expect(count('같은 실수를 3번')).toBe(1)

  // 같은 입력으로 되풀이해 실패하는 Edit: 오류 알림만, 제자리걸음은 겹쳐 울리지 않는다
  const same = { tool: 'Edit', file_path: '/r/s.ts', old_string: 'z', new_string: 'b', agentId: 'd2' } as const
  for (let i = 0; i < 4; i++) await $.tool.call(same)
  expect(count('같은 Edit를')).toBe(0)
  expect(count('같은 실수를 3번')).toBe(2)

  // Grep 네 번 뒤 폴링: 제자리걸음 알림은 한 번뿐
  for (let i = 0; i < 4; i++) await $.tool.call({ tool: 'Grep', pattern: 'q', agentId: 'd1' })
  for (let i = 0; i < 2; i++) await $.tool.call({ tool: 'TaskGet', taskId: '1', agentId: 'd1' })
  expect(count('제자리걸음')).toBe(1)

  // d2가 끝나는 바로 그 동기화에 20분이 지났다: d1만 야근, d2는 아니다. 다시 동기화해도 한 번뿐
  clock += 20 * 60_000
  status.d2 = 'completed'
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 'w', agentId: 'd2', reason: 'answer' })
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 'w2', agentId: 'd1', reason: 'answer' })
  expect(count('야근 중')).toBe(1)
  expect(count('야근 중입니다: d1')).toBe(1)
  expect(count('야근 중입니다: d2')).toBe(0)
})

test('교육 효과 측정: 다섯 번째 업무는 실수 목록 없이 보내고, 일하는 동안 재발을 적어, 끝나면 인사 기록에 효과가 쌓인다', async ($, on) => {
  let book = hire(emptyBook(), 'BEAR', 'dev', 'builder', 1).book
  book = learn(learn(book, 'dev', 'Edit', 'String to replace not found in file.', 5), 'dev', 'Edit', 'String to replace not found in file.', 6)
  const store = new Map<string, unknown>([['hr', book]])
  on('store.get', (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', (_$, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('clock.now', () => ({ value: 100 }))
  const prompts: string[] = []
  let n = 0
  on('agent.spawn', (_$, e) => {
    prompts.push(e.prompt)
    return { model: 'm', agentId: `e${++n}` }
  })
  const status: Record<string, 'running' | 'completed'> = {}
  on('agent.list', () => ({ value: Object.entries(status).map(([id, s]) => ({ id, description: id, type: 'builder', status: s })) }))
  on('ui.toast', () => ({ value: undefined }))
  on('tool.call', () => ({ result: 'x', isError: true, text: 'String to replace not found in file.' }))
  on('turn.complete', () => ({ text: '' }))

  for (let i = 1; i <= 5; i++) {
    await $.agent.spawn({ tool_use_id: `s${i}`, prompt: `일${i}`, description: `일${i}`, subagentType: 'builder', ...SPAWN })
    status[`e${i}`] = 'running'
  }
  expect(prompts.slice(0, 4).every(p => p.includes('반복한 실수'))).toBe(true)
  // 비교군: 실수 목록만 빠지고 메모의 나머지는 같다
  expect(prompts[4]).not.toContain('반복한 실수')
  expect(prompts[4]).toContain('[사내 인사 메모 · agent-office]')

  // e1(메모군)은 그 실수를 다시 내고, e5(비교군)도 다시 낸다. e2는 깨끗이 끝낸다
  await $.tool.call({ tool: 'Edit', file_path: '/r/a.ts', old_string: 'a', new_string: 'b', agentId: 'e1' })
  await $.tool.call({ tool: 'Edit', file_path: '/r/a.ts', old_string: 'a', new_string: 'b', agentId: 'e5' })
  for (const id of ['e1', 'e2', 'e5']) status[id] = 'completed'
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 'v', agentId: 'e1', reason: 'answer' })
  // 다시 동기화해도 같은 업무를 두 번 세지 않는다
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 'v2', agentId: 'e2', reason: 'answer' })
  const roster = JSON.stringify(await $.command.run({ command: 'office', args: 'hr', ...RUN }))
  expect(roster).toContain('측정 중: 메모 2건 중 재발 1(50%) / 비교군 1건 중 재발 1(100%)')
  expect(roster).toContain('교육 효과 측정: 켜짐')

  const off = JSON.stringify(await $.command.run({ command: 'office', args: 'hr ab off', ...RUN }))
  expect(off).toContain('멈춥니다')
  await $.agent.spawn({ tool_use_id: 's6', prompt: '일6', description: '일6', subagentType: 'builder', ...SPAWN })
  expect(prompts[5]).toContain('반복한 실수')
})

test('/office hr off면 업무 지시를 건드리지 않고, 평가·명부는 계속 남긴다', async ($, on) => {
  const store = new Map<string, unknown>()
  on('store.get', (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', (_$, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('clock.now', () => ({ value: 0 }))
  let prompt = ''
  on('agent.spawn', (_$, e) => {
    prompt = e.prompt
    return { model: 'm', agentId: 'q1' }
  })
  const off = await $.command.run({ command: 'office', args: 'hr off', ...RUN })
  expect(JSON.stringify(off)).toContain('붙이지 않습니다')
  await $.agent.spawn({ tool_use_id: 't2', prompt: '검토해', description: '리뷰', subagentType: 'reviewer', ...SPAWN })
  expect(prompt).toBe('검토해')
  const roster = JSON.stringify(await $.command.run({ command: 'office', args: 'hr', ...RUN }))
  expect(roster).toContain('품질팀')
  expect(roster).toContain('HAWK 매 · 사원')
})

test('데스크톱에서는 목록만 그린다', async ($, on) => {
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('clock.now', () => ({ value: 0 }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  await $.command.run({ command: 'office', args: '', ...RUN })
  const ui = await $.ui.mount({ plugin: 'agent-office', surface: 'desktop', component: 'Pane', requestId: 'agent-office', props: PROPS, viewport: { columns: 96, rows: 40 } })
  expect((await ui.find({ key: 'row-main' }))?.text).toContain('보스 대표')
})

test('설정 attachTo로 다른 패널 아래에도 평면도를 붙인다(그 패널 화면은 위에 그대로)', { options: { attachTo: 'host-pane' } }, async ($, on) => {
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('clock.now', () => ({ value: 0 }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.render', { component: 'Pane', requestId: 'host-pane' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>다른 mod의 화면</Text>
  })
  await $.command.run({ command: 'office', args: '', ...RUN })
  const ui = await $.ui.mount({ plugin: 'agent-office', surface: 'terminal', component: 'Pane', requestId: 'host-pane', props: { ...PROPS, title: '다른 패널' }, viewport: { columns: 96, rows: 60 } })
  const tree = JSON.stringify(await ui.drawn())
  expect(tree.indexOf('다른 mod의 화면')).toBeGreaterThan(-1)
  expect(tree.indexOf('"Raster"')).toBeGreaterThan(tree.indexOf('다른 mod의 화면'))
  const again = await $.command.run({ command: 'office', args: '', ...RUN })
  expect(JSON.stringify(again)).toContain('설정한 패널(host-pane) 아래에도')
})

test('설정이 비어 있으면 다른 패널에 끼어들지 않는다', async ($, on) => {
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('clock.now', () => ({ value: 0 }))
  on('ui.render', { component: 'Pane', requestId: 'host-pane' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>다른 mod의 화면</Text>
  })
  const ui = await $.ui.mount({ plugin: 'agent-office', surface: 'terminal', component: 'Pane', requestId: 'host-pane', props: { ...PROPS, title: '다른 패널' }, viewport: { columns: 96, rows: 60 } })
  expect(JSON.stringify(await ui.drawn())).not.toContain('Raster')
})
