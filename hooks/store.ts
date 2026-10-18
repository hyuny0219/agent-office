// 사무실의 상태와 저장. 사무실 사람들($.state, 패널이 구독한다)과 인사 기록($.store, 세션을 넘어 남는다)을
// 읽고 쓰는 길을 한곳에 둔다. 이 모듈의 사본은 다시 불러오면 비고, 상태에서 다시 채운다.
import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Bubble, HrBook, OfficeAgent, Utterance } from '../types'
import { assign, DEPTS, deptOf, emptyBook, hire, leadOf, migrate } from './hr'
import { pushLine } from './speech'
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

/** 직원 명부와 사무실 사람들의 별칭을 모두 피해 새 별칭을 정한다 */
const newNick = (type: string, agents: readonly OfficeAgent[], b: HrBook) =>
  nickFor(type, [...agents, ...b.employees.map(e => ({ nick: e.nick, endedAt: 0 }))])

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
      loaded.push({ ...a, nick, dept: a.dept ?? (a.id === 'main' ? undefined : deptOf(a.type)) })
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

export async function nickOfId($: EngineInterface, id: string): Promise<string> {
  return (await agentsOf($)).find(a => a.id === id)?.nick ?? (id === 'main' ? 'BOSS' : '(퇴근한 직원)')
}

/** 지금 일하는 사람들의 별칭 */
export const busyOf = (agents: readonly OfficeAgent[]): Set<string> => new Set(agents.filter(a => a.endedAt === null).map(a => a.nick))

export const fresh = (id: string, type: string, description: string, now: number): Omit<OfficeAgent, 'nick'> => ({
  id, type, description, model: null, startedAt: now, endedAt: null, activity: type === 'main' ? 'idle' : 'think', tool: null, tools: 0,
  dept: type === 'main' ? undefined : deptOf(type), errors: 0,
})

/**
 * 일을 맡을 직원을 정한다: 그 부서에서 쉬고 있는 직원 중 경력이 가장 높은 사람, 없으면 새로 뽑는다.
 * 정한 직원은 인사 기록에 남는다.
 */
export async function staff($: EngineInterface, type: string) {
  const b = await hrOf($)
  const dept = deptOf(type)
  const agents = await agentsOf($)
  const had = assign(b, dept, busyOf(agents))
  if (had !== undefined) return had
  const hired = hire(b, newNick(type, agents, b), dept, type, await $.clock.now())
  await saveHr($, () => hired.book)
  return hired.employee
}

/** 사무실에 들인다(별칭이 정해져 있으면 그대로, 같은 id가 있으면 바꾼다) */
export async function admit($: EngineInterface, agent: Omit<OfficeAgent, 'nick'>, nick?: string, extra: (list: OfficeAgent[]) => OfficeAgent[] = l => l) {
  const chosen = nick ?? (agent.type === 'main' ? 'BOSS' : (await staff($, agent.type)).nick)
  await save($, list => extra([...list.filter(a => a.id !== agent.id), { ...agent, nick: chosen }]))
}

export async function ensure($: EngineInterface, id: string) {
  if ((await agentsOf($)).some(a => a.id === id)) return
  const now = await $.clock.now()
  await admit($, fresh(id, id === 'main' ? 'main' : 'agent', id === 'main' ? '메인 대화' : '', now))
}
