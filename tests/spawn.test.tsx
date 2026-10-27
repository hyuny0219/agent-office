// 훅 테스트(엔진을 흉내 낸 하네스에서): 띄우기·평가·근태·교육 효과·인사 메모 끄기.
import { expect, test } from 'claude-code/testing'

import { emptyBook, hire, learn } from '../core/hr'
import { OVERTIME_MS } from '../core/watch'
import { agent, PROPS, RUN, SPAWN } from './kit'

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

  expect((await ui.find({ key: 'feed-0' }))?.text).toContain('BOSS → BEAR (지시): T139 빌드 — 만들어')
  expect((await ui.find({ key: 'row-a1' }))?.text).toContain('"yes!"')
  peek = async () => (await ui.find({ key: 'row-a1' }))?.text ?? ''
  await $.tool.call({ tool: 'Bash', command: 'ls', agentId: 'a1' })
  expect(during).toContain('도구 1회')

  // 끝나면 평가(오류 없이 완료 S +13) 토스트와 인사 기록
  status = 'completed'
  await $.turn.complete({ answer: '끝', durationMs: 1, isAborted: false, turnId: 'x', agentId: 'a1', reason: 'answer' })
  expect(toasts.join()).toContain('BEAR 사원 평가 S (+13)')
  const roster = JSON.stringify(await $.command.run({ command: 'office', args: 'hr', ...RUN }))
  expect(roster).toMatch(/개발팀\s+BEAR 곰\s+사원·팀장/)
  expect(roster).toMatch(/개발팀  BEAR 곰  사원·팀장 +[\d,]+만  S +1\/0 /)
  const report = JSON.stringify(await $.command.run({ command: 'office', args: 'report', ...RUN }))
  expect(report).toContain('업무 1건 · 완료 1 / 실패 0')
  expect(report).toContain('MVP: BEAR 곰')
  expect(JSON.stringify(await $.command.run({ command: 'office', args: 'report week', ...RUN }))).toContain('주간 보고')
  expect(JSON.stringify(await $.command.run({ command: 'office', args: 'report month', ...RUN }))).toContain('쓰는 법')
  expect(JSON.stringify(await $.command.run({ command: 'office', args: 'report WEEK', ...RUN }))).toContain('주간 보고')
  expect(JSON.stringify(await $.command.run({ command: 'office', args: 'hr ab', ...RUN }))).toContain('쓰는 법: /office hr ab on|off')
  const card = JSON.stringify(await $.command.run({ command: 'office', args: 'hr bear', ...RUN }))
  expect(card).toContain('인사카드: BEAR 곰')
  expect(card).toMatch(/T139 빌드\s+완료\s+S\(\+13\)/)
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
  expect(roster).toContain('교육 효과 측정 켜짐')

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
  expect(roster).toMatch(/HAWK 매\s+사원/)
})
