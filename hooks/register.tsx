import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Dept, HrBook, OfficeActivity, OfficeAgent } from '../types'
import { assign, briefOf, DEPT_INFO, DEPTS, deptOf, emptyBook, gradeOf, hire, leadOf, learn, rankOf, review, salaryOf, tipOf } from './hr'
import { activityOf, encodeCells, isMeeting, koNick, layoutOf, nickFor, Office, seated, shortType } from './scene'
import type { Layout, Leads } from './scene'

const PANE = 'agent-office'
const RASTER = 'office'
const FRAME_MS = 200
/** 대화 한 번에 회의실에 머무는 시간 */
const MEET_MS = 8000
/** 인사 기록을 세션을 넘어 남기는 $.store 키 */
const HR_KEY = 'hr'
const agentsAtom = atom({ plugin: 'agent-office', key: 'agents' } as const, [])

// 이 모듈의 사본(상태가 원본, 다시 불러오면 상태에서 채운다)
let cache: OfficeAgent[] | null = null
let book: HrBook | null = null
const inflight = new Map<string, string[]>()
let frame = 0
// 지금 그려져 있는 사무실(패널 id → 그 자리의 사무실). 사람들의 걸음은 자리마다 따로 간다.
const offices = new Map<string, Office>()
let denies = 0
/** 다른 패널(설정 attachTo) 아래에 붙은 적이 있는지(/office 안내용) */
let isAttached = false

const STATUS_WORD: Record<OfficeActivity, string> = {
  think: '생각 중', type: '작성 중', read: '자료실', bash: '서버실', web: '웹·MCP',
  spawn: '위임 중', idle: '휴식', done: '퇴근', failed: '실패',
}

/** '곰과', '보스와': 받침이 있으면 과 */
const withGwa = (word: string): string => {
  const last = word.charCodeAt(word.length - 1)
  return `${word}${last >= 0xac00 && last <= 0xd7a3 && (last - 0xac00) % 28 !== 0 ? '과' : '와'}`
}

const isBook = (v: unknown): v is HrBook => typeof v === 'object' && v !== null && (v as HrBook).version === 1 && Array.isArray((v as HrBook).employees)

async function hrOf($: EngineInterface): Promise<HrBook> {
  if (book === null) {
    const stored = await $.store.get(HR_KEY)
    book = isBook(stored) ? stored : emptyBook()
  }
  return book
}

async function saveHr($: EngineInterface, fn: (b: HrBook) => HrBook) {
  book = fn(await hrOf($))
  await $.store.set(HR_KEY, book)
}

const leadsOf = (b: HrBook): Leads => Object.fromEntries(DEPTS.map(d => [d, leadOf(b, d)?.nick]).filter(([, n]) => n !== undefined))

/** 직원 명부와 사무실 사람들의 별칭을 모두 피해 새 별칭을 정한다 */
const newNick = (type: string, agents: readonly OfficeAgent[], b: HrBook) =>
  nickFor(type, [...agents, ...b.employees.map(e => ({ nick: e.nick, endedAt: 0 }))])

async function agentsOf($: EngineInterface): Promise<OfficeAgent[]> {
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

async function save($: EngineInterface, fn: (list: OfficeAgent[]) => OfficeAgent[]) {
  const next = fn(await agentsOf($))
  // 끝난 에이전트는 최근 30명까지만 남긴다
  const finished = next.filter(a => a.endedAt !== null).sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0)).slice(30)
  cache = next.filter(a => !finished.includes(a))
  await update($, agentsAtom, () => cache ?? [])
}

const patch = (id: string, fn: (a: OfficeAgent) => OfficeAgent) => (list: OfficeAgent[]) => list.map(a => (a.id === id ? fn(a) : a))

/** 두 사람을 회의실로 부른다(서로를 대화 상대로 적는다). */
const meet = (ids: [string, string], until: number) => (list: OfficeAgent[]) => {
  const nickOf = (id: string) => list.find(a => a.id === id)?.nick ?? null
  return list.map(a => (a.id === ids[0] ? { ...a, meetUntil: until, meetWith: nickOf(ids[1]) } : a.id === ids[1] ? { ...a, meetUntil: until, meetWith: nickOf(ids[0]) } : a))
}

