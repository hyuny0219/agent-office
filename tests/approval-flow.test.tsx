// 훅 테스트(엔진을 흉내 낸 하네스에서): 결재·계획 검토·적임자·조직 개편.
import { expect, test } from 'claude-code/testing'

import type { HrBook } from '../types'
import { emptyBook, hire } from '../core/hr'
import { IDLE_MS } from '../core/org'
import { agent, PROPS, RUN, SPAWN } from './kit'

test('결재: 기다려 받은 보고는 결재를 마치고 반려 의견을 붙여 돌려주며, 확정한 계획에는 기획팀장 검토를 붙인다', async ($, on) => {
  const store = new Map<string, unknown>()
  on('store.get', (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', (_$, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('clock.now', () => ({ value: 5000 }))
  on('agent.spawn', () => ({ model: 'm', agentId: 'c1' }))
  let status: 'running' | 'completed' = 'running'
  on('agent.list', () => ({ value: [{ id: 'c1', description: '고치기', type: 'builder', status }] }))
  const toasts: string[] = []
  on('ui.toast', (_$, e) => {
    toasts.push(JSON.stringify(e))
    return { value: undefined }
  })
  const asks: string[] = []
  on('model.complete', (_$, e) => {
    asks.push(`${e.system ?? ''}\n${e.prompt}`)
    const text = e.prompt.includes('<계획>') ? '보완\n- 검증 단계가 없다' : '반려\n- 테스트를 돌렸다는 말이 없다'
    return { value: { isAnswered: true, text, usage: { input_tokens: 1, output_tokens: 1 } } } as never
  })
  on('tool.call', (_$, e) => {
    if (e.tool === 'Agent') return { result: { status: 'completed', agentId: 'c1', content: [{ type: 'text', text: '고쳤습니다' }] } } as never
    if (e.tool === 'ExitPlanMode') return { result: { plan: '1. 고친다\n2. 끝', isAgent: false } } as never
    if (e.tool === 'Bash') return { result: 'fail', isError: true, text: 'Exit code 1\nFAIL src/a.test.ts\n1 failed' } as never
    return { result: 'ok' }
  })
  on('turn.complete', () => ({ text: '' }))

  await $.agent.spawn({ tool_use_id: 't9', prompt: '버그를 고쳐', description: '고치기', subagentType: 'builder', ...SPAWN })
  for (const f of ['a', 'b', 'c']) await $.tool.call({ tool: 'Read', file_path: `/r/${f}.ts`, agentId: 'c1' } as never)
  // 근거: 고친 파일과 실패한 테스트가 결재 요청의 기록에 실린다
  await $.tool.call({ tool: 'Edit', file_path: '/r/src/a.ts', old_string: 'x', new_string: 'y', agentId: 'c1' } as never)
  await $.tool.call({ tool: 'Bash', command: 'npm test', description: '테스트', agentId: 'c1' } as never)
  status = 'completed'
  await $.turn.complete({ answer: '고쳤습니다', durationMs: 1, isAborted: false, turnId: 'z', agentId: 'c1', reason: 'answer' })
  const back = JSON.stringify(await $.tool.call({ tool: 'Agent', description: '고치기', prompt: '버그를 고쳐', subagent_type: 'builder' } as never))
  expect(asks[0]).toContain('고친 파일: src/a.ts')
  expect(asks[0]).toContain('셸 확인 명령: `npm test` 실패(출력 끝: 1 failed)')
  expect(asks[0]).toContain('최근 오류: Bash: FAIL src/a.test.ts')
  expect(back).toContain('[사내 결재 · agent-office] 개발팀 BEAR의 보고 \\"고치기\\"가 대표 BOSS 결재에서 반려됐습니다')
  expect(back).toContain('테스트를 돌렸다는 말이 없다')
  expect(asks[0]).toContain('<지시>\n버그를 고쳐\n</지시>')
  expect(asks[0]).toContain('<보고>\n고쳤습니다\n</보고>')
  expect(toasts.join()).toContain('대표 BOSS 결재: BEAR \\"고치기\\" 반려 -3')
  // 한 번 붙인 의견은 다시 붙지 않는다
  expect(JSON.stringify(await $.tool.call({ tool: 'Read', file_path: '/r/x.ts' } as never))).not.toContain('사내 결재')
  expect(JSON.stringify(await $.command.run({ command: 'office', args: 'hr', ...RUN }))).toContain('결재 반려 1')
  expect(JSON.stringify(await $.command.run({ command: 'office', args: 'report', ...RUN }))).toContain('결재 반려')

  const plan = JSON.stringify(await $.tool.call({ tool: 'ExitPlanMode' } as never))
  expect(plan).toContain('기획팀장 대행의 계획 검토: 보완이 필요합니다')
  expect(plan).toContain('검증 단계가 없다')

  // 끄면 결재자를 부르지 않는다
  await $.command.run({ command: 'office', args: 'approval off', ...RUN })
  const before = asks.length
  expect(JSON.stringify(await $.tool.call({ tool: 'ExitPlanMode' } as never))).not.toContain('사내 결재')
  expect(asks.length).toBe(before)
  expect(JSON.stringify(await $.command.run({ command: 'office', args: 'approval', ...RUN }))).toContain('결재: 꺼짐')
})

test('결재: 보고 없이 끝난 일은 결재자를 부르지 않고 보류한다', async ($, on) => {
  const store = new Map<string, unknown>()
  on('store.get', (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', (_$, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('clock.now', () => ({ value: 5000 }))
  on('agent.spawn', () => ({ model: 'm', agentId: 'd1' }))
  let status: 'running' | 'completed' = 'running'
  on('agent.list', () => ({ value: [{ id: 'd1', description: '조용히', type: 'builder', status }] }))
  const toasts: string[] = []
  on('ui.toast', (_$, e) => {
    toasts.push(JSON.stringify(e))
    return { value: undefined }
  })
  let asked = 0
  on('model.complete', () => {
    asked++
    return { value: { isAnswered: true, text: '반려\n- 보고 없음', usage: { input_tokens: 1, output_tokens: 1 } } } as never
  })
  on('tool.call', () => ({ result: 'ok' }))
  on('turn.complete', () => ({ text: '' }))
  await $.agent.spawn({ tool_use_id: 't8', prompt: '해', description: '조용히', subagentType: 'builder', ...SPAWN })
  for (const f of ['a', 'b', 'c']) await $.tool.call({ tool: 'Read', file_path: `/r/${f}.ts`, agentId: 'd1' } as never)
  status = 'completed'
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 'q', agentId: 'd1', reason: 'answer' })
  await $.tool.call({ tool: 'Read', file_path: '/r/z.ts' } as never)
  expect(asked).toBe(0)
  expect(toasts.join()).toContain('보류')
  expect(JSON.stringify(await $.command.run({ command: 'office', args: 'hr', ...RUN }))).not.toContain('결재 반려 1')
})

test('조직: 비슷한 일을 한 직원에게 맡기고(까닭은 지시·메신저에), 승인한 일을 BOSS가 고치면 놓친 승인으로 재며, 끝난 뒤 성과 나쁜 직원을 내보낸다', async ($, on) => {
  let seed: HrBook = hire(hire(hire(emptyBook(), 'BEAR', 'dev', 'builder', 0).book, 'PANDA', 'dev', 'builder', 1).book, 'MOLE', 'dev', 'builder', 2).book
  seed = {
    ...seed,
    employees: seed.employees.map(e => (e.nick === 'BEAR' ? { ...e, xp: 40, jobs: 3, done: 3, avgScore: 8, lastAt: 4000 }
      : e.nick === 'PANDA' ? { ...e, xp: 10, jobs: 1, done: 1, avgScore: 6, lastAt: 4000 } : { ...e, jobs: 5, failed: 5, avgScore: -3, lastAt: 4000 })),
    log: [{ nick: 'PANDA', dept: 'dev', job: 1, description: 'README 고치기', startedAt: 0, endedAt: 100, outcome: 'done', score: 6, errors: 0, isCheckFailed: false, isReworked: false, alarms: 0 }],
    isApprovalNoticed: true,
  }
  const store = new Map<string, unknown>([['hr', seed]])
  on('store.get', (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', (_$, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('clock.now', () => ({ value: 5000 }))
  let prompt = ''
  on('agent.spawn', (_$, e) => {
    prompt = e.prompt
    return { model: 'm', agentId: 'p1' }
  })
  let status: 'running' | 'completed' = 'running'
  on('agent.list', () => ({ value: [{ id: 'p1', description: 'README 오타 고치기', type: 'builder', status }] }))
  const toasts: string[] = []
  on('ui.toast', (_$, e) => {
    toasts.push(JSON.stringify(e))
    return { value: undefined }
  })
  on('model.complete', () => ({ value: { isAnswered: true, text: '승인', usage: { input_tokens: 1, output_tokens: 1 } } }) as never)
  on('tool.call', (_$, e) => (e.tool === 'Agent' ? { result: { status: 'completed', agentId: 'p1', content: [] } } as never : { result: 'ok' }))
  on('turn.complete', () => ({ text: '' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))

  await $.agent.spawn({ tool_use_id: 'tp', prompt: '오타를 고쳐', description: 'README 오타 고치기', subagentType: 'builder', ...SPAWN })
  expect(prompt).toContain('담당: 개발팀 PANDA 사원')
  expect(prompt).toContain('배정 사유: 비슷한 일 1건을 잘 끝냄.')
  const ui = await $.ui.mount({ plugin: 'agent-office', surface: 'terminal', component: 'Pane', requestId: 'agent-office', props: PROPS, viewport: { columns: 96, rows: 50 } })
  expect((await ui.find({ key: 'feed-0' }))?.text).toContain('BOSS → PANDA (지시): README 오타 고치기 (배정: 비슷한 일 1건을 잘 끝냄) — 오타를 고쳐')

  await $.tool.call({ tool: 'Edit', file_path: '/r/README.md', old_string: 'a', new_string: 'b', agentId: 'p1' })
  // 그 일을 한 직원이 제 파일을 더 고친 것은 후속 수정이 아니다
  await $.tool.call({ tool: 'Edit', file_path: '/r/README.md', old_string: 'b', new_string: 'c', agentId: 'p1' })
  await $.tool.call({ tool: 'Read', file_path: '/r/a.md', agentId: 'p1' } as never)
  status = 'completed'
  await $.turn.complete({ answer: '고쳤습니다', durationMs: 1, isAborted: false, turnId: 'tp', agentId: 'p1', reason: 'answer' })
  await $.tool.call({ tool: 'Agent', description: 'README 오타 고치기', prompt: '오타를 고쳐', subagent_type: 'builder' } as never)
  expect(toasts.join()).toContain('개발팀장 BEAR(곰 대리) 결재: PANDA \\"README 오타 고치기\\" 승인')
  // 끝난 뒤(결재까지) 성과가 계속 나쁜 MOLE을 내보낸다. 일하던 PANDA·팀장 BEAR는 남는다
  await $.tool.call({ tool: 'Read', file_path: '/r/b.md' } as never)
  expect(toasts.join()).toContain('조직 개편이 켜져 있습니다')
  expect(toasts.join()).toContain('인사 발령: 개발팀 MOLE 사원 퇴사 · 권고사직: 업무 5건, 최근 평균 평가 D(-3.0)')
  expect(store.get('hr')).toMatchObject({ employees: [{ nick: 'BEAR' }, { nick: 'PANDA' }], retired: [{ nick: 'MOLE' }] })

  // 승인한 일을 BOSS가 곧 고쳤다: 재작업 감점과 함께 결재는 놓친 승인으로 잰다
  await $.tool.call({ tool: 'Edit', file_path: '/r/README.md', old_string: 'c', new_string: 'd' })
  expect(toasts.join()).toContain('BOSS가 PANDA의 작업(README.md)을 다시 고쳤습니다')
  const report = JSON.stringify(await $.command.run({ command: 'office', args: 'report', ...RUN }))
  expect(report).toContain('결재 승인 1 · 반려 0 · 전결 0')
  expect(report).toMatch(/개발팀장 BEAR\(곰\)\s+1건\s+0\(0%\)\s+1\s+0/)
  const roster = JSON.stringify(await $.command.run({ command: 'office', args: 'hr', ...RUN }))
  expect(roster).toContain('조직 개편 켜짐')
  expect(roster).toContain('떠난 직원(1명)')
  expect(JSON.stringify(await $.command.run({ command: 'office', args: 'hr MOLE', ...RUN }))).toContain('· 퇴사 (builder)')
  expect(JSON.stringify(await $.command.run({ command: 'office', args: 'reorg', ...RUN }))).toContain('조직 개편: 켜짐')
  expect(JSON.stringify(await $.command.run({ command: 'office', args: 'reorg off', ...RUN }))).toContain('직원을 내보내지 않습니다')
  expect(JSON.stringify(await $.command.run({ command: 'office', args: 'reorg', ...RUN }))).toContain('조직 개편: 꺼짐')
})

test('조직 개편: 한 번에 함께 끝난 사람은 모두 평가가 끝나기 전에는 내보내지 않는다(앞사람 평가 뒤에도)', async ($, on) => {
  const now = IDLE_MS + 10_000
  // BEAR는 한 건 하고 30일 넘게 쉬었다(이번 일을 평가하기 전에는 계약 종료 대상으로 보인다)
  let seed: HrBook = hire(emptyBook(), 'BEAR', 'dev', 'builder', 0).book
  seed = { ...seed, employees: seed.employees.map(e => ({ ...e, jobs: 1, done: 1, avgScore: 13, lastAt: 0 })), isApproving: false }
  const store = new Map<string, unknown>([['hr', seed]])
  on('store.get', (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', (_$, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('clock.now', () => ({ value: now }))
  let n = 0
  on('agent.spawn', () => ({ model: 'm', agentId: ++n === 1 ? 'r1' : 'd1' }))
  let status: 'running' | 'done' = 'running'
  on('agent.list', () => ({ value: [
    { id: 'r1', description: '찾기', type: 'Explore', status: status === 'done' ? 'failed' : 'running' },
    { id: 'd1', description: '빌드', type: 'builder', status: status === 'done' ? 'completed' : 'running' },
  ] }))
  const toasts: string[] = []
  on('ui.toast', (_$, e) => {
    toasts.push(JSON.stringify(e))
    return { value: undefined }
  })
  on('tool.call', () => ({ result: 'ok' }))
  on('turn.complete', () => ({ text: '' }))
  await $.agent.spawn({ tool_use_id: 'r', prompt: '찾아', description: '찾기', subagentType: 'Explore', ...SPAWN })
  await $.agent.spawn({ tool_use_id: 'd', prompt: '만들어', description: '빌드', subagentType: 'builder', ...SPAWN })
  status = 'done'
  // 한 번의 동기화에서 둘이 끝난다: 앞사람(OWL, 실패)의 평가 뒤 조직 개편이 아직 평가 안 된 BEAR를 내보내면 안 된다
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 'rr', agentId: 'r1', reason: 'answer' })
  expect(toasts.join()).not.toContain('퇴사')
  expect(store.get('hr')).toMatchObject({ employees: [{ nick: 'BEAR', jobs: 2, lastAt: now }, { nick: 'OWL' }], retired: [] })
})
