// omp판 확장 사건 테스트(bun test omp). oh-my-pi 없이 돈다: 모델 호출(@oh-my-pi/pi-ai)은 가짜로 바꾸고, 인사 기록은 임시 폴더에 둔다.
import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'agent-office-omp-'))
process.env.AGENT_OFFICE_HOME = home

/** 결재자 모델이 돌려줄 답(테스트마다 바꾼다) */
let answer = '적합'
let calls = 0
/** 걸어 두면 결재자 답을 그때까지 늦춘다 */
let gate: Promise<void> | null = null
/** 마지막으로 결재자를 부른 모델과 옵션 */
let lastCall: { model: any; options: any } | null = null
mock.module('@oh-my-pi/pi-ai', () => ({
  completeSimple: async (model: any, _req: any, options: any) => {
    calls++
    lastCall = { model, options }
    if (gate !== null) await gate
    return { content: [{ type: 'text', text: answer }], usage: {} }
  },
}))

type Handler = (e: any, ctx: any) => Promise<any>
const handlers = new Map<string, Handler>()
const notified: string[] = []
const ctx: any = {
  agent: { kind: 'main' },
  hasUI: true,
  ui: { notify: (t: string) => notified.push(t) },
  models: { resolve: () => ({ id: 'claude-haiku-5-5' }) },
  modelRegistry: { getApiKey: async () => 'key' },
}
const fire = (name: string, e: any) => (handlers.get(name) as Handler)(e, ctx)
const settle = () => new Promise(r => setTimeout(r, 20))
/** 메인의 도구 결과 하나를 흘려보내고, 덧붙은 글을 돌려준다 */
async function mainResult(): Promise<string> {
  const r = await fire('tool_result', { toolName: 'read', input: { path: '/a' }, content: [{ type: 'text', text: 'ok' }], isError: false })
  return r === undefined ? '' : r.content.slice(1).map((c: { text: string }) => c.text).join('')
}

beforeAll(async () => {
  const mod = await import('./index')
  mod.default({ registerCommand: () => undefined, on: (name: string, fn: Handler) => handlers.set(name, fn) })
  await fire('session_start', {})
})
afterAll(() => rmSync(home, { recursive: true, force: true }))

describe('계획 검토', () => {
  test('검토 창이 열리면 기획팀장이 검토해 알리고, 보완인데 그대로 실행하면 메인의 다음 도구 결과 뒤에 의견을 붙인다', async () => {
    answer = '보완\n- 단계마다 테스트를 돌릴 것'
    await fire('plan_review_requested', { type: 'plan_review_requested', reviewId: 'r1', planContent: '1. 고친다\n2. 끝낸다' })
    await settle()
    expect(calls).toBe(1)
    expect(notified.some(t => t.includes('계획 검토: 보완 · 단계마다 테스트를 돌릴 것'))).toBe(true)
    // 창이 닫히기 전에는 붙이지 않는다
    expect(await mainResult()).toBe('')
    await fire('plan_review_resolved', { type: 'plan_review_resolved', reviewId: 'r1', choice: 'execute' })
    await settle()
    const note = await mainResult()
    expect(note).toContain('계획 검토: 보완이 필요합니다')
    expect(note).toContain('- 단계마다 테스트를 돌릴 것')
    // 한 번만 붙는다
    expect(await mainResult()).toBe('')
  })

  test('창이 검토보다 먼저 닫혀도(실행) 늦게 온 보완 의견을 붙이고, 메인이 턴을 끝내면 버린다', async () => {
    answer = '보완\n- 되돌리는 법을 적을 것'
    let open = () => undefined as void
    gate = new Promise(r => {
      open = r
    })
    await fire('plan_review_requested', { reviewId: 'late', planContent: '계획' })
    await fire('plan_review_resolved', { reviewId: 'late', choice: 'execute' })
    expect(await mainResult()).toBe('')
    open()
    gate = null
    await settle()
    expect(await mainResult()).toContain('되돌리는 법을 적을 것')
    // 다시: 이번에는 붙기 전에 메인이 턴을 끝낸다
    await fire('plan_review_requested', { reviewId: 'ended', planContent: '계획' })
    await settle()
    await fire('plan_review_resolved', { reviewId: 'ended', choice: 'execute' })
    await settle()
    await fire('agent_end', { willContinue: false, messages: [] })
    expect(await mainResult()).toBe('')
  })

  test('서브에이전트의 검토 창 사건은 무시하고, 결재자 모델이 없는 설정이면 알리지 않는다', async () => {
    const before = calls
    ctx.agent = { kind: 'sub', id: 's1' }
    await fire('plan_review_requested', { reviewId: 'sub', planContent: '계획' })
    ctx.agent = { kind: 'main' }
    await settle()
    expect(calls).toBe(before)
    const resolve = ctx.models.resolve
    ctx.models.resolve = () => undefined
    const said = notified.length
    await fire('plan_review_requested', { reviewId: 'nomodel', planContent: '계획' })
    await settle()
    expect(notified.length).toBe(said)
    ctx.models.resolve = resolve
  })

  test('다시 쓰기를 고르거나 적합이면 붙이지 않고, 결재를 끄면 검토하지 않는다', async () => {
    answer = '보완\n- 범위를 적을 것'
    await fire('plan_review_requested', { reviewId: 'r2', planContent: '계획' })
    await fire('plan_review_resolved', { reviewId: 'r2', choice: 'refine' })
    await settle()
    expect(await mainResult()).toBe('')
    answer = '적합'
    await fire('plan_review_requested', { reviewId: 'r3', planContent: '계획' })
    await settle()
    await fire('plan_review_resolved', { reviewId: 'r3', choice: 'execute' })
    await settle()
    expect(notified.some(t => t.includes('계획 검토: 적합'))).toBe(true)
    expect(await mainResult()).toBe('')
    const before = calls
    const { saveHr } = await import('./store')
    saveHr(b => ({ ...b, isApproving: false }))
    await fire('plan_review_requested', { reviewId: 'r4', planContent: '계획' })
    await settle()
    expect(calls).toBe(before)
  })
})

