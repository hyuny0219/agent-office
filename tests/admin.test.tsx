// 훅 테스트(엔진을 흉내 낸 하네스에서): 부서 배치·내보내기 명령, 예산 초과 때 맡기기 전 확인, 나란히 맡길 때 배정, 메뉴 7(기록)과 설정의 배치 버튼, 새 지침 후보 알림.
import { expect, test } from 'claude-code/testing'

import type { HrBook, JobRecord } from '../types'
import { BUDGET_CHOICES } from '../core/budget'
import { emptyBook, migrate, record } from '../core/hr'
import { RUN, SPAWN } from './kit'

const MENU_PROPS = { title: '사무실 메뉴', isFocused: true, bodyColumns: 120, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} } as const

/** 저장소·시계·토스트를 흉내 낸다 */
function desk(on: Parameters<Parameters<typeof test>[1]>[1], first?: HrBook) {
  const store = new Map<string, unknown>(first === undefined ? [] : [['hr', first]])
  const writes = { n: 0 }
  on('store.get', (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', (_$, e) => {
    writes.n++
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('clock.now', () => ({ value: 10_000 }))
  const toasts: string[] = []
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  return { book: () => migrate(store.get('hr')), toasts, writes }
}

const text = (r: unknown) => (r as { text?: string }).text ?? ''

test('부서 배치: /office dept로 종류의 부서를 바꾸면 새로 맡기는 일부터 그 부서 직원이 받고, reset으로 되돌린다', async ($, on) => {
  const d = desk(on)
  on('agent.spawn', (_$, e) => ({ model: 'm', agentId: `id-${e.tool_use_id}` }))
  on('agent.list', () => ({ value: [] }))
  expect(text(await $.command.run({ command: 'office', args: 'dept', ...RUN }))).toContain('아직 일을 맡은 에이전트 종류가 없습니다')
  expect(text(await $.command.run({ command: 'office', args: 'dept writer 없는팀', ...RUN }))).toContain('없는팀라는 부서가 없습니다')
  expect(text(await $.command.run({ command: 'office', args: 'dept a/b 개발팀', ...RUN }))).toContain('쓸 수 없습니다')
  expect(text(await $.command.run({ command: 'office', args: 'dept oh-my-claudecode:writer 품질팀', ...RUN }))).toContain('writer를 품질팀에 배치합니다')
  expect(d.book()?.deptMap).toEqual({ writer: 'qa' })
  await $.agent.spawn({ tool_use_id: 't1', prompt: '문서 검토', description: '문서 검토', subagentType: 'oh-my-claudecode:writer', ...SPAWN })
  expect(d.book()?.employees.map(e => [e.dept, e.type])).toEqual([['qa', 'oh-my-claudecode:writer']])
  expect(text(await $.command.run({ command: 'office', args: 'dept writer', ...RUN }))).toContain('writer: 품질팀 (기본은 문서팀)')
  expect(text(await $.command.run({ command: 'office', args: 'dept', ...RUN }))).toMatch(/writer +품질팀 +문서팀/)
  expect(text(await $.command.run({ command: 'office', args: 'dept writer reset', ...RUN }))).toContain('기본 배치(문서팀)로 되돌립니다')
  expect(d.book()?.deptMap).toBeUndefined()
  // 되돌린 뒤 맡기는 일은 문서팀이 받는다(품질팀에 뽑힌 직원은 그대로 남는다)
  await $.agent.spawn({ tool_use_id: 't2', prompt: '문서 쓰기', description: '문서 쓰기', subagentType: 'writer', ...SPAWN })
  expect(d.book()?.employees.map(e => e.dept)).toEqual(['qa', 'docs'])
})

test('내보내기: /office export는 세션 폴더의 agent-office-export/에, 폴더를 주면 그곳에 JSON·CSV를 쓴다', async ($, on) => {
  desk(on, record(emptyBook(), { nick: 'BEAR', dept: 'dev', job: 1, description: '빌드', startedAt: 0, endedAt: 5000, outcome: 'done', score: 13, errors: 0, isCheckFailed: false, isReworked: false, alarms: 0 } as JobRecord))
  on('session.cwd', () => ({ value: '/work/proj' }))
  const written = new Map<string, string>()
  let isDenied = false
  on('fs.write', (_$, e) => {
    if (isDenied) throw new Error('EACCES: permission denied\nmore')
    written.set(e.path, e.text)
    return { value: undefined }
  })
  const json = text(await $.command.run({ command: 'office', args: 'export', ...RUN }))
  expect(json).toMatch(/내보냈습니다:\n- \/work\/proj\/agent-office-export\/agent-office-\d{8}-\d{6}\.json/)
  // 기본 폴더에는 모두 무시하는 .gitignore를 함께 둔다(인사 기록이 저장소에 커밋되지 않도록)
  expect(written.get('/work/proj/agent-office-export/.gitignore')).toContain('*')
  const [path, body] = [...written.entries()].find(([k]) => k.endsWith('.json')) ?? ['', '']
  expect(path.startsWith('/work/proj/agent-office-export/')).toBe(true)
  expect(JSON.parse(body).book.log[0].description).toBe('빌드')
  written.clear()
  const csv = text(await $.command.run({ command: 'office', args: 'export csv /tmp/out  dir', ...RUN }))
  // 겹친 빈칸도 그대로, 폴더를 주면 .gitignore는 쓰지 않는다
  expect(csv).toContain('/tmp/out  dir/agent-office-')
  expect([...written.keys()].map(k => k.replace(/\d{8}-\d{6}/, 'T'))).toEqual(['/tmp/out  dir/agent-office-T-jobs.csv', '/tmp/out  dir/agent-office-T-months.csv'])
  // 꼴 없이 폴더만 주면 json
  written.clear()
  await $.command.run({ command: 'office', args: 'export ./backup', ...RUN })
  expect([...written.keys()].map(k => k.replace(/\d{8}-\d{6}/, 'T'))).toEqual(['/work/proj/backup/agent-office-T.json'])
  // ~는 펴지 않고 거절한다
  expect(text(await $.command.run({ command: 'office', args: 'export json ~/Desktop', ...RUN }))).toContain('~는 쓸 수 없습니다')
  expect(text(await $.command.run({ command: 'office', args: 'export xml', ...RUN }))).toContain('쓰는 법: /office export')
  isDenied = true
  // 쓰지 못하면 그 까닭의 첫 줄만 답한다
  const failed = text(await $.command.run({ command: 'office', args: 'export', ...RUN }))
  expect(failed).toMatch(/^내보내지 못했습니다: \S/)
  expect(failed).not.toContain('\n')
})

test('예산 조치: 한도를 넘은 부서에 맡기기 전에 묻고, 맡기지 않기면 띄우지 않으며, 계속이면 하루 동안 다시 묻지 않는다', async ($, on) => {
  const over: JobRecord = { nick: 'OLD', dept: 'dev', job: 1, description: '비싼 일', startedAt: 0, endedAt: 9000, outcome: 'done', score: 10, errors: 0, isCheckFailed: false, isReworked: false, alarms: 0, tokens: { input: 1000, output: 0, cacheRead: 0, cacheWrite: 0, usd: 3, unpriced: 0 } }
  const d = desk(on, { ...record(emptyBook(), over), budgets: { dev: 2 } })
  let answer: string = BUDGET_CHOICES.stop
  const asked: string[] = []
  on('tool.call', (_$, e) => {
    if (e.tool !== 'AskUserQuestion') return { result: 'ok' }
    const q = (e as unknown as { questions: { question: string; options: { label: string }[] }[] }).questions[0]
    asked.push(`${q?.question}|${q?.options.map(o => o.label).join('/')}`)
    return { result: { questions: [], answers: { [q?.question ?? '']: answer } } } as never
  })
  let spawned = 0
  on('agent.spawn', () => {
    spawned++
    return { model: 'm', agentId: `a${spawned}` }
  })
  on('agent.list', () => ({ value: [] }))
  const spawn = (n: number, type = 'builder') => $.agent.spawn({ tool_use_id: `t${n}`, prompt: '고쳐', description: `고치기 ${n}`, subagentType: type, ...SPAWN })

  const denied = await spawn(1)
  expect(denied.deny).toContain('대표가 개발팀에 새 일을 맡기지 않았습니다')
  expect(spawned).toBe(0)
  expect(asked[0]).toContain('개발팀 하루 예산 초과: 최근 24시간 $3.00 / 예산 $2.00(150%)입니다. 개발팀에 새 일(고치기 1)을 맡길까요?')
  expect(asked[0]).toContain(`|${BUDGET_CHOICES.go}/${BUDGET_CHOICES.once}/${BUDGET_CHOICES.stop}`)
  expect(d.toasts.some(t => t.includes('개발팀에 새 일을 맡기지 않았습니다'))).toBe(true)
  // 맡기지 않으면 아무도 뽑지 않는다
  expect(d.book()?.employees.length).toBe(0)
  // 다른 부서는 묻지 않는다
  await spawn(2, 'Explore')
  expect([spawned, asked.length]).toEqual([1, 1])
  // 이번만: 맡기고, 다음에 또 묻는다
  answer = BUDGET_CHOICES.once
  expect((await spawn(3)).deny).toBeUndefined()
  await spawn(4).catch(() => undefined)
  expect(asked.length).toBe(3)
  // 계속: 맡기고, 하루 동안 다시 묻지 않는다
  answer = BUDGET_CHOICES.go
  await spawn(5)
  expect(d.book()?.budgetWaivers?.dev).toBe(10_000)
  await spawn(6)
  expect(asked.length).toBe(4)
  expect(spawned).toBe(5)
  // 한도를 다시 정하면 다시 묻는다
  await $.command.run({ command: 'office', args: 'budget 개발팀 2', ...RUN })
  expect(d.book()?.budgetWaivers).toBeUndefined()
  // 토큰 한도로도 정하고, off면 둘 다 없앤다
  expect(text(await $.command.run({ command: 'office', args: 'budget 개발팀 2M', ...RUN }))).toContain('하루 토큰 예산을 2.0M 토큰으로')
  expect([d.book()?.budgets.dev, d.book()?.tokenBudgets?.dev]).toEqual([2, 2_000_000])
  await $.command.run({ command: 'office', args: 'budget 개발팀 off', ...RUN })
  expect([d.book()?.budgets.dev, d.book()?.tokenBudgets]).toEqual([undefined, undefined])
})

test('예산 조치: 같은 부서에 나란히 맡기면 한 번만 묻고, 기다리던 일들은 같은 답을 따른다', async ($, on) => {
  const over: JobRecord = { nick: 'OLD', dept: 'dev', job: 1, description: '비싼 일', startedAt: 0, endedAt: 9000, outcome: 'done', score: 10, errors: 0, isCheckFailed: false, isReworked: false, alarms: 0, tokens: { input: 1000, output: 0, cacheRead: 0, cacheWrite: 0, usd: 3, unpriced: 0 } }
  const d = desk(on, { ...record(emptyBook(), over), budgets: { dev: 2 } })
  let asked = 0
  on('tool.call', (_$, e) => {
    if (e.tool !== 'AskUserQuestion') return { result: 'ok' }
    asked++
    const q = (e as unknown as { questions: { question: string }[] }).questions[0]?.question ?? ''
    return { result: { questions: [], answers: { [q]: BUDGET_CHOICES.once } } } as never
  })
  let spawned = 0
  on('agent.spawn', () => {
    spawned++
    return { model: 'm', agentId: `p${spawned}` }
  })
  on('agent.list', () => ({ value: [] }))
  const both = Promise.all([1, 2].map(n => $.agent.spawn({ tool_use_id: `t${n}`, prompt: '고쳐', description: `고치기 ${n}`, subagentType: 'builder', ...SPAWN })))
  const got = await both
  expect(got.every(r => r.deny === undefined)).toBe(true)
  expect([asked, spawned]).toEqual([1, 2])
  expect(d.book()?.budgetWaivers).toBeUndefined()
})

test('예산 조치: 확인 창을 띄우지 못하면(닫았거나 -p) 맡기지 않는다', async ($, on) => {
  const over: JobRecord = { nick: 'OLD', dept: 'qa', job: 1, description: '검토', startedAt: 0, endedAt: 9000, outcome: 'done', score: 10, errors: 0, isCheckFailed: false, isReworked: false, alarms: 0, tokens: { input: 1000, output: 0, cacheRead: 0, cacheWrite: 0, usd: 1, unpriced: 0 } }
  desk(on, { ...record(emptyBook(), over), budgets: { qa: 1 } })
  on('tool.call', (_$, e) => {
    if (e.tool === 'AskUserQuestion') throw new Error('dismissed')
    return { result: 'ok' }
  })
  on('agent.spawn', () => ({ model: 'm', agentId: 'x' }))
  on('agent.list', () => ({ value: [] }))
  const r = await $.agent.spawn({ tool_use_id: 't1', prompt: '검토', description: '검토', subagentType: 'code-reviewer', ...SPAWN })
  expect(r.deny).toContain('품질팀')
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`메뉴(${surface}): 7은 월별 기록, 설정에는 부서 배치 표와 누르면 다음 부서로 옮기는 버튼`, async ($, on) => {
    const first = record(emptyBook(), { nick: 'BEAR', dept: 'dev', job: 1, description: '빌드', startedAt: 0, endedAt: new Date(2026, 9, 15, 12).getTime(), outcome: 'done', score: 13, errors: 0, isCheckFailed: false, isReworked: false, alarms: 0 })
    const d = desk(on, { ...first, employees: [{ nick: 'BEAR', dept: 'dev', type: 'builder', xp: 13, jobs: 1, done: 1, failed: 0, toolErrors: 0, reworks: 0, alarms: 0, rejections: 0, avgScore: 13, lastScore: 13, hiredAt: 0, lastAt: 5000 }] })
    on('agent.list', () => ({ value: [] }))
    await $.command.run({ command: 'office', args: 'menu', ...RUN })
    const ui = await $.ui.mount({ plugin: 'agent-office', surface, component: 'Pane', requestId: 'agent-office-menu', props: MENU_PROPS, viewport: { columns: 120, rows: 60 } })
    await ui.press({ key: 'menu-archive' })
    const body = JSON.stringify(await ui.find({ key: 'menu-body' }))
    expect(body).toContain('월별 기록')
    expect(body).toContain('2026-10')
    await ui.press({ key: 'menu-settings' })
    expect(JSON.stringify(await ui.find({ key: 'dept-map' }))).toContain('부서 배치')
    expect((await ui.find({ key: 'dept-builder' }))?.text).toBe('builder: 개발팀')
    await ui.press({ key: 'dept-builder' })
    expect(d.book()?.deptMap).toEqual({ builder: 'research' })
    expect((await ui.find({ key: 'dept-builder' }))?.text).toBe('builder: 조사팀 (바꿈)')
  })
}

test('배정: 아무도 없을 때 나란히 맡기면 별칭이 겹치지 않게 둘을 새로 뽑는다', async ($, on) => {
  const d = desk(on)
  let n = 0
  on('agent.spawn', () => {
    n++
    return { model: 'm', agentId: `c${n}` }
  })
  on('agent.list', () => ({ value: [] }))
  const spawn = (i: number) => $.agent.spawn({ tool_use_id: `t${i}`, prompt: '고쳐', description: `고치기 ${i}`, subagentType: 'builder', ...SPAWN })
  // 아무도 없을 때 둘을 나란히: 둘 다 새로 뽑되 별칭이 다르다
  await Promise.all([spawn(1), spawn(2)])
  const nicks = d.book()?.employees.map(e => e.nick) ?? []
  expect(nicks.length).toBe(2)
  expect(new Set(nicks).size).toBe(2)
  const list = JSON.stringify(await $.command.run({ command: 'office', args: 'hr', ...RUN }))
  for (const k of nicks) expect(list).toContain(k)
})

test('배정: 쉬는 직원이 하나뿐이면 나란히 뜬 둘째 일은 그 직원을 함께 받지 않고 새로 뽑는다', async ($, on) => {
  const first = { ...emptyBook(), employees: [{ nick: 'BEAR', dept: 'dev' as const, type: 'builder', xp: 30, jobs: 3, done: 3, failed: 0, toolErrors: 0, reworks: 0, alarms: 0, rejections: 0, avgScore: 13, lastScore: 13, hiredAt: 0, lastAt: 1000 }] }
  const d = desk(on, first)
  const prompts: string[] = []
  let n = 0
  on('agent.spawn', (_$, e) => {
    n++
    prompts.push(e.prompt)
    return { model: 'm', agentId: `c${n}` }
  })
  on('agent.list', () => ({ value: [] }))
  await Promise.all([1, 2].map(i => $.agent.spawn({ tool_use_id: `t${i}`, prompt: '고쳐', description: `고치기 ${i}`, subagentType: 'builder', ...SPAWN })))
  const nicks = d.book()?.employees.map(e => e.nick) ?? []
  expect(nicks.length).toBe(2)
  expect(nicks[0]).toBe('BEAR')
  // 업무 지시의 담당도 서로 다르다
  const who = prompts.map(p => /담당: 개발팀 (\S+)/.exec(p)?.[1])
  expect(new Set(who).size).toBe(2)
})

test('지침 후보 알림: 새 후보가 오르면 토스트·메신저로 한 번 알리고, 사무실 패널의 알림 줄을 누르면 메뉴 6 지침이 열리며 줄이 내려간다', async ($, on) => {
  const failed = (n: number): JobRecord => ({ nick: 'BEAR', dept: 'dev', job: n, description: `일 ${n}`, startedAt: n, endedAt: 9000 + n, outcome: 'done', score: 6, errors: 0, isCheckFailed: true, isReworked: false, alarms: 0 })
  let first: HrBook = emptyBook()
  for (let i = 1; i <= 5; i++) first = record(first, failed(i))
  const d = desk(on, first)
  on('agent.list', () => ({ value: [] }))
  // 업무 기록이 바뀐 명령 뒤에 새 후보를 본다
  await $.command.run({ command: 'office', args: 'report', ...RUN })
  expect(d.toasts.filter(t => t.includes('개발팀 지침 후보')).length).toBe(1)
  const before = d.writes.n
  await $.command.run({ command: 'office', args: 'report week', ...RUN })
  expect(d.toasts.filter(t => t.includes('개발팀 지침 후보')).length).toBe(1)
  // 바뀐 것이 없으면 인사 기록을 다시 쓰지 않는다
  expect(d.writes.n).toBe(before)
  await $.command.run({ command: 'office', args: '', ...RUN })
  const PANE_PROPS = { title: '에이전트 사무실', isFocused: false, bodyColumns: 120, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} } as const
  const pane = await $.ui.mount({ plugin: 'agent-office', surface: 'terminal', component: 'Pane', requestId: 'agent-office', props: PANE_PROPS, viewport: { columns: 120, rows: 60 } })
  expect(JSON.stringify(await pane.find({ key: 'playbook-alert' }))).toContain('새 지침 후보 1건(개발팀 1)')
  await pane.press({ key: 'playbook-alert' })
  expect(d.book()?.proposalsSeen).toEqual({ dev: ['check'] })
  expect(await pane.find({ key: 'playbook-alert' })).toBeUndefined()
  // 채택했다가 빼도(지침 화면에서 한 일) 다시 드러난 후보를 새로 알리지 않는다
  await $.command.run({ command: 'office', args: 'playbook 개발팀 adopt 1', ...RUN })
  await $.command.run({ command: 'office', args: 'playbook 개발팀 drop 1', ...RUN })
  expect(d.toasts.filter(t => t.includes('개발팀 지침 후보')).length).toBe(1)
  expect(await pane.find({ key: 'playbook-alert' })).toBeUndefined()
})