const fresh = (id: string, type: string, description: string, now: number): Omit<OfficeAgent, 'nick'> => ({
  id, type, description, model: null, startedAt: now, endedAt: null, activity: type === 'main' ? 'idle' : 'think', tool: null, tools: 0,
  dept: type === 'main' ? undefined : deptOf(type), errors: 0,
})

/**
 * 일을 맡을 직원을 정한다: 그 부서에서 쉬고 있는 직원 중 경력이 가장 높은 사람, 없으면 새로 뽑는다.
 * 정한 직원은 인사 기록에 남는다.
 */
async function staff($: EngineInterface, type: string) {
  const b = await hrOf($)
  const dept = deptOf(type)
  const agents = await agentsOf($)
  const busy = new Set(agents.filter(a => a.endedAt === null).map(a => a.nick))
  const had = assign(b, dept, busy)
  if (had !== undefined) return had
  const hired = hire(b, newNick(type, agents, b), dept, type, await $.clock.now())
  await saveHr($, () => hired.book)
  return hired.employee
}

/** 사무실에 들인다(별칭이 정해져 있으면 그대로, 같은 id가 있으면 바꾼다) */
async function admit($: EngineInterface, agent: Omit<OfficeAgent, 'nick'>, nick?: string, extra: (list: OfficeAgent[]) => OfficeAgent[] = l => l) {
  const chosen = nick ?? (agent.type === 'main' ? 'BOSS' : (await staff($, agent.type)).nick)
  await save($, list => extra([...list.filter(a => a.id !== agent.id), { ...agent, nick: chosen }]))
}

async function ensure($: EngineInterface, id: string) {
  if ((await agentsOf($)).some(a => a.id === id)) return
  const now = await $.clock.now()
  await admit($, fresh(id, id === 'main' ? 'main' : 'agent', id === 'main' ? '메인 대화' : '', now))
}

/** 끝난 일을 평가해 인사 기록에 반영하고 알린다 */
async function appraise($: EngineInterface, a: OfficeAgent, isDone: boolean, isKilled: boolean) {
  if (a.id === 'main') return
  const b = await hrOf($)
  if (!b.employees.some(e => e.nick === a.nick)) await saveHr($, x => hire(x, a.nick, a.dept ?? deptOf(a.type), a.type, a.startedAt).book)
  const now = await $.clock.now()
  let result: ReturnType<typeof review> | null = null
  await saveHr($, x => {
    result = review(x, a.nick, { isDone, isKilled, errors: a.errors ?? 0 }, now)
    return result.book
  })
  const r = result as ReturnType<typeof review> | null
  if (r === null) return
  const e = r.book.employees.find(x => x.nick === a.nick)
  const rank = e === undefined ? '' : ` ${rankOf(e.xp).ko}`
  $.ui.toast(`${a.nick}${rank} 평가 ${gradeOf(r.score)} (${r.score >= 0 ? '+' : ''}${r.score})${r.promotedTo === null ? '' : ` · ${r.promotedTo} 승진!`}`)
}

/** $.agent.list()의 상태를 옮긴다(끝남·실패·대기, 이름). 방금 끝난 에이전트는 평가받고, 띄운 쪽에게 보고하러 회의실에 간다. */
async function syncStatus($: EngineInterface) {
  const infos = await $.agent.list()
  const now = await $.clock.now()
  const known = await agentsOf($)
  const reports: [string, string][] = []
  const finished: { a: OfficeAgent; isDone: boolean; isKilled: boolean }[] = []
  let changed = false
  const next = known.map(a => {
    const info = infos.find(i => i.id === a.id)
    if (info === undefined) return a
    const ended = info.status === 'completed' || info.status === 'failed' || info.status === 'killed'
    const activity: OfficeActivity = info.status === 'completed' ? 'done' : ended ? 'failed'
      : info.status === 'idle' || info.status === 'waiting' ? 'idle'
      : a.activity === 'done' || a.activity === 'failed' || a.activity === 'idle' ? 'think' : a.activity
    const name = info.name ?? a.name ?? null
    if (activity === a.activity && ended === (a.endedAt !== null) && name === (a.name ?? null)) return a
    changed = true
    if (ended && a.endedAt === null) finished.push({ a, isDone: info.status === 'completed', isKilled: info.status === 'killed' })
    if (activity === 'done' && a.activity !== 'done') reports.push([a.id, a.parentId ?? 'main'])
    return { ...a, activity, name, parentId: a.parentId ?? info.parentId ?? 'main', endedAt: ended ? a.endedAt ?? now : null }
  })
  // 이 mod가 불러와지기 전에 뜬 에이전트도 들인다
  const newcomers = infos.filter(i => !known.some(a => a.id === i.id) && (i.status === 'running' || i.status === 'pending'))
  if (!changed && newcomers.length === 0) return
  await save($, () => {
    let list = next
    for (const pair of reports) list = meet(pair, now + MEET_MS)(list)
    return list
  })
  for (const i of newcomers) await admit($, { ...fresh(i.id, i.type, i.description, now), name: i.name ?? null, parentId: i.parentId ?? 'main' })
  for (const f of finished) await appraise($, f.a, f.isDone, f.isKilled)
}

