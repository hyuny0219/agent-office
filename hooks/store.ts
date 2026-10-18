// 사무실의 상태와 저장. 사무실 사람들($.state, 패널이 구독한다)과 인사 기록($.store, 세션을 넘어 남는다)을
// 읽고 쓰는 길을 한곳에 둔다. 이 모듈의 사본은 다시 불러오면 비고, 상태에서 다시 채운다.
import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Bubble, HrBook, OfficeAgent, TokenUse, Utterance } from '../types'
import { assign, DEPTS, deptOf, emptyBook, hire, leadOf, migrate } from './hr'
import { pickFor } from './org'
import type { Assignment } from './org'
import { pushLine } from './speech'
import { addTokens, tokensOf, totalOf } from './tokens'
import { nickFor } from './scene'
import type { Leads } from './scene'

/** 대화 한 번에 회의실에 머무는 시간 */
export const MEET_MS = 8000
/** 인사 기록을 세션을 넘어 남기는 $.store 키 */
const HR_KEY = 'hr'
const agentsAtom = atom({ plugin: 'agent-office', key: 'agents' } as const, [])
const feedAtom = atom({ plugin: 'agent-office', key: 'feed' } as const, [])

// 이 모듈의 사본(상태가 원본, 다시 불러오면 상태에서 채운다)
let cache: OfficeAgent[] | null = null
let book: HrBook | null = null

let loading: Promise<HrBook> | null = null
export async function hrOf($: EngineInterface): Promise<HrBook> {
  if (book !== null) return book
  // 처음 읽는 동안 다른 호출이 와도 같은 읽기를 기다린다(먼저 고친 값을 덮지 않도록)
  loading ??= $.store.get(HR_KEY).then(stored => {
    book ??= migrate(stored) ?? emptyBook()
    return book
  })
  return loading
}

export async function saveHr($: EngineInterface, fn: (b: HrBook) => HrBook) {
  // 기다린 뒤의 최신 사본에 고친다(기다리는 사이 다른 저장이 고친 것을 덮지 않도록)
  await hrOf($)
  book = fn(book ?? emptyBook())
  await $.store.set(HR_KEY, book)
}

export const leadsOf = (b: HrBook): Leads => Object.fromEntries(DEPTS.map(d => [d, leadOf(b, d)?.nick]).filter(([, n]) => n !== undefined))

/** 직원 명부·떠난 직원·사무실 사람들의 별칭을 모두 피해 새 별칭을 정한다(떠난 직원의 별칭을 다시 쓰면 기록이 섞인다) */
const newNick = (type: string, agents: readonly OfficeAgent[], b: HrBook) =>
  nickFor(type, [...agents, ...[...b.employees, ...b.retired, ...b.log].map(e => ({ nick: e.nick, endedAt: 0 }))])

/**
 * 조직 개편이 건드리면 안 되는 직원(별칭 → 겹친 수): 배정됐는데 아직 사무실에 안 들어온 사람,
 * 일은 끝났지만 평가·결재가 덜 끝난 사람. 일하는 중인 사람은 busyOf가 본다
 */
const holds = new Map<string, number>()
export const hold = (nick: string) => {
  holds.set(nick, (holds.get(nick) ?? 0) + 1)
}
export const release = (nick: string) => {
  const n = (holds.get(nick) ?? 0) - 1
  if (n <= 0) holds.delete(nick)
  else holds.set(nick, n)
}

/** 그리는 쪽이 사무실 사람들과 메신저를 구독한다(상태가 바뀌면 다시 그린다) */
export async function watchAgents($: EngineInterface) {
  return read($, agentsAtom)
}
export async function readFeed($: EngineInterface) {
  return read($, feedAtom)
}

export async function agentsOf($: EngineInterface): Promise<OfficeAgent[]> {
  if (cache === null) {
    // 별칭·부서가 없던 예전 상태는 읽을 때 채운다
    const b = await hrOf($)
    const loaded: OfficeAgent[] = []
    for (const a of await read($, agentsAtom)) {
      const nick = a.nick || newNick(a.type, loaded, b)
      // 토큰은 지금 모양으로 읽는다(달러를 세기 전 v0.10의 토큰은 가격 모름으로)
      const { tokens: had, ...rest } = a
      const tokens = tokensOf(had)
      loaded.push({ ...rest, nick, dept: a.dept ?? (a.id === 'main' ? undefined : deptOf(a.type)), ...(tokens === undefined ? {} : { tokens }) })
    }
    cache = loaded
  }
  return cache
}

export async function save($: EngineInterface, fn: (list: OfficeAgent[]) => OfficeAgent[]) {
  // 기다린 뒤의 최신 사본에 고친다(나란히 도는 저장끼리 서로 덮지 않도록)
  await agentsOf($)
  const next = fn(cache ?? [])
  // 끝난 에이전트는 최근 30명까지만 남긴다
  const finished = next.filter(a => a.endedAt !== null).sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0)).slice(30)
  cache = next.filter(a => !finished.includes(a))
  await update($, agentsAtom, () => cache ?? [])
}

