// 훅 테스트(엔진을 흉내 낸 하네스에서): 토큰·예산·대표 평가·업무 노트·부서 지침 명령.
import { expect, test } from 'claude-code/testing'

import type { JobRecord } from '../types'
import { emptyBook, hire, migrate, rate, review } from '../core/hr'
import { rankChangeText } from '../core/answer'
import { adopt } from '../core/playbook'
import { isRejectTrusted } from '../core/org'
import { agent, boss, run, PROPS, RUN, SPAWN } from './kit'

test('토큰: 일하며 부른 모델의 토큰을 패널 줄에 보이고, 끝나면 그 일·직원 누적·결재 토큰으로 명부·인사카드·보고서에 남긴다', async ($, on) => {
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
  on('ui.toast', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('model.complete', () => ({ value: { isAnswered: true, text: '승인', usage: { input_tokens: 400, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }) as never)
  on('tool.call', (_$, e) => {
    if (e.tool === 'Agent') return { result: { status: 'completed', agentId: 'c1', content: [{ type: 'text', text: '고쳤습니다' }] } } as never
    return { result: 'ok' }
  })
  on('turn.complete', () => ({ text: '' }))
  const usage = { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 8000, cache_creation_input_tokens: 500, model: 'claude-sonnet-5-5' }
  on('turn.step', async function* (_$, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage }
  })
  const step = async (agentId?: string) => {
    const s = $.turn.step({ turnId: 's', index: 0, model: 'm', messageCount: 1, ...(agentId === undefined ? {} : { agentId }) })
    let r = await s.next()
    while (r.done !== true) r = await s.next()
    return r.value
  }

  await $.agent.spawn({ tool_use_id: 't9', prompt: '버그를 고쳐', description: '고치기', subagentType: 'builder', ...SPAWN })
  await $.command.run({ command: 'office', args: '', ...RUN })
  expect((await step('c1')).usage).toEqual(usage)
  await step('c1')
  await step()
  const ui = await $.ui.mount({ plugin: 'agent-office', surface: 'terminal', component: 'Pane', requestId: 'agent-office', props: PROPS, viewport: { columns: 96, rows: 50 } })
  // 한 번에 $0.00985(입력 1000×$2 + 출력 500×$10 + 캐시 읽기 8000×$0.2 + 캐시 쓰기 500×$2.5, 백만 토큰당)
  // 띄울 때 받은 모델('m') 대신 실제로 답한 모델을 짧게 보인다. 96칸에선 말풍선·도구 수를 빼고 들어간다
  expect((await ui.find({ key: 'row-c1' }))?.text).toBe('BEAR 곰 사원 (개발팀) · 회의실: 보스와 대화 · Sonnet 5.5 · 토큰 20.0k($0.02) · 0분 · 고치기')
  expect((await ui.find({ key: 'row-main' }))?.text).toContain('토큰 10.0k($0.0098)')

  for (const f of ['a', 'b', 'c']) await $.tool.call({ tool: 'Read', file_path: `/r/${f}.ts`, agentId: 'c1' } as never)
  status = 'completed'
  await $.turn.complete({ answer: '고쳤습니다', durationMs: 1, isAborted: false, turnId: 'z', agentId: 'c1', reason: 'answer' })
  await $.tool.call({ tool: 'Agent', description: '고치기', prompt: '버그를 고쳐', subagent_type: 'builder' } as never)
  await $.tool.call({ tool: 'Read', file_path: '/r/x.ts' } as never)

  expect(JSON.stringify(await $.command.run({ command: 'office', args: 'hr', ...RUN }))).toMatch(/BEAR 곰  사원·팀장 +[\d,]+만  S +1\/0 +0  20\.0k\(\$0\.02\) +13/)
  const card = JSON.stringify(await $.command.run({ command: 'office', args: 'hr BEAR', ...RUN }))
  expect(card).toMatch(/토큰 누적\s+20\.0k\(/)
  expect(card).toContain('20.0k(입력 2.0k · 출력 1.0k · 캐시 읽기 16.0k · 캐시 쓰기 1.0k) · 비용 약 $0.02 · 한 건 평균 20.0k')
  expect(card).toMatch(/\s20\.0k\(\$0\.02\)/)
  const report = JSON.stringify(await $.command.run({ command: 'office', args: 'report', ...RUN }))
  // 결재(haiku = 하이쿠 5.5)는 400×$0.1 + 100×$0.5 = $0.00009
  expect(report).toContain('비용 약 $0.02 · 토큰 업무 20.0k($0.02) · 결재 500($0.0001)(API 정가로 어림')
  expect(report).toContain('■ 부서별(토큰·비용은 결재 포함)')
  expect(report).toContain('개발팀     1        1/0    100%  S(13.0)       0  20.5k  $0.02')
  expect(report).toMatch(/BEAR 곰\s+20\.0k\s+\$0\.02\s+1\s+20\.0k/)
})

test('예산: /office budget으로 정하고 끄며, 일하는 직원이 한도를 넘기면 토스트와 메신저로 한 번만 알리고, 일간 보고에 싣는다', async ($, on) => {
  const store = new Map<string, unknown>()
  on('store.get', (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', (_$, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('clock.now', () => ({ value: 5000 }))
  on('agent.spawn', () => ({ model: 'm', agentId: 'c1' }))
  on('agent.list', () => ({ value: [{ id: 'c1', description: '고치기', type: 'builder', status: 'running' }] }))
  const toasts: string[] = []
  on('ui.toast', (_$, e) => {
    toasts.push(JSON.stringify(e))
    return { value: undefined }
  })
  on('tool.call', () => ({ result: 'ok' }))
  // 한 번에 오퍼스 5.5 출력 100만 토큰 = $20
  on('turn.step', async function* (_$, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: { input_tokens: 0, output_tokens: 1_000_000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'claude-opus-5-5' } }
  })
  const step = async (agentId?: string) => {
    const s = $.turn.step({ turnId: 's', index: 0, model: 'm', messageCount: 1, ...(agentId === undefined ? {} : { agentId }) })
    let r = await s.next()
    while (r.done !== true) r = await s.next()
  }
  const run = async (args: string) => JSON.stringify(await $.command.run({ command: 'office', args, ...RUN }))

  expect(await run('budget')).toContain('부서 예산이 없습니다')
  expect(await run('budget 영업 5')).toContain('영업라는 부서가 없습니다')
  expect(await run('budget 개발팀 abc')).toContain('쓰는 법')
  expect(await run('budget 개발팀 30')).toContain('개발팀 하루 예산을 $30.00로 정합니다')
  expect(await run('hr')).toContain('예산: 개발팀 하루 $30.00')

  await $.agent.spawn({ tool_use_id: 't1', prompt: '고쳐', description: '고치기', subagentType: 'builder', ...SPAWN })
  await step('c1')
  expect(toasts.join()).not.toContain('예산 초과')
  // BOSS가 쓴 것은 부서 예산에 들지 않는다
  await step()
  await step()
  expect(toasts.join()).not.toContain('예산 초과')
  await step('c1')
  expect(toasts.filter(t => t.includes('예산 초과')).length).toBe(1)
  expect(toasts.join()).toContain('개발팀 하루 예산 초과: 최근 24시간 $40.00 / 예산 $30.00(133%)')
  await step('c1')
  expect(toasts.filter(t => t.includes('예산 초과')).length).toBe(1)
  expect(await run('report')).toMatch(/개발팀\s+\$60\.00\s+\$30\.00\s+200%\s+초과/)
  expect(await run('budget')).toContain('하루 예산(최근 24시간')
  // 한도를 새로 정하면 다시 알릴 수 있다
  await run('budget dev 50')
  await step('c1')
  expect(toasts.filter(t => t.includes('예산 초과')).length).toBe(2)
  expect(await run('budget 개발 OFF')).toContain('개발팀 예산을 없앱니다')
  expect(await run('budget')).toContain('부서 예산이 없습니다')
})

test('토큰: v0.10이 남긴 사무실 사람들의 토큰(달러 없음)은 가격 모름으로 읽고, 더해도 $0으로 굳지 않는다', async ($, on) => {
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('clock.now', () => ({ value: 5000 }))
  // v0.10이 남긴 사무실 사람들(처음 한 번 읽고, 그 뒤로는 모듈 사본을 쓴다)
  on('state.get', (_$, e) => ({ value: { value: (e as { key?: string }).key === 'agents' ? [{ ...boss, tokens: { input: 5000, output: 0, cacheRead: 0, cacheWrite: 0 } }] : [], version: 1 } }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('turn.step', async function* (_$, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: { input_tokens: 1_000_000, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'claude-opus-5-5' } }
  })
  const s = $.turn.step({ turnId: 's', index: 0, model: 'm', messageCount: 1 })
  let r = await s.next()
  while (r.done !== true) r = await s.next()
  await $.command.run({ command: 'office', args: '', ...RUN })
  const ui = await $.ui.mount({ plugin: 'agent-office', surface: 'terminal', component: 'Pane', requestId: 'agent-office', props: PROPS, viewport: { columns: 96, rows: 50 } })
  expect((await ui.find({ key: 'row-main' }))?.text).toContain('토큰 1.0M($4.00+(가격 모름 5.0k))')
})

test('대표 평가: /office rate로 최근 일에 주고, 메뉴 화면의 인사카드 버튼으로 주고 거둔다', async ($, on) => {
  const store = new Map<string, unknown>()
  let b = hire(emptyBook(), 'BEAR', 'dev', 'builder', 0).book
  b = review(b, 'BEAR', { isDone: true, isKilled: false, errors: 0, tools: 5, isCheckFailed: false }, 1000).book
  b = { ...b, log: [{ nick: 'BEAR', dept: 'dev', job: 1, description: '빌드 고치기', startedAt: 0, endedAt: 1000, outcome: 'done', score: 13, errors: 0, isCheckFailed: false, isReworked: false, alarms: 0 }] }
  store.set('hr', b)
  on('store.get', (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', (_$, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('clock.now', () => ({ value: 5000 }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  const run = async (args: string) => String((await $.command.run({ command: 'office', args, ...RUN }) as { text?: string }).text ?? '')
  expect(await run('rate')).toContain('쓰는 법')
  expect(await run('rate NOBODY good')).toContain('직원이 없습니다')
  expect(await run('rate bear good')).toBe('BEAR "빌드 고치기"에 대표 평가 좋음(+3)을 줍니다.')
  expect(await run('hr bear')).toMatch(/빌드 고치기\s+완료\s+S\(\+16\)\s+좋음/)
  expect(await run('rate 곰 clear')).toContain('거둡니다')
  expect(await run('hr bear')).toMatch(/빌드 고치기\s+완료\s+S\(\+13\)\s+-/)

  const menu = await $.ui.mount({ plugin: 'agent-office', surface: 'terminal', component: 'Pane', requestId: 'agent-office-menu', props: { ...PROPS, title: '사무실 메뉴' }, viewport: { columns: 96, rows: 50 } })
  await menu.press({ key: 'card-BEAR' })
  expect((await menu.find({ key: 'rate-bad-1' }))?.text).toBe('아쉬움')
  await menu.press({ key: 'rate-bad-1' })
  expect((await menu.find({ key: 'rate-bad-1' }))?.text).toBe('[아쉬움]')
  expect(await run('hr bear')).toMatch(/빌드 고치기\s+완료\s+A\(\+10\)\s+아쉬움/)
  // 같은 것을 다시 누르면 거둔다
  await menu.press({ key: 'rate-bad-1' })
  expect((await menu.find({ key: 'rate-bad-1' }))?.text).toBe('아쉬움')
  expect(await run('hr bear')).toMatch(/빌드 고치기\s+완료\s+S\(\+13\)\s+-/)
})

test('대표 평가 경계: 경력이 0 근처여도 주고 거두면 원래 경력으로, 떠난 직원은 평가하지 않고, 이상한 값은 읽지 않으며, 결재자 신뢰에 반영된다', async ($, on) => {
  // 경력 1인 직원: 아쉬움(-3)은 0에서 멈추고, 거두면 1로 돌아온다(공짜 경력 없음)
  let b = hire(emptyBook(), 'BEAR', 'dev', 'builder', 0).book
  b = { ...b, employees: b.employees.map(e => ({ ...e, xp: 1, jobs: 1, lastScore: 1, avgScore: 1 })),
    log: [{ nick: 'BEAR', dept: 'dev', job: 1, description: '일', startedAt: 0, endedAt: 1, outcome: 'done', score: 1, errors: 0, isCheckFailed: false, isReworked: false, alarms: 0 }] }
  const bad = rate(b, 'BEAR', 1, 'bad').book
  expect([bad.employees[0]?.xp, bad.log[0]?.bossXp]).toEqual([0, -1])
  expect(rate(bad, 'BEAR', 1, null).book.employees[0]?.xp).toBe(1)
  // 아쉬움 → 좋음 → 거두기 왕복도 그대로
  const good = rate(bad, 'BEAR', 1, 'good').book
  expect([good.employees[0]?.xp, good.log[0]?.bossXp]).toEqual([4, 3])
  expect(rate(good, 'BEAR', 1, null).book.employees[0]?.xp).toBe(1)
  // 떠난 직원은 그대로
  const gone = { ...b, employees: [], retired: [{ ...b.employees[0]!, retiredAt: 2, reason: '계약 종료' }] }
  expect(rate(gone, 'BEAR', 1, 'good').book).toBe(gone)
  // 이상한 값은 읽지 않는다
  expect(migrate(JSON.parse(JSON.stringify({ ...b, log: [{ ...b.log[0], bossRating: 'meh', bossXp: 9 }] }))).log[0]).not.toHaveProperty('bossRating')
  // 반려에 좋음이 쌓이면(빗나간 반려 3건) 그 결재자의 반려는 감점을 유예한다
  const rec = { nick: 'BEAR', dept: 'dev', description: '일', startedAt: 0, endedAt: 1, outcome: 'done', score: 10, errors: 0, isCheckFailed: false, isReworked: false, alarms: 0, approval: 'rejected', approver: 'OWL' } as const
  const judged = { ...b, log: [1, 2, 3].map(job => ({ ...rec, job, bossRating: 'good' as const })) }
  expect(isRejectTrusted({ ...b, log: [1, 2, 3].map(job => ({ ...rec, job })) }, 'OWL', 2)).toBe(true)
  expect(isRejectTrusted(judged, 'OWL', 2)).toBe(false)

  // 명령: 떠난 직원은 거절, 승진하면 알린다
  const store = new Map<string, unknown>([['hr', gone]])
  on('store.get', (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', (_$, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('clock.now', () => ({ value: 5000 }))
  const run = async (args: string) => String((await $.command.run({ command: 'office', args, ...RUN }) as { text?: string }).text ?? '')
  expect(await run('rate bear good')).toBe('BEAR는 떠난 직원이라 평가할 수 없습니다.')
  // 승진하면 알린다(대리 20)
  const near = { ...b, employees: b.employees.map(e => ({ ...e, xp: 18 })) }
  const up = rate(near, 'BEAR', 1, 'good')
  expect(up.promotedTo).toBe('대리')
  expect(rankChangeText(up)).toBe(' (대리로 승진)')
  expect(rankChangeText(rate(up.book, 'BEAR', 1, null))).toBe(' (사원으로 강등)')
})

test('업무 노트: 끝낸 일의 보고가 노트로 남고, 같은 직원에게 비슷한 일을 맡기면 업무 지시에 그 노트가 붙는다', async ($, on) => {
  const store = new Map<string, unknown>()
  on('store.get', (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', (_$, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('clock.now', () => ({ value: 5000 }))
  on('ui.toast', () => ({ value: undefined }))
  const prompts: string[] = []
  let next = 'c1'
  on('agent.spawn', (_$, e) => {
    prompts.push(e.prompt)
    return { model: 'm', agentId: next }
  })
  const status: Record<string, string> = { c1: 'running' }
  on('agent.list', () => ({ value: Object.entries(status).map(([id, s]) => ({ id, description: '로그인 버그 고치기', type: 'builder', status: s })) }))
  on('tool.call', (_$, e) => {
    if (e.tool === 'Bash') return { result: 'fail', isError: true, text: 'Exit code 1\nFAIL login.test.ts' } as never
    return { result: 'ok' }
  })
  on('turn.complete', () => ({ text: '' }))
  await $.command.run({ command: 'office', args: 'approval off', ...RUN })
  await $.agent.spawn({ tool_use_id: 't1', prompt: '로그인 버그를 고쳐', description: '로그인 버그 고치기', subagentType: 'builder', ...SPAWN })
  await $.tool.call({ tool: 'Edit', file_path: '/r/src/login.ts', old_string: 'a', new_string: 'b', agentId: 'c1' } as never)
  await $.tool.call({ tool: 'Bash', command: 'npm test', description: '테스트', agentId: 'c1' } as never)
  status.c1 = 'completed'
  await $.turn.complete({ answer: '## 결과\n- 세션 만료 처리를 고쳤으나 테스트 하나가 아직 실패', durationMs: 1, isAborted: false, turnId: 'z', agentId: 'c1', reason: 'answer' })
  const card = String((await $.command.run({ command: 'office', args: 'hr bear', ...RUN }) as { text?: string }).text ?? '')
  expect(card).toContain('■ 업무 노트')
  expect(card).toContain('보고 「세션 만료 처리를 고쳤으나 테스트 하나가 아직 실패」 · 파일: login.ts · 오류 「Bash: FAIL login.test.ts」')
  // 같은 직원에게 비슷한 일: 노트가 업무 지시에 붙는다
  next = 'c2'
  await $.agent.spawn({ tool_use_id: 't2', prompt: '로그인 버그를 다시 고쳐', description: '로그인 버그 다시 고치기', subagentType: 'builder', ...SPAWN })
  expect(prompts[1]).toContain('BEAR의 지난 업무 노트입니다')
  expect(prompts[1]).toContain('- "로그인 버그 고치기" · 테스트·빌드 실패한 채 끝냄 · 파일: login.ts · 오류 난 도구: Bash')
  expect(prompts[1]).not.toContain('세션 만료 처리를 고쳤으나')
  // 첫 업무에는 노트가 없다
  expect(prompts[0]).not.toContain('지난 업무 노트')
})

test('부서 지침: /office playbook으로 보고 채택·빼기, 메뉴 화면 6에서 버튼으로 채택한다', async ($, on) => {
  const store = new Map<string, unknown>()
  const rec = (job: number, over: Partial<JobRecord> = {}): JobRecord => ({ nick: 'BEAR', dept: 'dev', job, description: `일 ${job}`, startedAt: 0, endedAt: job, outcome: 'done', score: 10, errors: 0, isCheckFailed: job % 2 === 0, isReworked: false, alarms: 0, ...over })
  store.set('hr', { ...hire(emptyBook(), 'BEAR', 'dev', 'builder', 0).book, log: [6, 5, 4, 3, 2, 1].map(j => rec(j)) })
  on('store.get', (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', (_$, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('clock.now', () => ({ value: 5000 }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  const run = async (args: string) => String((await $.command.run({ command: 'office', args, ...RUN }) as { text?: string }).text ?? '')
  expect(await run('playbook')).toContain('끝내기 전에 테스트·빌드를 돌리고')
  expect(await run('playbook 없는팀 adopt 1')).toContain('없는팀라는 부서가 없습니다')
  expect(await run('playbook 개발팀 adopt 9')).toContain('채택할 후보가 없습니다')
  expect(await run('playbook 개발팀 adopt 1')).toContain('개발팀 지침에 1개를 더합니다')
  expect(await run('playbook')).toContain('전후 비교: 적용 뒤 끝낸 업무가 아직 없습니다')
  expect(await run('playbook 개발팀 drop 1')).toContain('개발팀 지침에서 뺍니다')
  expect(await run('playbook 개발팀 drop 1')).toContain('1번 지침이 없습니다')
  // 메뉴 6: 후보 버튼으로 채택
  const menu = await $.ui.mount({ plugin: 'agent-office', surface: 'terminal', component: 'Pane', requestId: 'agent-office-menu', props: { ...PROPS, title: '사무실 메뉴' }, viewport: { columns: 96, rows: 50 } })
  await menu.press({ key: 'menu-playbook' })
  expect(String((await menu.find({ key: 'menu-body' }) as { text?: unknown } | undefined)?.text ?? '')).toContain('## 부서 지침(에이전트 개선)')
  // 버튼 주소는 지침 열쇠(번호가 아니라)라 그린 뒤 후보가 바뀌어도 다른 지침을 채택하지 않는다
  await menu.press({ key: 'adopt-dev-check' })
  expect(await menu.find({ key: 'drop-dev-check' })).toBeDefined()
  expect(await run('playbook')).toContain('■ 개발팀')
  await menu.press({ key: 'drop-dev-check' })
  expect(await menu.find({ key: 'adopt-dev-check' })).toBeDefined()
})