async function tick($: EngineInterface) {
  frame++
  if (frame % 5 === 0) await syncStatus($)
  if (offices.size === 0) return
  const agents = await agentsOf($)
  const leads = leadsOf(await hrOf($))
  const now = await $.clock.now()
  for (const [requestId, office] of offices) {
    const cells = encodeCells(office.draw(agents, frame, now, leads))
    const blitted = await $.ui.blit({ requestId, key: RASTER, cells, columns: office.layout.columns, rows: office.layout.rows })
    if (blitted.deny === undefined) {
      denies = 0
      continue
    }
    // 닫혔거나 크기가 바뀌었다: 그 자리는 멈추고, 몇 번까지만 다시 그려 달라고 한다
    offices.delete(requestId)
    if (++denies <= 3) $.ui.invalidate('ui.render')
  }
}

/** 그 자리의 사무실(폭이 바뀌었으면 새로 짓는다) */
function officeAt(requestId: string, layout: Layout): Office {
  const had = offices.get(requestId)
  if (had !== undefined && had.layout.columns === layout.columns) return had
  const office = new Office(layout)
  offices.set(requestId, office)
  return office
}

/** /office hr: 부서별 직원·직급·연봉·평가, 부서가 반복한 실수 */
function rosterText(b: HrBook): string {
  const won = (n: number) => n.toLocaleString('en-US')
  const lines = [`에이전트 사무실 인사 기록 (업무 지시 인사 메모: ${b.isCoaching ? '켜짐' : '꺼짐'})`]
  if (b.employees.length === 0) lines.push('아직 직원이 없습니다. 서브에이전트가 일을 맡으면 부서에 배치됩니다.')
  for (const d of DEPTS) {
    const staffList = b.employees.filter(e => e.dept === d).sort((x, y) => y.xp - x.xp)
    if (staffList.length === 0) continue
    const lead = leadOf(b, d)
    lines.push('', `${DEPT_INFO[d].ko}${lead === undefined ? '' : ` — 팀장 ${lead.nick}(${koNick(lead.nick)})`}`)
    for (const e of staffList) {
      const grade = e.lastScore === null ? '-' : gradeOf(e.lastScore)
      lines.push(`  ${e.nick} ${koNick(e.nick)} · ${rankOf(e.xp).ko} · 연봉 ${won(salaryOf(b, e))}만원 · 최근 평가 ${grade} · 완료 ${e.done} / 실패 ${e.failed} · 도구 오류 ${e.toolErrors} · 경력 ${e.xp}`)
    }
  }
  const lessonLines = DEPTS.flatMap(d => (b.lessons[d] ?? []).slice(0, 3).map(l => {
    const tip = tipOf(l.pattern)
    return `  ${DEPT_INFO[d].ko}: ${l.tool} "${l.pattern}" ${l.count}회${tip === null ? '' : ` → ${tip}`}`
  }))
  if (lessonLines.length > 0) lines.push('', '부서별 반복 실수(2회 이상이면 다음 업무 지시에 붙음):', ...lessonLines)
  lines.push('', '평가: 완료 +10, 실패 -5(중단 -3), 도구 오류 1개당 -1(최대 -5), 오류 없이 완료 +3. 직급: 사원 0 · 대리 20 · 과장 60 · 차장 120 · 부장 200(경력).')
  return lines.join('\n')
}

