// 테스트: 토큰·비용.
import { expect, test } from 'claude-code/testing'

import type { HrBook, JobRecord } from '../types'
import { emptyBook, hire, migrate } from '../core/hr'
import { cardOf } from '../core/report'
import { addTokens, chargeReview, costText, priceOf, tokenDetail, tokensOf, tokenText, totalOf, usageOf, usdText } from '../core/tokens'

test('토큰: 사용량 네 가지를 더하고 짧게 적으며, 저장된 값은 모양을 보고 읽고, 결재 토큰은 그 일 기록에 붙는다', () => {
  const t = usageOf({ input_tokens: 1200, output_tokens: 800, cache_read_input_tokens: 10_000, cache_creation_input_tokens: 300 }, 'claude-sonnet-5-5')
  // 소네트 5.5: 입력 $2·출력 $10·캐시 읽기 $0.20, 캐시 쓰기는 입력의 1.25배(백만 토큰당)
  expect(Math.abs(t.usd - (1200 * 2 + 800 * 10 + 10_000 * 0.2 + 300 * 2.5) / 1e6) < 1e-12).toBe(true)
  expect(t.unpriced).toBe(0)
  expect(priceOf('claude-opus-5-5')).toEqual({ input: 4, output: 20, cacheRead: 0.2 })
  expect(priceOf('claude-opus-5-20260101')?.input).toBe(5)
  expect(priceOf('claude-sonnet-5-5[1m]')?.input).toBe(2)
  expect(priceOf('haiku')?.input).toBe(0.1)
  expect(priceOf('gpt-x')).toBeNull()
  expect(priceOf('claude-opus-5')?.input).toBe(5)
  expect(priceOf('us.anthropic.claude-opus-5-5-v1:0')?.input).toBe(4)
  expect(priceOf('claude-opus-5-5@20261001')?.input).toBe(4)
  expect(priceOf('claude-opus-5-1')).toBeNull()
  expect(priceOf('claude-opus-4-5')).toBeNull()
  const unknown = usageOf({ input_tokens: 100 }, 'mystery')
  expect([unknown.usd, unknown.unpriced, costText(unknown)]).toEqual([0, 100, '가격 모름'])
  expect(costText(addTokens(t, unknown))).toBe('$0.01+(가격 모름 100)')
  expect([usdText(0.0042), usdText(3.4), usdText(1234)]).toEqual(['$0.0042', '$3.40', '$1,234'])
  expect(totalOf(t)).toBe(12_300)
  expect(usageOf({ input_tokens: 5, output_tokens: Number.NaN })).toEqual({ input: 5, output: 0, cacheRead: 0, cacheWrite: 0, usd: 0, unpriced: 5 })
  expect(totalOf(addTokens(t, undefined))).toBe(12_300)
  expect(totalOf(addTokens(t, t))).toBe(24_600)
  expect([tokenText(850), tokenText(12_300), tokenText(120_000), tokenText(1_234_567)]).toEqual(['850', '12.3k', '120k', '1.2M'])
  expect([tokenText(999.7), tokenText(99_960), tokenText(100_000), tokenText(999_950)]).toEqual(['1.0k', '100k', '100k', '1.0M'])
  expect(tokenDetail(t)).toBe('12.3k(입력 1.2k · 출력 800 · 캐시 읽기 10.0k · 캐시 쓰기 300) · 비용 약 $0.01')
  expect(tokensOf('x')).toBeUndefined()
  expect(tokensOf({ input: 0 })).toBeUndefined()
  // 달러를 세기 전(v0.10)의 값은 모두 가격 모르는 토큰으로 읽는다
  expect(tokensOf({ input: 3, output: 'a' })).toEqual({ input: 3, output: 0, cacheRead: 0, cacheWrite: 0, usd: 0, unpriced: 3 })
  expect(tokensOf({ input: 3, usd: 0.5, unpriced: 99 })).toEqual({ input: 3, output: 0, cacheRead: 0, cacheWrite: 0, usd: 0.5, unpriced: 3 })

  const rec: JobRecord = { nick: 'BEAR', dept: 'dev', job: 1, description: '빌드', startedAt: 0, endedAt: 1, outcome: 'done', score: 13, errors: 0, isCheckFailed: false, isReworked: false, alarms: 0 }
  const b = { ...emptyBook(), log: [rec, { ...rec, job: 2 }] }
  const charged = chargeReview(chargeReview(b, 'BEAR', 1, t), 'BEAR', 1, t)
  expect(totalOf(charged.log[0]?.reviewTokens)).toBe(24_600)
  expect(charged.log[1]?.reviewTokens).toBeUndefined()
  expect(chargeReview(b, 'BEAR', 1, usageOf({}))).toBe(b)

  // 인사 기록을 다시 읽어도 토큰은 남고, 모양이 틀린 값은 버린다
  const stored = { ...emptyBook(), employees: [{ ...hire(emptyBook(), 'BEAR', 'dev', 'builder', 0).employee, tokens: t }, { ...hire(emptyBook(), 'OWL', 'research', 'Explore', 0).employee, tokens: 'bad' }],
    log: [{ ...rec, tokens: t, reviewTokens: { output: 'x' } }] }
  const back = migrate(JSON.parse(JSON.stringify(stored))) as HrBook
  expect(back.employees[0]?.tokens).toEqual(t)
  expect(back.employees[0]?.tokenJobs).toBe(1)

  // 한 건 평균은 토큰을 센 일로만 낸다(토큰 전에 끝낸 일 4건은 빼고), 센 일이 없으면 평균을 적지 않는다
  const vet = { ...hire(emptyBook(), 'BEAR', 'dev', 'builder', 0).employee, jobs: 5, done: 5, tokens: t, tokenJobs: 1 }
  expect(cardOf({ ...emptyBook(), employees: [vet] }, vet, 0)).toContain('· 한 건 평균 12.3k')
  const odd = { ...vet, tokenJobs: undefined }
  expect(cardOf({ ...emptyBook(), employees: [odd] }, odd, 0)).not.toContain('한 건 평균')
  expect('tokens' in (back.employees[1] ?? {})).toBe(false)
  expect(back.log[0]?.tokens).toEqual(t)
  expect(back.log[0]?.reviewTokens).toBeUndefined()
})