export const patch = (id: string, fn: (a: OfficeAgent) => OfficeAgent) => (list: OfficeAgent[]) => list.map(a => (a.id === id ? fn(a) : a))

/** 두 사람을 회의실로 부른다(서로를 대화 상대로 적는다). */
export const meet = (ids: [string, string], until: number) => (list: OfficeAgent[]) => {
  const nickOf = (id: string) => list.find(a => a.id === id)?.nick ?? null
  return list.map(a => (a.id === ids[0] ? { ...a, meetUntil: until, meetWith: nickOf(ids[1]) } : a.id === ids[1] ? { ...a, meetUntil: until, meetWith: nickOf(ids[0]) } : a))
}

/** 말하기: 그 사람 머리 위에 말풍선을 띄우고, 줄이 있으면 사내 메신저에 남긴다 */
export async function speak($: EngineInterface, id: string | null, bubble: Bubble | null, line: Utterance | null = null) {
  if (id !== null && bubble !== null) await save($, patch(id, a => ({ ...a, say: bubble })))
  if (line !== null) await update($, feedAtom, f => pushLine(f, line))
}

/**
 * 그 에이전트가 모델을 부르며 쓴 토큰을 더하고, 그때 답한 모델을 적는다(띄울 때 정한 별칭보다 정확하다).
 * 사무실에 없거나 이미 끝난(평가에 넘긴) 직원이면 버린다(목록과 인사 기록이 어긋나지 않도록)
 */
export async function chargeAgent($: EngineInterface, id: string, t: TokenUse, model: string | null = null) {
  const a = (await agentsOf($)).find(x => x.id === id)
  if (totalOf(t) === 0 || a === undefined || (id !== 'main' && a.endedAt !== null)) return
  await save($, patch(id, a => ({ ...a, tokens: addTokens(a.tokens, t), ...(model === null || model === '' ? {} : { model }) })))
}

export async function nickOfId($: EngineInterface, id: string): Promise<string> {
  return (await agentsOf($)).find(a => a.id === id)?.nick ?? (id === 'main' ? 'BOSS' : '(퇴근한 직원)')
}

/** 지금 일하는 사람들의 별칭 */
export const busyOf = (agents: readonly OfficeAgent[]): Set<string> => new Set(agents.filter(a => a.endedAt === null).map(a => a.nick))
/** 조직 개편이 건드리면 안 되는 별칭: 지금(이 순간의 사본) 일하는 사람과 붙잡아 둔 사람. agentsOf로 사본을 채운 뒤에 부른다 */
export const keptNow = (): Set<string> => new Set([...busyOf(cache ?? []), ...holds.keys()])

export const fresh = (id: string, type: string, description: string, now: number): Omit<OfficeAgent, 'nick'> => ({
  id, type, description, model: null, startedAt: now, endedAt: null, activity: type === 'main' ? 'idle' : 'think', tool: null, tools: 0,
  dept: type === 'main' ? undefined : deptOf(type), errors: 0,
})

/**
 * 일을 맡을 직원을 정한다: 업무 설명이 있으면 그 부서에서 쉬고 있는 직원 중 적임자(비슷한 일의 실적·평균 평가),
 * 없으면 경력이 가장 높은 사람. 아무도 없으면 새로 뽑는다. 정한 직원은 인사 기록에 남는다.
 */
export async function staff($: EngineInterface, type: string, description = ''): Promise<Assignment> {
  const b = await hrOf($)
  const dept = deptOf(type)
  const agents = await agentsOf($)
  const busy = busyOf(agents)
  const picked = description.trim() === '' ? null : pickFor(b, dept, busy, description)
  if (picked !== null) return picked
  const had = assign(b, dept, busy)
  if (had !== undefined) return { employee: had, why: null }
  const hired = hire(b, newNick(type, agents, b), dept, type, await $.clock.now())
  await saveHr($, () => hired.book)
  return { employee: hired.employee, why: null }
}

/** 사무실에 들인다(별칭이 정해져 있으면 그대로, 같은 id가 있으면 바꾼다) */
export async function admit($: EngineInterface, agent: Omit<OfficeAgent, 'nick'>, nick?: string, extra: (list: OfficeAgent[]) => OfficeAgent[] = l => l) {
  const chosen = nick ?? (agent.type === 'main' ? 'BOSS' : (await staff($, agent.type)).employee.nick)
  await save($, list => extra([...list.filter(a => a.id !== agent.id), { ...agent, nick: chosen }]))
}

export async function ensure($: EngineInterface, id: string) {
  if ((await agentsOf($)).some(a => a.id === id)) return
  const now = await $.clock.now()
  await admit($, fresh(id, id === 'main' ? 'main' : 'agent', id === 'main' ? '메인 대화' : '', now))
}