export const register: Register = (on, options) => {
  // 설정 attachTo: 다른 mod가 여는 패널의 id. 비어 있지 않으면 그 패널 아래에도 평면도를 붙인다.
  const attachTo = typeof options.attachTo === 'string' ? options.attachTo.trim() : ''

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: 'office',
      description: '에이전트 사무실 평면도 보기. hr: 인사 기록(부서·직급·연봉·평가), hr on|off: 업무 지시 인사 메모 켜고 끄기',
      argumentHint: '[hr [on|off]]',
    })
    $.clock.every(FRAME_MS, () => void tick($).catch(() => undefined))
    return started
  })

  on('command.run', { command: 'office' }, async ($, e) => {
    const [sub, arg] = e.args.trim().split(/\s+/)
    if (sub === 'hr') {
      if (arg === 'on' || arg === 'off') {
        await saveHr($, b => ({ ...b, isCoaching: arg === 'on' }))
        return { text: arg === 'on' ? '업무 지시에 인사 메모(담당·지난 기록·부서가 반복한 실수·평가 기준)를 붙입니다.' : '업무 지시에 인사 메모를 붙이지 않습니다. 평가·연봉은 계속 기록합니다.' }
      }
      return { text: rosterText(await hrOf($)) }
    }
    await ensure($, 'main')
    const opened = await $.ui.open({ id: PANE, title: '에이전트 사무실' })
    const lab = isAttached ? ` 설정한 패널(${attachTo}) 아래에도 붙어 있습니다.` : ''
    return { text: `${opened.isPlaced ? '에이전트 사무실을 열었습니다.' : '에이전트 사무실이 아직 그려지지 않았습니다(창이 좁으면 넓혀 주세요).'}${lab} 인사 기록은 /office hr.` }
  })

  // 새 에이전트: 부서 직원에게 맡기고(업무 지시 끝에 인사 메모), 띄운 쪽과 회의실에서 지시를 주고받은 뒤 일하러 간다
  on('agent.spawn', async ($, e, next) => {
    const employee = await staff($, e.subagentType)
    const brief = e.workflow === undefined ? briefOf(await hrOf($), employee) : null
    const spawned = await next(brief === null ? e : { ...e, prompt: `${e.prompt}\n\n${brief}` })
    if (spawned.deny !== undefined || spawned.agentId === undefined) return spawned
    const id = spawned.agentId
    const parentId = e.parentAgentId ?? 'main'
    const now = await $.clock.now()
    await ensure($, parentId)
    await admit($, { ...fresh(id, e.subagentType, e.description, now), model: spawned.model, parentId }, employee.nick, meet([parentId, id], now + MEET_MS))
    return spawned
  })

  on('turn.start', async ($, e, next) => {
    const id = e.agentId ?? 'main'
    await ensure($, id)
    await save($, patch(id, a => ({ ...a, activity: 'think', endedAt: id === 'main' ? null : a.endedAt })))
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined) await save($, patch('main', a => ({ ...a, activity: 'idle', tool: null })))
    else await syncStatus($)
    return done
  })

  // 관찰만 한다: 기록이 실패해도 도구는 그대로 돈다.
  on('tool.call', async ($, e, next) => {
    const id = e.agentId ?? 'main'
    inflight.set(id, [...(inflight.get(id) ?? []), e.tool])
    await ensure($, id)
    await save($, patch(id, a => ({ ...a, activity: activityOf(e.tool), tool: e.tool, tools: a.tools + 1 })))
    if (e.tool === 'SendMessage') {
      // 메시지를 보내면 받는 쪽과 회의실에서 만난다(이름·id·별칭 어느 것으로 불러도 찾는다)
      const to = String(e.to ?? '').split('@')[0] ?? ''
      const target = (await agentsOf($)).find(a => a.id !== id && (a.name === to || a.id === to || a.nick === to.toUpperCase() || (to === 'main' && a.id === 'main')))
      if (target !== undefined) await save($, meet([id, target.id], (await $.clock.now()) + MEET_MS))
    }
    let ran: Awaited<ReturnType<typeof next>> | undefined
    try {
      ran = await next(e)
      return ran
    } finally {
      const left = [...(inflight.get(id) ?? [])]
      left.splice(left.indexOf(e.tool), 1)
      inflight.set(id, left)
      const last = left[left.length - 1]
      const isError = ran !== undefined && (ran.deny !== undefined || ran.isError === true)
      await save($, patch(id, a => (a.activity === 'done' || a.activity === 'failed' ? a : {
        ...a, activity: last === undefined ? 'think' : activityOf(last), tool: last ?? a.tool, errors: (a.errors ?? 0) + (isError ? 1 : 0),
      })))
      // 서브에이전트의 오류는 부서의 교훈으로 남긴다
      const who = (await agentsOf($)).find(a => a.id === id)
      if (isError && who?.dept !== undefined && ran !== undefined) {
        const text = ran.deny ?? ran.text ?? ''
        const dept: Dept = who.dept
        const at = await $.clock.now()
        await saveHr($, b => learn(b, dept, e.tool, text, at))
      }
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    await read($, agentsAtom)
    const agents = await agentsOf($)
    const b = await hrOf($)
    const now = await $.clock.now()
    const list = seated(agents).slice(0, 10)
    const lines = list.map(a => {
      const emp = b.employees.find(x => x.nick === a.nick)
      const isLead = a.dept !== undefined && leadOf(b, a.dept)?.nick === a.nick
      const who = a.id === 'main'
        ? `${koNick(a.nick)} 대표`
        : `${koNick(a.nick)} ${emp === undefined ? '사원' : rankOf(emp.xp).ko}${isLead ? '·팀장' : ''} (${a.dept === undefined ? shortType(a.type) : DEPT_INFO[a.dept].ko})`
      const where = isMeeting(a, now) ? `회의실${a.meetWith ? `: ${withGwa(koNick(a.meetWith))} 대화` : ''}`
        : a.activity === 'type' || a.activity === 'web' || a.activity === 'read' || a.activity === 'bash' ? `${STATUS_WORD[a.activity]} ${a.tool ?? ''}`.trim()
        : STATUS_WORD[a.activity]
      const mins = Math.floor(((a.endedAt ?? now) - a.startedAt) / 60_000)
      const errs = a.errors ? ` · 오류 ${a.errors}` : ''
      return { key: `row-${a.id}`, text: `${a.nick} ${who} · ${where} · 도구 ${a.tools}회${errs} · ${mins}분 · ${a.description || '-'}`, isOff: a.endedAt !== null, isBad: a.activity === 'failed' }
    })

    if (e.surface !== 'terminal') {
      offices.delete(PANE)
      const { Box, Text } = $.ui.resolve(e)
      return (
        <Box flexDirection="column">
          <Text dimColor>사무실 평면도는 터미널에서만 그려집니다. 인사 기록은 /office hr.</Text>
          {lines.map(l => <Box key={l.key}><Text dimColor={l.isOff} color={l.isBad ? 'red' : undefined}>{l.text}</Text></Box>)}
        </Box>
      )
    }

    const { Box, Text, Raster } = $.ui.resolve(e)
    const office = officeAt(PANE, layoutOf(e.viewport?.columns ?? 80))
    const cells = encodeCells(office.draw(agents, frame, now, leadsOf(b)))
    return (
      <Box flexDirection="column">
        <Raster key={RASTER} columns={office.layout.columns} rows={office.layout.rows} cells={cells} />
        {lines.length === 0 && <Text dimColor>아직 일하는 에이전트가 없습니다.</Text>}
        {lines.map(l => (
          <Box key={l.key}><Text dimColor={l.isOff} color={l.isBad ? 'red' : undefined} wrap="truncate-end">{l.text}</Text></Box>
        ))}
      </Box>
    )
  })

  // 설정한 패널 아래에 사무실 평면도를 붙인다. 그 패널의 화면은 그 mod가 그린 그대로 둔다.
  if (attachTo === '' || attachTo === PANE) return
  on('ui.render', { component: 'Pane', requestId: attachTo }, async ($, e, next) => {
    const host = await next(e)
    if (e.surface !== 'terminal') return host
    isAttached = true
    const { Box, Raster } = $.ui.resolve(e)
    // 상태를 read하지 않는다: 도구 호출마다 랩 화면까지 다시 그리지 않도록 사본만 본다
    const office = officeAt(attachTo, layoutOf(e.viewport?.columns ?? 80))
    const cells = encodeCells(office.draw(await agentsOf($), frame, await $.clock.now(), leadsOf(await hrOf($))))
    return (
      <Box flexDirection="column">
        {host}
        <Box marginTop={1}>
          <Raster key={RASTER} columns={office.layout.columns} rows={office.layout.rows} cells={cells} />
        </Box>
      </Box>
    )
  })
}
