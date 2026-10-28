// 테스트: 부서 예산.
import { expect, test } from 'claude-code/testing'

import type { HrBook, JobRecord } from '../types'
import { emptyBook, migrate } from '../core/hr'
import { BUDGET_MS, budgetLines, deptNamed, dollarsOf, gateOf, noticed, overOf, overrunText, overrunsOf, spentOf, spentTokensOf, tokensAmountOf } from '../core/budget'
import { agent } from './kit'

test('예산: 부서 이름·금액을 읽고, 최근 24시간 비용(끝낸 일과 결재, 일하는 중인 사람)을 재며, 넘으면 하루에 한 번만 고른다', () => {
  expect([deptNamed('개발팀'), deptNamed('개발'), deptNamed('DEV'), deptNamed('research'), deptNamed('영업')]).toEqual(['dev', 'dev', 'dev', 'research', null])
  expect([dollarsOf('$5'), dollarsOf('2.5'), dollarsOf('0'), dollarsOf('abc'), dollarsOf('1e3'), dollarsOf('0x10'), dollarsOf('-1')]).toEqual([5, 2.5, null, null, null, null, null])
  const use = (usd: number) => ({ input: 1, output: 0, cacheRead: 0, cacheWrite: 0, usd, unpriced: 0 })
  const rec: JobRecord = { nick: 'BEAR', dept: 'dev', job: 1, description: '빌드', startedAt: 0, endedAt: 0, outcome: 'done', score: 13, errors: 0, isCheckFailed: false, isReworked: false, alarms: 0 }
  const now = BUDGET_MS + 1000
  const b: HrBook = { ...emptyBook(), budgets: { dev: 1 }, log: [
    { ...rec, endedAt: now - 1000, tokens: use(0.5), reviewTokens: use(0.1) },
    { ...rec, job: 2, endedAt: 500, tokens: use(9) }, // 24시간 전이라 빠진다
    { ...rec, job: 3, dept: 'qa', endedAt: now, tokens: use(9) },
  ] }
  const running = [agent('x1', { tokens: use(0.3) }), agent('x2', { tokens: use(5), endedAt: now }), agent('main', { dept: 'dev', tokens: use(5) })]
  expect(Math.abs(spentOf(b, running, 'dev', now) - 0.9) < 1e-9).toBe(true)
  expect(overrunsOf(b, running, now)).toEqual([])
  const more = [...running, agent('x3', { tokens: use(0.2) })]
  const over = overrunsOf(b, more, now)
  expect(over.map(o => o.dept)).toEqual(['dev'])
  // 알린 뒤 24시간 동안은 다시 고르지 않고, 지나면 다시 고른다
  const told = noticed(b, ['dev'], now)
  expect(overrunsOf(told, more, now + 1000)).toEqual([])
  expect(overrunsOf(told, more, now + BUDGET_MS + 1).length).toBe(0) // 하루 지나면 옛 기록도 빠져 비용이 줄어든다
  expect(overrunsOf(told, [agent('x9', { tokens: use(2) })], now + BUDGET_MS + 1).map(o => o.dept)).toEqual(['dev'])
  const shown = budgetLines(b, more, now)
  expect(shown[0]).toBe('■ 하루 예산(최근 24시간, 비용은 API 정가로 어림, 토큰은 캐시 읽기 빼고)')
  expect(shown[3]).toMatch(/^개발팀\s+비용\s+\$1\.10\s+\$1\.00\s+110%\s+초과$/)
  expect(budgetLines(emptyBook(), [], now)).toEqual([])

  // 저장된 예산은 모르는 부서·0 이하·수가 아닌 값을 버린다
  const back = migrate(JSON.parse(JSON.stringify({ ...emptyBook(), budgets: { dev: 5, qa: 0, sales: 3, docs: 'x' }, budgetNotices: { dev: 10, nope: 1 } }))) as HrBook
  expect(back.budgets).toEqual({ dev: 5 })
  expect(back.budgetNotices).toEqual({ dev: 10 })
  expect(migrate({ employees: [] })?.budgets).toEqual({})
})

test('토큰 예산: 가격을 모르는 모델(사내 모델)도 토큰 수로 재고, 달러 한도와 함께 둘 수 있다', () => {
  expect(tokensAmountOf('2M')).toBe(2_000_000)
  expect(tokensAmountOf('500k')).toBe(500_000)
  expect(tokensAmountOf('1.5m토큰')).toBe(1_500_000)
  expect(tokensAmountOf('300000t')).toBe(300_000)
  expect(tokensAmountOf('2M tokens')).toBe(2_000_000)
  expect(tokensAmountOf('5')).toBeNull()
  expect(tokensAmountOf('$5')).toBeNull()
  expect(tokensAmountOf('0k')).toBeNull()
  expect(tokensAmountOf('0.4t')).toBeNull()
  expect(tokensAmountOf(' 2M ')).toBe(2_000_000)
  // 가격 모름 토큰(달러 0)만 쓴 사내 모델 일
  const unpriced = { input: 600_000, output: 100_000, cacheRead: 300_000, cacheWrite: 0, usd: 0, unpriced: 1_000_000 }
  const now = 100_000_000
  const b: HrBook = { ...emptyBook(), log: [{ nick: 'BEAR', dept: 'dev', job: 1, description: 'x', startedAt: now - 2000, endedAt: now - 1000, outcome: 'done', score: 10, errors: 0, isCheckFailed: false, isReworked: false, alarms: 0, tokens: unpriced }] }
  // 캐시 읽기(30만)는 빼고 센다: 70만 + 일하는 중인 50만
  expect(spentTokensOf(b, [agent('c1', { tokens: { ...unpriced, input: 500_000, output: 0, cacheRead: 900_000, unpriced: 1_400_000 } })], 'dev', now)).toBe(1_200_000)
  // 달러 한도는 넘지 않지만 토큰 한도는 넘는다
  const both = { ...b, budgets: { dev: 1 }, tokenBudgets: { dev: 560_000 } }
  expect(overOf(both, [], 'dev', now)).toEqual({ dept: 'dev', spent: 700_000, budget: 560_000, unit: 'tokens' })
  expect(overrunText(overOf(both, [], 'dev', now) as never)).toBe('개발팀 하루 토큰 예산 초과: 최근 24시간 700k 토큰 / 예산 560k 토큰(125%)')
  expect(overrunsOf(both, [], now).map(o => o.unit)).toEqual(['tokens'])
  expect(gateOf(both, [], 'dev', now)?.unit).toBe('tokens')
  expect(overOf({ ...both, tokenBudgets: { dev: 2_000_000 } }, [], 'dev', now)).toBeNull()
  const shown = budgetLines(both, [], now).join('\n')
  expect(shown).toMatch(/개발팀\s+비용\s+\$0\.0000\s+\$1\.00\s+0%/)
  expect(shown).toMatch(/개발팀\s+토큰\s+700k\s+560k\s+125%\s+초과/)
  // 저장했다 읽어도 남고, 이상한 값은 버린다
  expect(migrate(JSON.parse(JSON.stringify({ ...both, tokenBudgets: { dev: 560_000, qa: 0, nope: 5, docs: 'x' } })))?.tokenBudgets).toEqual({ dev: 560_000 })
})
