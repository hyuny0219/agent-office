import { expect, test } from 'claude-code/testing'

import type { HrBook, OfficeAgent } from '../types'
import { briefOf, deptOf, emptyBook, gradeOf, hire, leadOf, learn, patternOf, rankOf, review, salaryOf, scoreOf, tipOf } from './hr'
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

  peek = async () => (await ui.find({ key: 'row-main' }))?.text ?? ''
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  expect(during).toContain('도구 1회')

  // 끝나면 평가(오류 없이 완료 S +13) 토스트와 인사 기록
  status = 'completed'
  await $.turn.complete({ answer: '끝', durationMs: 1, isAborted: false, turnId: 'x', agentId: 'a1', reason: 'answer' })
  expect(toasts.join()).toContain('BEAR 사원 평가 S (+13)')
  const roster = JSON.stringify(await $.command.run({ command: 'office', args: 'hr', ...RUN }))
  expect(roster).toContain('개발팀 — 팀장 BEAR(곰)')
  expect(roster).toContain('완료 1 / 실패 0')
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
