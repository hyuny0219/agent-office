// 훅 테스트(엔진을 흉내 낸 하네스에서): 사무실 패널·메뉴 화면 그리기.
import { expect, test } from 'claude-code/testing'

import { agent, PROPS, RUN, SPAWN } from './kit'

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

for (const surface of ['terminal', 'desktop'] as const) {
  test(`메뉴(${surface}): 사무실 패널의 메뉴 버튼·직원 줄은 메뉴 화면을 열고, 메뉴 화면은 1~5로 고른 것을 패널 안에 표로 보이며, 설정은 그 자리에서 켜고 끈다`, async ($, on) => {
    const store = new Map<string, unknown>()
    on('store.get', (_$, e) => ({ value: store.get(e.key) }))
    on('store.set', (_$, e) => {
      store.set(e.key, e.value)
      return { value: undefined }
    })
    on('clock.now', () => ({ value: 5000 }))
    const opened: string[] = []
    on('ui.open', (_$, e) => {
      opened.push(e.id)
      return { value: { isPlaced: true } }
    })
    const closed: string[] = []
    on('ui.close', (_$, e) => {
      closed.push(e.id)
      return { value: undefined }
    })
    on('agent.spawn', () => ({ model: 'm', agentId: 'c1' }))
    on('agent.list', () => ({ value: [{ id: 'c1', description: '고치기', type: 'builder', status: 'running' }] }))
    await $.agent.spawn({ tool_use_id: 't1', prompt: '버그를 고쳐', description: '고치기', subagentType: 'builder', ...SPAWN })
    await $.command.run({ command: 'office', args: '', ...RUN })
    const office = await $.ui.mount({ plugin: 'agent-office', surface, component: 'Pane', requestId: 'agent-office', props: PROPS, viewport: { columns: 96, rows: 50 } })
    // 사무실 패널에는 메뉴 버튼 하나만: 누르면 메뉴 화면을 연다
    expect(await office.find({ key: 'menu-hr' })).toBeUndefined()
    await office.press({ key: 'open-menu' })
    expect(opened.at(-1)).toBe('agent-office-menu')
    const menu = await $.ui.mount({ plugin: 'agent-office', surface, component: 'Pane', requestId: 'agent-office-menu', props: { ...PROPS, title: '사무실 메뉴' }, viewport: { columns: 96, rows: 50 } })
    const body = async () => String((await menu.find({ key: 'menu-body' }) as { text?: unknown } | undefined)?.text ?? '')
    // 처음엔 인사 명부: 마크다운 표
    expect(await body()).toContain('## 에이전트 사무실 인사 기록')
    expect(await body()).toContain('| 부서 | 직원 | 직급 |')
    await menu.press({ key: 'menu-week' })
    expect(await body()).toContain('## 에이전트 사무실 주간 보고')
    await menu.press({ key: 'menu-today' })
    expect(await body()).toContain('## 에이전트 사무실 일간 보고')
    await menu.press({ key: 'menu-budget' })
    expect(await body()).toContain('부서 예산이 없습니다')
    // 직원 줄을 누르면 메뉴 화면에 그 직원의 인사카드, ← 인사 명부로 돌아간다
    const nick = (await office.find({ key: 'row-c1' }))?.text?.split(' ')[0] ?? ''
    await office.press({ key: 'row-c1' })
    expect(await body()).toContain(`## 인사카드: ${nick} `)
    await menu.press({ key: 'card-back' })
    expect(await body()).toContain('## 에이전트 사무실 인사 기록')
    // 명부 아래 인사카드 버튼
    await menu.press({ key: `card-${nick}` })
    expect(await body()).toContain(`## 인사카드: ${nick} `)
    // BOSS 줄은 인사 기록이 없어 누를 수 없다
    await expect(office.press({ key: 'row-main' })).rejects.toThrow()

    // 설정: 그 자리에서 켜고 끄고, 명부 머리에도 반영된다
    expect(await menu.find({ key: 'set-approval' })).toBeUndefined()
    await menu.press({ key: 'menu-settings' })
    expect((await menu.find({ key: 'set-approval' }))?.text).toBe('[켜짐] 결재')
    await menu.press({ key: 'set-approval' })
    expect((await menu.find({ key: 'set-approval' }))?.text).toBe('[꺼짐] 결재')
    await menu.press({ key: 'set-approval' })
    expect((await menu.find({ key: 'set-approval' }))?.text).toBe('[켜짐] 결재')
    for (const key of ['set-reorg', 'set-coach', 'set-trial']) await menu.press({ key })
    expect((await menu.find({ key: 'set-reorg' }))?.text).toBe('[꺼짐] 조직 개편')
    const head = String((await $.command.run({ command: 'office', args: 'hr', ...RUN }) as { text?: string }).text ?? '')
    expect(head).toContain('인사 메모 꺼짐 · 교육 효과 측정 꺼짐 · 결재 켜짐 · 조직 개편 꺼짐')
    // 슬래시 명령으로 바꿔도 버튼 표시가 따라온다
    await $.command.run({ command: 'office', args: 'reorg on', ...RUN })
    expect((await menu.find({ key: 'set-reorg' }))?.text).toBe('[켜짐] 조직 개편')
    // /office menu(대소문자 무관)로도 열고, 닫기로 닫는다
    await $.command.run({ command: 'office', args: 'MENU', ...RUN })
    expect(opened.filter(x => x === 'agent-office-menu').length).toBeGreaterThanOrEqual(3)
    await menu.press({ key: 'menu-close' })
    expect(closed).toEqual(['agent-office-menu'])
  })
}
