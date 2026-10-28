// 토큰 사용량과 비용. 모델을 부를 때마다 엔진이 알려 주는 네 가지 수(입력·출력·캐시 읽기·캐시 쓰기)를 더하고,
// 그 모델의 API 정가로 달러를 어림해 함께 쌓는다. 직원이 일하며 쓴 것은 그 일 기록과 직원 누적에, 결재자가 그 일을
// 결재하며 쓴 것은 그 일 기록에 따로 둔다. 순수 함수만 둔다.
import type { HrBook, TokenUse } from '../types'

/** 엔진이 주는 사용량(API의 철자). 빠진 수는 0으로 본다 */
type Usage = { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }

const count = (x: unknown): number => (typeof x === 'number' && Number.isFinite(x) && x > 0 ? x : 0)

/** 백만 토큰당 달러: 입력·출력·캐시 읽기. 캐시 쓰기는 입력의 1.25배(5분 캐시)로 본다(엔진은 1시간 캐시 쓰기를 따로 알려 주지 않는다) */
export type Price = { input: number; output: number; cacheRead: number }
export const CACHE_WRITE_RATE = 1.25

/**
 * Anthropic API 정가(2026-10 기준). 모델 id에 들어 있는 이름으로 찾는다(긴 이름부터: "opus-5-5"가 "opus-5"보다 먼저).
 * 버전 없는 별칭(haiku·sonnet·opus)은 지금 세대로 본다
 */
const PRICES: [string, Price][] = [
  ['fable-5-1', { input: 10, output: 50, cacheRead: 0.25 }],
  ['mythos-5-1', { input: 10, output: 50, cacheRead: 0.25 }],
  ['fable-5', { input: 10, output: 50, cacheRead: 1 }],
  ['mythos-5', { input: 10, output: 50, cacheRead: 1 }],
  ['opus-5-5', { input: 4, output: 20, cacheRead: 0.2 }],
  ['opus-5', { input: 5, output: 25, cacheRead: 0.5 }],
  ['opus-4-8', { input: 5, output: 25, cacheRead: 0.5 }],
  ['opus-4-7', { input: 5, output: 25, cacheRead: 0.5 }],
  ['opus-4-6', { input: 5, output: 25, cacheRead: 0.5 }],
  ['sonnet-5-5', { input: 2, output: 10, cacheRead: 0.2 }],
  ['sonnet-5', { input: 2, output: 10, cacheRead: 0.2 }],
  ['sonnet-4-6', { input: 3, output: 15, cacheRead: 0.3 }],
  ['haiku-5-5', { input: 0.1, output: 0.5, cacheRead: 0.01 }],
  ['haiku-4-5', { input: 1, output: 5, cacheRead: 0.1 }],
]
const ALIASES: Record<string, string> = { fable: 'fable-5-1', opus: 'opus-5-5', sonnet: 'sonnet-5-5', haiku: 'haiku-5-5' }

/** 모델 id(또는 별칭)의 가격, 모르면 null */
export function priceOf(model: string): Price | null {
  const m = model.toLowerCase().replace(/[.\s]/g, '-')
  const alias = ALIASES[m.replace(/^claude-/, '').replace(/\[.*\]$/, '')]
  // 이름 뒤에는 끝·날짜(-20260101)·플랫폼 꼬리(@, [1m], :, -v1)만 온다: "opus-5"가 앞으로 나올 "opus-5-1"을 잡지 않도록
  const key = alias ?? PRICES.find(([k]) => new RegExp(`${k}(?=$|[@\\[:]|-\\d{8}|-v\\d)`).test(m))?.[0]
  return PRICES.find(([k]) => k === key)?.[1] ?? null
}

// 버전은 한두 자리만(뒤에 붙는 8자리 날짜를 버전으로 읽지 않도록), 계열 이름은 낱말 앞에서만
const FAMILY = /(?:^|-)(fable|mythos|opus|sonnet|haiku)(?:-(\d{1,2})(?!\d)(?:-(\d{1,2})(?!\d))?)?/
const OLD_FAMILY = /(?:^|-)(\d)(?:-(\d))?-(opus|sonnet|haiku)/

/** 양자화·정밀도 꼬리(이름을 짧게 적을 때 뗀다): -nvfp4, -fp8, -awq, -gptq, -gguf, -int4, -q4_k_m, -bf16 … */
const QUANT_TAIL = /[-_.](?:nv)?(?:fp|mxfp|int|w)\d+\w*$|[-_.](?:awq|gptq|gguf|exl2|bf16|fp16|mlx)$|[-_.]q\d\w*$/i

/** Claude가 아닌 모델 이름을 짧게: provider/GLM-5.2-NVFP4 → GLM 5.2, qwen3-coder-30b-fp8 → Qwen 3. 꼴을 모르면 null */
function otherLabel(model: string): string | null {
  let name = (model.split('/').pop() ?? model).trim()
  for (let i = 0; i < 3 && QUANT_TAIL.test(name); i++) name = name.replace(QUANT_TAIL, '')
  const m = /^([a-z]+)[-_ ]?(\d+(?:\.\d+)?[a-z]?(?![a-z]))/i.exec(name)
  if (m === null) return null
  const family = m[1] ?? ''
  // 짧은 이름(GLM·GPT)은 대문자로, 긴 이름(qwen·llama)은 첫 글자만
  const shown = family.length <= 3 ? family.toUpperCase() : `${family[0]?.toUpperCase()}${family.slice(1).toLowerCase()}`
  return `${shown} ${m[2]}`
}