describe('사내 모델(GLM만 쓸 수 있을 때)', () => {
  const glm = { id: 'GLM-5.2-NVFP4', cost: { input: 0, output: 0, cacheRead: 0 } }
  test('Haiku가 없으면 세션 모델이 결재하고, 추론을 끄며, 생각 블록이 섞인 답도 읽는다', async () => {
    const { saveHr } = await import('./store')
    saveHr(b => ({ ...b, isApproving: true }))
    const was = { resolve: ctx.models.resolve, current: ctx.models.current }
    ctx.models.resolve = (spec: string) => (/glm/i.test(spec) ? glm : undefined)
    ctx.models.current = () => glm
    answer = '<think>\n계획에 테스트 단계가 없다.\n</think>\n보완\n- 테스트 단계를 넣을 것'
    await fire('plan_review_requested', { reviewId: 'glm', planContent: '계획' })
    await settle()
    expect(lastCall?.model.id).toBe('GLM-5.2-NVFP4')
    expect(lastCall?.options.disableReasoning).toBe(true)
    expect(notified.some(t => t.includes('계획 검토: 보완 · 테스트 단계를 넣을 것'))).toBe(true)
    try {
      // Haiku가 아니면 답 한도를 넉넉히(끄는 옵션이 안 먹혀도 생각 뒤에 답할 자리)
      expect(lastCall?.options.maxTokens).toBe(1_500)
      // AGENT_OFFICE_APPROVER로 고른 모델이 먼저
      process.env.AGENT_OFFICE_APPROVER = 'glm-5.2'
      ctx.models.current = () => ({ id: 'other' })
      await fire('plan_review_requested', { reviewId: 'env', planContent: '계획' })
      await settle()
      expect(lastCall?.model.id).toBe('GLM-5.2-NVFP4')
    } finally {
      delete process.env.AGENT_OFFICE_APPROVER
      Object.assign(ctx.models, was)
    }
  })

  test('가격표에 없는 모델은 omp 모델 목록의 가격으로 비용을 세고, 가격이 0이면 가격 모름 토큰으로 적는다(토큰 예산으로 잰다)', async () => {
    const { agents } = await import('./store')
    const was = ctx.models.resolve
    const usage = { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 }
    ctx.models.resolve = (spec: string) => (spec === 'priced-model' ? { id: spec, cost: { input: 2, output: 8, cacheRead: 0.5 } } : glm)
    const before = agents.get('main')?.tokens
    await fire('message_end', { message: { role: 'assistant', model: 'priced-model', usage } })
    const mid = agents.get('main')?.tokens
    expect((mid?.usd ?? 0) - (before?.usd ?? 0)).toBeCloseTo(2, 5)
    try {
      await fire('message_end', { message: { role: 'assistant', model: 'GLM-5.2-NVFP4', usage } })
      const after = agents.get('main')?.tokens
      expect((after?.usd ?? 0) - (mid?.usd ?? 0)).toBe(0)
      expect((after?.unpriced ?? 0) - (mid?.unpriced ?? 0)).toBe(1_000_000)
      // omp가 셈한 비용(usage.cost.total)이 있으면 그것을 쓴다
      await fire('message_end', { message: { role: 'assistant', model: 'GLM-5.2-NVFP4', usage: { ...usage, cost: { total: 0.5 } } } })
      expect((agents.get('main')?.tokens?.usd ?? 0) - (after?.usd ?? 0)).toBeCloseTo(0.5, 5)
    } finally {
      ctx.models.resolve = was
    }
  })
})
