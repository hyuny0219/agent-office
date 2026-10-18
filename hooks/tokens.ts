// 토큰 사용량. 모델을 부를 때마다 엔진이 알려 주는 네 가지 수(입력·출력·캐시 읽기·캐시 쓰기)를 더하고 짧게 적는다.
// 직원이 일하며 쓴 것은 그 일 기록과 직원 누적에, 결재자가 그 일을 결재하며 쓴 것은 그 일 기록에 따로 둔다. 순수 함수만 둔다.
import type { HrBook, TokenUse } from '../types'

/** 엔진이 주는 사용량(API의 철자). 빠진 수는 0으로 본다 */
type Usage = { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }

const count = (x: unknown): number => (typeof x === 'number' && Number.isFinite(x) && x > 0 ? x : 0)

export const usageOf = (u: Usage): TokenUse => ({
  input: count(u.input_tokens), output: count(u.output_tokens), cacheRead: count(u.cache_read_input_tokens), cacheWrite: count(u.cache_creation_input_tokens),
})

export const addTokens = (a: TokenUse | undefined, b: TokenUse | undefined): TokenUse => ({
  input: (a?.input ?? 0) + (b?.input ?? 0), output: (a?.output ?? 0) + (b?.output ?? 0),
  cacheRead: (a?.cacheRead ?? 0) + (b?.cacheRead ?? 0), cacheWrite: (a?.cacheWrite ?? 0) + (b?.cacheWrite ?? 0),
})

/** 네 가지를 다 더한 수(모델이 읽고 쓴 토큰 전부) */
export const totalOf = (t: TokenUse | undefined): number => (t === undefined ? 0 : t.input + t.output + t.cacheRead + t.cacheWrite)

/** 짧게: 850, 12.3k, 120k, 1.2M */
export function tokenText(n: number): string {
  // 반올림하면 윗자리가 되는 수는 윗 단위로 적는다(999.7 → 1.0k, 99,960 → 100k, 999,950 → 1.0M)
  if (Math.round(n) < 1000) return `${Math.round(n)}`
  if (n < 99_950) return `${(n / 1000).toFixed(1)}k`
  if (n < 999_500) return `${(n / 1000).toFixed(0)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

/** 자세히: 12.3k(입력 1.2k · 출력 800 · 캐시 읽기 10.0k · 캐시 쓰기 300) */
export const tokenDetail = (t: TokenUse): string =>
  `${tokenText(totalOf(t))}(입력 ${tokenText(t.input)} · 출력 ${tokenText(t.output)} · 캐시 읽기 ${tokenText(t.cacheRead)} · 캐시 쓰기 ${tokenText(t.cacheWrite)})`

/** 저장된 값을 읽는다(모양이 다르면 없던 것으로) */
export function tokensOf(x: unknown): TokenUse | undefined {
  if (typeof x !== 'object' || x === null) return undefined
  const v = x as Record<string, unknown>
  const t = { input: count(v.input), output: count(v.output), cacheRead: count(v.cacheRead), cacheWrite: count(v.cacheWrite) }
  return totalOf(t) === 0 ? undefined : t
}

/** 그 일(직원·몇 번째 일)을 결재하며 쓴 토큰을 그 일 기록에 더한다 */
export const chargeReview = (book: HrBook, nick: string, job: number, t: TokenUse): HrBook =>
  totalOf(t) === 0 ? book : { ...book, log: book.log.map(r => (r.nick === nick && r.job === job ? { ...r, reviewTokens: addTokens(r.reviewTokens, t) } : r)) }