/** 모델 이름을 짧게: claude-opus-5-5-20261001 → Opus 5.5, claude-3-5-haiku → Haiku 3.5, claude-3-opus → Opus 3, opus → Opus, GLM-5.2-NVFP4 → GLM 5.2. 모르는 이름은 앞 12자 */
export function modelLabel(model: string): string {
  const m = model.toLowerCase().replace(/[.\s]/g, '-').replace(/^claude-/, '').replace(/\[.*\]$/, '')
  const cap = (f: string) => f[0]?.toUpperCase() + f.slice(1)
  const old = m.match(OLD_FAMILY)
  if (old !== null) return `${cap(old[3] ?? '')} ${old[1]}${old[2] === undefined ? '' : `.${old[2]}`}`
  const hit = m.match(FAMILY)
  if (hit === null) return otherLabel(model) ?? model.slice(0, 12)
  const [, family = '', major, minor] = hit
  return major === undefined ? cap(family) : `${cap(family)} ${major}${minor === undefined ? '' : `.${minor}`}`
}

/** 사용량을 그 모델 가격으로 어림한 달러 */
export const usdOf = (t: TokenUse, p: Price): number =>
  (t.input * p.input + t.output * p.output + t.cacheRead * p.cacheRead + t.cacheWrite * p.input * CACHE_WRITE_RATE) / 1_000_000

/** 모델 호출 한 번의 사용량. 그 모델의 가격을 알면 달러를, 모르면 가격 모르는 토큰으로 적는다 */
export function usageOf(u: Usage, model: string | null = null): TokenUse {
  const t: TokenUse = { input: count(u.input_tokens), output: count(u.output_tokens), cacheRead: count(u.cache_read_input_tokens), cacheWrite: count(u.cache_creation_input_tokens), usd: 0, unpriced: 0 }
  const p = model === null ? null : priceOf(model)
  return p === null ? { ...t, unpriced: totalOf(t) } : { ...t, usd: usdOf(t, p) }
}

export const addTokens = (a: TokenUse | undefined, b: TokenUse | undefined): TokenUse => ({
  input: (a?.input ?? 0) + (b?.input ?? 0), output: (a?.output ?? 0) + (b?.output ?? 0),
  cacheRead: (a?.cacheRead ?? 0) + (b?.cacheRead ?? 0), cacheWrite: (a?.cacheWrite ?? 0) + (b?.cacheWrite ?? 0),
  usd: (a?.usd ?? 0) + (b?.usd ?? 0), unpriced: (a?.unpriced ?? 0) + (b?.unpriced ?? 0),
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

/** 자세히: 12.3k(입력 1.2k · 출력 800 · 캐시 읽기 10.0k · 캐시 쓰기 300) · 비용 약 $0.04 */
export const tokenDetail = (t: TokenUse): string =>
  `${tokenText(totalOf(t))}(입력 ${tokenText(t.input)} · 출력 ${tokenText(t.output)} · 캐시 읽기 ${tokenText(t.cacheRead)} · 캐시 쓰기 ${tokenText(t.cacheWrite)}) · 비용 약 ${costText(t)}`

/** 저장된 값을 읽는다(모양이 다르면 없던 것으로) */
export function tokensOf(x: unknown): TokenUse | undefined {
  if (typeof x !== 'object' || x === null) return undefined
  const v = x as Record<string, unknown>
  const t = { input: count(v.input), output: count(v.output), cacheRead: count(v.cacheRead), cacheWrite: count(v.cacheWrite) }
  const sum = t.input + t.output + t.cacheRead + t.cacheWrite
  if (sum === 0) return undefined
  // 달러를 세기 전(v0.10)의 기록은 모두 가격 모르는 토큰으로 본다
  return typeof v.usd === 'number' ? { ...t, usd: count(v.usd), unpriced: Math.min(count(v.unpriced), sum) } : { ...t, usd: 0, unpriced: sum }
}

/** 그 일(직원·몇 번째 일)을 결재하며 쓴 토큰을 그 일 기록에 더한다 */
export const chargeReview = (book: HrBook, nick: string, job: number, t: TokenUse): HrBook =>
  totalOf(t) === 0 ? book : { ...book, log: book.log.map(r => (r.nick === nick && r.job === job ? { ...r, reviewTokens: addTokens(r.reviewTokens, t) } : r)) }

/** 달러: $0.0042, $0.12, $3.40, $120 */
export function usdText(n: number): string {
  if (n < 0.01) return `$${n.toFixed(4)}`
  if (n < 100) return `$${n.toFixed(2)}`
  return `$${Math.round(n).toLocaleString('en-US')}`
}

/** 비용 한마디: "$0.12", 가격을 모르는 토큰이 섞였으면 "$0.12+(가격 모름 3.2k)", 전부 모르면 "가격 모름" */
export function costText(t: TokenUse | undefined): string {
  if (t === undefined) return '-'
  if (t.unpriced >= totalOf(t)) return '가격 모름'
  return `${usdText(t.usd)}${t.unpriced > 0 ? `+(가격 모름 ${tokenText(t.unpriced)})` : ''}`
}

/** 여러 사용량의 합(하나도 없으면 undefined) */
export const sumTokens = (list: readonly (TokenUse | undefined)[]): TokenUse | undefined =>
  list.reduce<TokenUse | undefined>((s, t) => (t === undefined ? s : addTokens(s, t)), undefined)

/** 토큰과 비용을 한마디로: 20.0k($0.12) */
export const useText = (t: TokenUse): string => `${tokenText(totalOf(t))}(${costText(t)})`
