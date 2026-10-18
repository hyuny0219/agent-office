import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Bubble, Dept, HrBook, OfficeActivity, OfficeAgent, Streak, TrialTicket, Utterance } from '../types'
import { assign, briefOf, CHECK_PENALTY, decide, DEPT_INFO, DEPTS, deptOf, emptyBook, gradeOf, handOff, hire, isMuted, leadOf, learn, lessonKey, lessonsFor, migrate, warn, rankOf, record, review, rework, REWORK_PENALTY, salaryOf, tipOf } from './hr'
import { APPROVAL_TIMEOUT_MS, APPROVER_MODEL, decisionOf, decisionToast, planNoteOf, planRequestOf, planReviewerOf, planReviewOf, REJECT_PENALTY, rejectNoteOf, requestOf, routeOf } from './approval'
import type { Facts } from './approval'
import { cardOf, findEmployee, reportOf } from './report'
import { approvalLineOf, isSpeaking, lineText, messageOf, oopsOf, orderOf, pushLine, replyOf, reportLineOf, selfTalkOf } from './speech'
import type { Period } from './report'
import { CONTROL_EVERY, effectText, enroll, errorLessonKey, markHit, settle } from './trial'
import { callKeyOf, ERROR_STREAK, errorKeyOf, errorToast, isAlarm, isOvertime, isPolling, nudgeOf, REPEAT_STREAK, repeatToast, stepOf } from './watch'
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
const feedAtom = atom({ plugin: 'agent-office', key: 'feed' } as const, [])
/** 평면도 아래에 보이는 메신저 줄 수 */
const FEED_SHOWN = 5
const FEED_COLOR: Record<Utterance['kind'], string | undefined> = { order: 'cyan', report: 'green', message: 'magenta', self: undefined, error: 'red', approval: 'yellow' }

// 이 모듈의 사본(상태가 원본, 다시 불러오면 상태에서 채운다)
let cache: OfficeAgent[] | null = null
let book: HrBook | null = null
const inflight = new Map<string, string[]>()
let frame = 0
// 지금 그려져 있는 사무실(패널 id → 그 자리의 사무실). 사람들의 걸음은 자리마다 따로 간다.
const offices = new Map<string, Office>()
let denies = 0
/** 사무실 패널을 그린 적이 있는지(터미널·데스크톱 모두: 5초마다 다시 그린다) */
let isPaneShown = false
/** 다른 패널(설정 attachTo) 아래에 붙은 적이 있는지(/office 안내용) */
let isAttached = false
/** 결재에 쓸 지시·보고(에이전트 id →). 패널이 구독하는 상태에 두지 않는다: 길어서 쓸 때마다 패널로 실려 간다 */
const papers = new Map<string, { task?: string; report?: string }>()
/** 진행 중인 결재(에이전트 id → 반려면 띄운 쪽이 읽을 글) */
const approvals = new Map<string, Promise<string | null>>()
/** 띄운 쪽이 아직 못 읽은 결재 결과(메인은 다음 도구 결과 뒤에 읽는다) */
let notes: { agentId: string; parentId: string; text: string }[] = []
const MAX_NOTES = 20

const STATUS_WORD: Record<OfficeActivity, string> = {
  think: '생각 중', type: '작성 중', read: '자료실', bash: '서버실', web: '웹·MCP',
  spawn: '위임 중', idle: '휴식', done: '퇴근', failed: '실패',
}

/** '곰과', '보스와': 받침이 있으면 과 */
const withGwa = (word: string): string => {
  const last = word.charCodeAt(word.length - 1)
  return `${word}${last >= 0xac00 && last <= 0xd7a3 && (last - 0xac00) % 28 !== 0 ? '과' : '와'}`
}

/** 파일을 고치는 도구(재작업 판정에 쓴다) */
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const fileOf = (e: object): string | null => {
  const { file_path, notebook_path } = e as { file_path?: unknown; notebook_path?: unknown }
  const f = file_path ?? notebook_path
  return typeof f === 'string' && f !== '' ? f : null
}
const baseName = (f: string): string => f.split('/').pop() ?? f
/** 도구별 같은 실수 연속 횟수 중 가장 큰 것 */
const streakMax = (a: OfficeAgent): number => Math.max(0, ...Object.values(a.errStreaks ?? {}).map(s => s.count))
/** 테스트·빌드·타입 검사로 보이는 Bash 명령 */
const CHECK_RE = /\b(test|tests|build|tsc|jest|vitest|pytest|mocha|lint|typecheck|check|cargo|go\s+(test|build|vet)|make|gradle|mvn|ruff|mypy|eslint)\b/
const isCheckCommand = (e: object): boolean => {
  const { command } = e as { command?: unknown }
  return typeof command === 'string' && CHECK_RE.test(command)
}

let loading: Promise<HrBook> | null = null
async function hrOf($: EngineInterface): Promise<HrBook> {
  if (book !== null) return book
  // 처음 읽는 동안 다른 호출이 와도 같은 읽기를 기다린다(먼저 고친 값을 덮지 않도록)
  loading ??= $.store.get(HR_KEY).then(stored => {
    book ??= migrate(stored) ?? emptyBook()
    return book
  })
  return loading
}

async function saveHr($: EngineInterface, fn: (b: HrBook) => HrBook) {
  // 기다린 뒤의 최신 사본에 고친다(기다리는 사이 다른 저장이 고친 것을 덮지 않도록)
  await hrOf($)
  book = fn(book ?? emptyBook())
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
  // 기다린 뒤의 최신 사본에 고친다(나란히 도는 저장끼리 서로 덮지 않도록)
  await agentsOf($)
  const next = fn(cache ?? [])
  // 끝난 에이전트는 최근 30명까지만 남긴다
  const finished = next.filter(a => a.endedAt !== null).sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0)).slice(30)
  cache = next.filter(a => !finished.includes(a))
  await update($, agentsAtom, () => cache ?? [])
}

/** 말하기: 그 사람 머리 위에 말풍선을 띄우고, 줄이 있으면 사내 메신저에 남긴다 */
async function speak($: EngineInterface, id: string | null, bubble: Bubble | null, line: Utterance | null = null) {
  if (id !== null && bubble !== null) await save($, patch(id, a => ({ ...a, say: bubble })))
  if (line !== null) await update($, feedAtom, f => pushLine(f, line))
}

const nickOfId = async ($: EngineInterface, id: string): Promise<string> => (await agentsOf($)).find(a => a.id === id)?.nick ?? (id === 'main' ? 'BOSS' : '(퇴근한 직원)')

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
  // 교육 효과 측정: 이번 업무가 든 쪽과 재발한 실수를 교훈별로 더한다(지금 사본에서 읽는다: 동기화 뒤에 적힌 재발도 들도록)
  // 집계한 업무에서는 실험 기록을 지운다(같은 업무를 두 번 세지 않도록)
  // 평가에 쓰는 칸도 이 사본에서 읽는다(동기화가 읽은 뒤에 난 오류·검증 실패·근태 알림도 들도록)
  let ticket: TrialTicket | undefined
  let cur: OfficeAgent = a
  await save($, patch(a.id, x => {
    ticket = x.trial
    cur = x
    return x.trial === undefined ? x : { ...x, trial: undefined }
  }))
  const got = cur as OfficeAgent
  const settled = ticket as TrialTicket | undefined
  if (settled !== undefined) {
    const at = await $.clock.now()
    await saveHr($, x => settle(x, settled, at))
  }
  const b = await hrOf($)
  if (!b.employees.some(e => e.nick === a.nick)) await saveHr($, x => hire(x, a.nick, a.dept ?? deptOf(a.type), a.type, a.startedAt).book)
  const now = await $.clock.now()
  let result: ReturnType<typeof review> | null = null
  let xpBefore = 0
  await saveHr($, x => {
    xpBefore = x.employees.find(y => y.nick === a.nick)?.xp ?? 0
    result = review(x, a.nick, { isDone, isKilled, errors: got.errors ?? 0, tools: got.tools, isCheckFailed: got.isCheckFailed }, now)
    // 끝낸 일의 파일은 남겨 두고, BOSS가 곧 다시 고치면 재작업으로 본다
    const employee = result.book.employees.find(x => x.nick === a.nick)
    const job = employee?.jobs ?? 0
    const logged = record(result.book, {
      nick: a.nick, dept: a.dept ?? deptOf(a.type), job, description: got.description, startedAt: got.startedAt, endedAt: got.endedAt ?? now,
      outcome: isDone ? 'done' : isKilled ? 'killed' : 'failed', score: result.score, errors: got.errors ?? 0,
      isCheckFailed: isDone && got.isCheckFailed === true, isReworked: false, alarms: got.alarms ?? 0,
      ...(employee === undefined ? {} : { salary: salaryOf(result.book, employee) }),
    })
    return isDone ? handOff(logged, { agentId: a.id, nick: a.nick, files: got.files ?? [], endedAt: now, job }) : logged
  })
  const r = result as ReturnType<typeof review> | null
  if (r === null) return
  const e = r.book.employees.find(x => x.nick === a.nick)
  // 끝낸 일의 보고를 결재에 올린다(기다리지 않는다: 결재자가 답하는 사이에도 사무실은 돈다)
  if (!(isDone && e !== undefined && r.book.isApproving)) papers.delete(a.id)
  else {
    const facts: Facts = {
      description: got.description, task: papers.get(a.id)?.task ?? '', report: papers.get(a.id)?.report ?? '', tools: got.tools, errors: got.errors ?? 0,
      isCheckFailed: got.isCheckFailed === true, alarms: got.alarms ?? 0, files: (got.files ?? []).length, durationMs: now - got.startedAt,
    }
    const parentId = got.parentId ?? 'main'
    // 전결은 이 일을 하기 전 직급으로 가린다(이 일로 오른 직급으로 자기 일을 전결하지 않도록)
    const pending = approve($, a.nick, e.jobs, xpBefore, facts).catch(() => null)
    approvals.set(a.id, pending)
    void pending.then(text => {
      if (text !== null) notes = [...notes, { agentId: a.id, parentId, text }].slice(-MAX_NOTES)
    }).finally(() => {
      approvals.delete(a.id)
      papers.delete(a.id)
    })
  }
  const rank = e === undefined ? '' : ` ${rankOf(e.xp).ko}`
  const why = isDone && got.isCheckFailed === true ? ` · 테스트·빌드 실패한 채 완료 -${CHECK_PENALTY}` : ''
  $.ui.toast(`${a.nick}${rank} 평가 ${gradeOf(r.score)} (${r.score >= 0 ? '+' : ''}${r.score})${why}${movedText(r)}`)
}

/** 결재: 결재 경로를 정하고, 결재자에게 묻고, 결과를 인사 기록에 적는다. 반려면 띄운 쪽이 읽을 글을 돌려준다 */
async function approve($: EngineInterface, nick: string, job: number, xpBefore: number, f: Facts): Promise<string | null> {
  const b = await hrOf($)
  const found = b.employees.find(x => x.nick === nick)
  if (found === undefined) return null
  const e = { ...found, xp: xpBefore }
  const route = routeOf(b, e, f.tools)
  if (route.kind === 'exempt') {
    await saveHr($, x => decide(x, nick, job, 'exempt', 0).book)
    $.ui.toast(decisionToast(e, route, f.description, null))
    return null
  }
  // 보고가 없으면 결재할 거리가 없다(보고가 늦게 적힌 경우를 근거 없이 반려하지 않도록): 보류
  if (f.report.trim() === '') {
    $.ui.toast(decisionToast(e, route, f.description, null))
    return null
  }
  if (!b.isApprovalNoticed) {
    await saveHr($, x => ({ ...x, isApprovalNoticed: true }))
    $.ui.toast(`결재가 켜져 있습니다: 끝낸 일의 보고마다 ${APPROVER_MODEL}를 한 번 부릅니다. 끄려면 /office approval off`)
  }
  const ask = requestOf(e, route, f)
  const reply = await $.model.complete({ model: APPROVER_MODEL, system: ask.system, prompt: ask.prompt, maxTokens: 400, effort: 'low', timeoutMs: APPROVAL_TIMEOUT_MS })
  const d = reply.isAnswered ? decisionOf(reply.text) : null
  if (d === null) {
    $.ui.toast(decisionToast(e, route, f.description, null))
    return null
  }
  let moved: ReturnType<typeof decide> | null = null
  await saveHr($, x => {
    moved = decide(x, nick, job, d.verdict, REJECT_PENALTY)
    return moved.book
  })
  const m = moved as ReturnType<typeof decide> | null
  $.ui.toast(`${decisionToast(e, route, f.description, d)}${m === null ? '' : movedText(m)}`)
  await speak($, null, null, approvalLineOf(route.approverTitle,
    `${e.nick} "${f.description}" ${d.verdict === 'approved' ? '승인' : `반려${d.notes[0] === undefined ? '' : ` — ${d.notes[0]}`}`}`, await $.clock.now()))
  return d.verdict === 'rejected' ? rejectNoteOf(e, route, f.description, d) : null
}

/** 메인이 계획을 확정했다: 기획팀장이 검토하고, 보완이 필요하면 메인이 읽을 글을 돌려준다 */
async function reviewPlan($: EngineInterface, plan: string): Promise<string | null> {
  const b = await hrOf($)
  if (!b.isApproving || plan.trim() === '') return null
  const now = await $.clock.now()
  const reviewer = planReviewerOf(b)
  const mistakes = DEPTS.flatMap(d => lessonsFor(b, d, now).map(l => `${DEPT_INFO[d].ko}: ${l.tool} "${l.pattern}"`)).slice(0, 6)
  const ask = planRequestOf(reviewer, plan, mistakes)
  const reply = await $.model.complete({ model: APPROVER_MODEL, system: ask.system, prompt: ask.prompt, maxTokens: 400, effort: 'low', timeoutMs: APPROVAL_TIMEOUT_MS })
  const r = reply.isAnswered ? planReviewOf(reply.text) : null
  if (r === null) {
    $.ui.toast(`${reviewer} 계획 검토: 보류(검토자가 답하지 못함)`)
    return null
  }
  $.ui.toast(`${reviewer} 계획 검토: ${r.isFit ? '적합' : `보완${r.notes[0] === undefined ? '' : ` · ${r.notes[0]}`}`}`)
  await speak($, null, null, approvalLineOf(reviewer, `계획 검토 ${r.isFit ? '적합' : `보완${r.notes[0] === undefined ? '' : ` — ${r.notes[0]}`}`}`, await $.clock.now()))
  return r.isFit ? null : planNoteOf(reviewer, r)
}

/** 띄운 쪽이 읽을 결재 결과를 꺼낸다(메인은 전부, 다른 쪽은 그가 띄운 에이전트 것만) */
function takeNotes(callerId: string, agents: readonly OfficeAgent[]): string[] {
  // 메인은 자기 몫과, 띄운 쪽이 이미 끝나 읽을 수 없는 몫을 가져간다
  const isGone = (id: string) => agents.find(a => a.id === id)?.endedAt !== null
  const mine = notes.filter(n => n.parentId === callerId || (callerId === 'main' && isGone(n.parentId)))
  notes = notes.filter(n => !mine.includes(n))
  return mine.map(n => n.text)
}

const movedText = (r: { promotedTo: string | null; demotedTo: string | null }): string =>
  r.promotedTo !== null ? ` · ${r.promotedTo} 승진!` : r.demotedTo !== null ? ` · ${r.demotedTo}(으)로 강등` : ''

/** BOSS가 파일을 고쳤다: 방금 끝낸 직원의 파일이면 재작업으로 깎는다 */
async function checkRework($: EngineInterface, file: string) {
  if ((await hrOf($)).handoffs.length === 0) return
  const now = await $.clock.now()
  let r: ReturnType<typeof rework> | null = null
  await saveHr($, b => {
    r = rework(b, file, now)
    return r.book
  })
  const hit = r as ReturnType<typeof rework> | null
  if (hit === null || hit.nick === null) return
  $.ui.toast(`BOSS가 ${hit.nick}의 작업(${baseName(file)})을 다시 고쳤습니다 · 재작업 -${REWORK_PENALTY}${movedText(hit)}`)
}

let syncing: Promise<void> | null = null
/** 동기화는 한 번에 하나만 돈다: 겹치면 같은 에이전트를 두 번 평가한다 */
function syncStatus($: EngineInterface): Promise<void> {
  syncing ??= syncOnce($).finally(() => {
    syncing = null
  })
  return syncing
}

/** $.agent.list()의 상태를 옮긴다(끝남·실패·대기, 이름). 방금 끝난 에이전트는 평가받고, 띄운 쪽에게 보고하러 회의실에 간다. */
async function syncOnce($: EngineInterface) {
  const infos = await $.agent.list()
  const now = await $.clock.now()
  const known = await agentsOf($)
  const reports: [string, string][] = []
  const finished: { a: OfficeAgent; isDone: boolean; isKilled: boolean }[] = []
  // 바뀐 칸만 모은다: 기다리는 사이 다른 훅이 고친 칸(연속 횟수 등)을 덮지 않도록
  const updates = new Map<string, Pick<OfficeAgent, 'activity' | 'name' | 'parentId' | 'endedAt'>>()
  for (const a of known) {
    const info = infos.find(i => i.id === a.id)
    if (info === undefined) continue
    const ended = info.status === 'completed' || info.status === 'failed' || info.status === 'killed'
    const activity: OfficeActivity = info.status === 'completed' ? 'done' : ended ? 'failed'
      : info.status === 'idle' || info.status === 'waiting' ? 'idle'
      : a.activity === 'done' || a.activity === 'failed' || a.activity === 'idle' ? 'think' : a.activity
    const name = info.name ?? a.name ?? null
    if (activity === a.activity && ended === (a.endedAt !== null) && name === (a.name ?? null)) continue
    if (ended && a.endedAt === null) finished.push({ a, isDone: info.status === 'completed', isKilled: info.status === 'killed' })
    if (activity === 'done' && a.activity !== 'done') reports.push([a.id, a.parentId ?? 'main'])
    updates.set(a.id, { activity, name, parentId: a.parentId ?? info.parentId ?? 'main', endedAt: ended ? a.endedAt ?? now : null })
  }
  // 이 mod가 불러와지기 전에 뜬 에이전트도 들인다
  const newcomers = infos.filter(i => !known.some(a => a.id === i.id) && (i.status === 'running' || i.status === 'pending'))
  if (updates.size > 0 || newcomers.length > 0) {
    await save($, current => {
      let list = current.map(a => {
        const u = updates.get(a.id)
        return u === undefined ? a : { ...a, ...u }
      })
      // 보고하러 간 사람은 "done!", 받는 쪽은 "thanks!"
      for (const pair of reports) {
        list = meet(pair, now + MEET_MS)(list)
        list = patch(pair[0], a => ({ ...a, say: reportLineOf(a.nick, '', '', now).bubble }))(list)
        list = patch(pair[1], a => ({ ...a, say: replyOf('thanks!', now) }))(list)
      }
      return list
    })
    for (const i of newcomers) await admit($, { ...fresh(i.id, i.type, i.description, now), name: i.name ?? null, parentId: i.parentId ?? 'main' })
    // 메신저에는 보고 앞부분
    for (const [childId, parentId] of reports) {
      const child = (await agentsOf($)).find(a => a.id === childId)
      if (child !== undefined) await speak($, null, null, reportLineOf(child.nick, await nickOfId($, parentId), papers.get(childId)?.report ?? '', now).line)
    }
    for (const f of finished) await appraise($, f.a, f.isDone, f.isKilled)
  }
  // 상태를 옮긴 뒤에 본다(방금 끝난 사람을 야근이라 하지 않도록)
  const working = new Set(infos.filter(i => i.status === 'running' || i.status === 'pending').map(i => i.id))
  await checkOvertime($, working)
}

/** 오래 일하는 직원을 한 번씩 알린다(엔진이 지금 일하는 중이라고 하는 사람만, 대기 중은 빼고) */
async function checkOvertime($: EngineInterface, working: ReadonlySet<string>) {
  const now = await $.clock.now()
  const late = (await agentsOf($)).filter(a => a.id !== 'main' && working.has(a.id) && a.activity !== 'idle'
    && a.isOvertimeNoticed !== true && isOvertime(a.startedAt, a.endedAt, now))
  if (late.length === 0) return
  await save($, list => list.map(a => (late.some(l => l.id === a.id) ? { ...a, isOvertimeNoticed: true } : a)))
  for (const a of late) $.ui.toast(`${a.nick}가 ${Math.floor((now - a.startedAt) / 60_000)}분째 야근 중입니다: ${a.description || shortType(a.type)}`)
}

async function tick($: EngineInterface) {
  frame++
  if (frame % 5 === 0) await syncStatus($)
  // 패널의 "n초 전"과 말풍선 인용은 상태가 안 바뀌면 그대로라, 5초마다 한 번 다시 그린다
  if (frame % 25 === 0 && isPaneShown) $.ui.invalidate('ui.render')
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

/**
 * 근태: 같은 오류를 연달아 내거나 같은 호출을 되풀이하면 사용자에게 알리고 기록한다.
 * 코칭이 켜져 있으면 그 직원에게 붙일 알림을 돌려준다.
 */
async function watch($: EngineInterface, id: string, e: { tool: string } & object, ran: { deny?: string; text?: string; isError?: boolean }): Promise<string | null> {
  // 거절은 그 직원의 실수가 아니다(같은 거절 문구가 되풀이돼도 세지 않는다)
  if (ran.deny !== undefined) return null
  const errKey = ran.isError === true ? errorKeyOf(e.tool, ran.text ?? '', e) : null
  const isPoll = isPolling(e.tool)
  const got: { kind?: 'error' | 'repeat' | null; s?: Streak; nick?: string } = {}
  // 지금 상태에서 바로 센다: 같은 직원의 도구가 나란히 돌아도 서로의 횟수를 잃지 않도록
  await save($, patch(id, a => {
    // 도구마다 따로 센다. 사이에 다른 도구가 끼거나 실패해도 이어 세고(Edit 실패 → Read → Edit 실패가 흔한 헛손질), 그 도구가 성공하면 끊는다
    const errStreaks = { ...(a.errStreaks ?? {}) }
    if (errKey !== null) errStreaks[e.tool] = stepOf(errStreaks[e.tool], errKey)
    else delete errStreaks[e.tool]
    const callStreak = isPoll ? a.callStreak : stepOf(a.callStreak, callKeyOf(e))
    const err = errKey === null ? undefined : errStreaks[e.tool]
    const call = isPoll ? undefined : callStreak
    // 오류 알림은 그 오류가 난 호출에서만. 같은 호출이 같은 오류로 되풀이되면 오류 알림 하나로 친다(제자리걸음은 성공한 호출만)
    const kind = err !== undefined && isAlarm(err, ERROR_STREAK) ? 'error'
      : errKey === null && call !== undefined && isAlarm(call, REPEAT_STREAK) ? 'repeat' : null
    got.kind = kind
    got.s = kind === 'error' ? err : call
    got.nick = a.nick
    // 이번 일의 근태 알림도 같은 저장에서 센다(곧 끝나 평가돼도 기록에서 빠지지 않도록)
    return { ...a, errStreaks, callStreak, alarms: (a.alarms ?? 0) + (kind === null ? 0 : 1) }
  }))
  const kind = got.kind ?? null
  if (kind === null || got.nick === undefined || got.s === undefined) return null
  const s = got.s
  const nick = got.nick
  $.ui.toast(kind === 'error' ? errorToast(nick, e.tool, s) : repeatToast(nick, e.tool, s))
  await saveHr($, b => warn(b, nick))
  return (await hrOf($)).isCoaching ? nudgeOf(kind, e.tool, s) : null
}

/** /office hr: 부서별 직원·직급·연봉·평가, 부서가 반복한 실수 */
function rosterText(b: HrBook, now: number): string {
  const won = (n: number) => n.toLocaleString('en-US')
  const lines = [`에이전트 사무실 인사 기록 (업무 지시 인사 메모: ${b.isCoaching ? '켜짐' : '꺼짐'} · 교육 효과 측정: ${b.isTrialing ? '켜짐' : '꺼짐'} · 결재: ${b.isApproving ? '켜짐' : '꺼짐'})`]
  if (b.employees.length === 0) lines.push('아직 직원이 없습니다. 서브에이전트가 일을 맡으면 부서에 배치됩니다.')
  for (const d of DEPTS) {
    const staffList = b.employees.filter(e => e.dept === d).sort((x, y) => y.xp - x.xp)
    if (staffList.length === 0) continue
    const lead = leadOf(b, d)
    lines.push('', `${DEPT_INFO[d].ko}${lead === undefined ? '' : ` — 팀장 ${lead.nick}(${koNick(lead.nick)})`}`)
    for (const e of staffList) {
      const grade = e.lastScore === null ? '-' : gradeOf(e.lastScore)
      lines.push(`  ${e.nick} ${koNick(e.nick)} · ${rankOf(e.xp).ko} · 연봉 ${won(salaryOf(b, e))}만원 · 최근 평가 ${grade} · 완료 ${e.done} / 실패 ${e.failed} · 도구 오류 ${e.toolErrors}${e.reworks > 0 ? ` · 재작업 ${e.reworks}` : ''}${e.alarms > 0 ? ` · 근태 알림 ${e.alarms}` : ''}${e.rejections > 0 ? ` · 결재 반려 ${e.rejections}` : ''} · 경력 ${e.xp}`)
    }
  }
  const lessonLines = DEPTS.flatMap(d => (b.lessons[d] ?? []).slice(0, 3).map(l => {
    const tip = tipOf(l.pattern)
    return `  ${DEPT_INFO[d].ko}: ${l.tool} "${l.pattern}" ${l.count}회${tip === null ? '' : ` → ${tip}`}${effectText(b.trials[lessonKey(l)], isMuted(b, l, now))}`
  }))
  if (lessonLines.length > 0) {
    lines.push('', '부서별 반복 실수(2회 이상이면 다음 업무 지시에 붙음):', ...lessonLines)
    if (b.isTrialing) lines.push(`  효과: 실수 목록을 ${CONTROL_EVERY}건에 한 건은 빼고 보내 재발률을 비교합니다. 근거가 모였는데 붙여도 재발이 줄지 않으면 2주 동안 메모에서 뺐다가 다시 잽니다.`)
  }
  lines.push('', `평가: 완료 +10, 실패 -5(중단 -3), 도구 오류 1개당 -1(최대 -5), 오류 없이 완료 +3, 테스트·빌드 실패한 채 완료 -${CHECK_PENALTY}, 끝낸 뒤 BOSS가 같은 파일을 다시 고치면 재작업 -${REWORK_PENALTY}, 결재 반려 -${REJECT_PENALTY}.`,
    '직급: 사원 0 · 대리 20 · 과장 60 · 차장 120 · 부장 200(경력, 감점이면 깎여 강등). 평균 평가는 최근 일에 무게를 둡니다.',
    '한 사람의 인사카드는 /office hr <별칭>, 부서 실적 보고는 /office report [today|week].')
  return lines.join('\n')
}

export const register: Register = (on, options) => {
  // 설정 attachTo: 다른 mod가 여는 패널의 id. 비어 있지 않으면 그 패널 아래에도 평면도를 붙인다.
  const attachTo = typeof options.attachTo === 'string' ? options.attachTo.trim() : ''

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: 'office',
      description: '에이전트 사무실 평면도 보기. approval on|off: 보고·계획 결재 켜고 끄기, report [today|week]: 일간·주간 보고, hr: 인사 기록(부서·직급·연봉·평가), hr <별칭>: 인사카드, hr on|off: 업무 지시 인사 메모 켜고 끄기, hr ab on|off: 교육 효과 측정(비교군) 켜고 끄기',
      argumentHint: '[approval on|off | report [today|week] | hr [<별칭>|on|off|ab on|off]]',
    })
    $.clock.every(FRAME_MS, () => void tick($).catch(() => undefined))
    return started
  })

  on('command.run', { command: 'office' }, async ($, e) => {
    const [sub, arg, arg2] = e.args.trim().split(/\s+/)
    if (sub === 'hr' && arg === 'ab' && arg2 !== 'on' && arg2 !== 'off') return { text: '쓰는 법: /office hr ab on|off (교육 효과 측정 켜기·끄기)' }
    if (sub === 'approval') {
      if (arg !== 'on' && arg !== 'off') return { text: `결재: ${(await hrOf($)).isApproving ? '켜짐' : '꺼짐'}. 쓰는 법: /office approval on|off` }
      await saveHr($, b => ({ ...b, isApproving: arg === 'on' }))
      return { text: arg === 'on'
        ? `끝낸 일의 보고를 팀장이 결재하고(과장 이상·짧은 일은 전결, 반려 -${REJECT_PENALTY}), 확정한 계획은 기획팀장이 검토합니다. 결재마다 ${APPROVER_MODEL}를 한 번 부릅니다.`
        : '결재를 멈춥니다. 보고와 계획은 결재 없이 넘어갑니다.' }
    }
    if (sub === 'report') {
      const want = arg?.toLowerCase()
      if (want !== undefined && want !== 'today' && want !== 'week') return { text: '쓰는 법: /office report [today|week] (today: 최근 24시간, week: 최근 7일)' }
      const period: Period = want ?? 'today'
      return { text: reportOf(await hrOf($), period, await $.clock.now()) }
    }
    if (sub === 'hr' && arg === 'ab' && (arg2 === 'on' || arg2 === 'off')) {
      await saveHr($, b => ({ ...b, isTrialing: arg2 === 'on' }))
      return { text: arg2 === 'on'
        ? `교육 효과를 잽니다: 실수 목록을 붙일 업무 ${CONTROL_EVERY}건에 한 건은 빼고 보내(비교군), 재발률을 비교합니다.`
        : '교육 효과 측정을 멈춥니다. 실수 목록은 모든 업무에 붙입니다(쌓인 측정 기록은 남깁니다).' }
    }
    if (sub === 'hr') {
      if (arg === 'on' || arg === 'off') {
        await saveHr($, b => ({ ...b, isCoaching: arg === 'on' }))
        return { text: arg === 'on' ? '업무 지시에 인사 메모(담당·지난 기록·부서가 반복한 실수·평가 기준)를 붙입니다.' : '업무 지시에 인사 메모를 붙이지 않습니다. 평가·연봉은 계속 기록합니다.' }
      }
      const b = await hrOf($)
      if (arg !== undefined && arg !== '') {
        const who = findEmployee(b, arg)
        return { text: who === undefined ? `${arg}라는 직원이 없습니다. /office hr로 명부를 보세요.` : cardOf(b, who, await $.clock.now()) }
      }
      return { text: rosterText(b, await $.clock.now()) }
    }
    await ensure($, 'main')
    const opened = await $.ui.open({ id: PANE, title: '에이전트 사무실' })
    const lab = isAttached ? ` 설정한 패널(${attachTo}) 아래에도 붙어 있습니다.` : ''
    return { text: `${opened.isPlaced ? '에이전트 사무실을 열었습니다.' : '에이전트 사무실이 아직 그려지지 않았습니다(창이 좁으면 넓혀 주세요).'}${lab} 인사 기록은 /office hr, 보고서는 /office report.` }
  })

  // 새 에이전트: 부서 직원에게 맡기고(업무 지시 끝에 인사 메모), 띄운 쪽과 회의실에서 지시를 주고받은 뒤 일하러 간다
  on('agent.spawn', async ($, e, next) => {
    const employee = await staff($, e.subagentType)
    const at = await $.clock.now()
    let brief: string | null = null
    let trial: TrialTicket | undefined
    if (e.workflow === undefined && (await hrOf($)).isCoaching) {
      const lessons = lessonsFor(await hrOf($), employee.dept, at)
      const keys = lessons.map(lessonKey)
      let enrolled: ReturnType<typeof enroll> = null
      await saveHr($, b => {
        enrolled = enroll(b, keys)
        return enrolled?.book ?? b
      })
      const arm = (enrolled as ReturnType<typeof enroll>)?.arm
      if (arm !== undefined) trial = { arm, keys, hits: [] }
      // 비교군은 실수 목록만 뺀다(나머지 메모는 같게 두어 실수 목록의 효과만 본다)
      brief = briefOf(await hrOf($), employee, at, arm === 'control' ? [] : lessons)
    }
    const spawned = await next(brief === null ? e : { ...e, prompt: `${e.prompt}\n\n${brief}` })
    if (spawned.deny !== undefined || spawned.agentId === undefined) return spawned
    const id = spawned.agentId
    const parentId = e.parentAgentId ?? 'main'
    const now = await $.clock.now()
    await ensure($, parentId)
    papers.set(id, { task: e.prompt.slice(0, 4000) })
    // 회의실에서 지시하고("BEAR, go!") 받는다("yes!")
    const order = orderOf(await nickOfId($, parentId), employee.nick, e.description, e.prompt, now)
    await admit($, { ...fresh(id, e.subagentType, e.description, now), model: spawned.model, parentId, trial, say: replyOf('yes!', now) }, employee.nick,
      list => patch(parentId, a => ({ ...a, say: order.bubble }))(meet([parentId, id], now + MEET_MS)(list)))
    await speak($, null, null, order.line)
    return spawned
  })

  on('turn.start', async ($, e, next) => {
    const id = e.agentId ?? 'main'
    await ensure($, id)
    await save($, patch(id, a => ({ ...a, activity: 'think', endedAt: id === 'main' ? null : a.endedAt })))
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    // 서브에이전트의 마지막 답이 올린 보고다(결재에 쓴다). 끝남이 먼저 보여 평가가 시작돼도 보고가 있도록 먼저 적는다
    const agentId = e.agentId
    // 이미 평가를 마친 사람의 늦은 답은 적지 않는다(결재가 끝난 뒤 다시 쌓이지 않도록)
    const isOpen = agentId !== undefined && ((await agentsOf($)).find(a => a.id === agentId)?.endedAt ?? null) === null
    if (agentId !== undefined && isOpen && e.answer.trim() !== '') papers.set(agentId, { ...papers.get(agentId), report: e.answer.slice(0, 8000) })
    const done = await next(e)
    if (agentId === undefined) await save($, patch('main', a => ({ ...a, activity: 'idle', tool: null })))
    else await syncStatus($)
    return done
  })

  // 관찰만 한다: 기록이 실패해도 도구는 그대로 돈다.
  on('tool.call', async ($, e, next) => {
    const id = e.agentId ?? 'main'
    inflight.set(id, [...(inflight.get(id) ?? []), e.tool])
    await ensure($, id)
    const said = await $.clock.now()
    const me = await nickOfId($, id)
    // 말풍선은 지금, 메신저 줄은 실제로 돈 뒤에(거절되면 하지 않은 일이다). 지시(Agent)는 띄울 때 따로 말한다
    let talk: { bubble: Bubble; line: Utterance | null } | null = null
    let target: OfficeAgent | undefined
    if (e.tool === 'SendMessage') {
      // 메시지를 보내면 받는 쪽과 회의실에서 만난다(이름·id·별칭 어느 것으로 불러도 찾는다)
      const to = String(e.to ?? '').split('@')[0] ?? ''
      target = (await agentsOf($)).find(a => a.id !== id && (a.name === to || a.id === to || a.nick === to.toUpperCase() || (to === 'main' && a.id === 'main')))
      talk = messageOf(me, target?.nick ?? (to === '*' ? '전체' : to === '' ? '(알 수 없음)' : to), e, said)
    } else if (e.tool !== 'Agent') talk = selfTalkOf(me, e, said)
    // 한 번에 적는다(상태를 쓸 때마다 패널을 다시 그린다)
    const bubble = talk?.bubble
    await save($, list => {
      const moved = patch(id, a => ({ ...a, activity: activityOf(e.tool), tool: e.tool, tools: a.tools + 1, ...(bubble === undefined ? {} : { say: bubble }) }))(list)
      return target === undefined ? moved : meet([id, target.id], said + MEET_MS)(moved)
    })
    let ran: Awaited<ReturnType<typeof next>> | undefined
    /** 그 직원이 도구 결과 뒤에 읽을 근태 알림 */
    let nudge: string | null = null
    try {
      ran = await next(e)
    } finally {
      if (ran !== undefined && ran.deny === undefined && talk?.line != null) await speak($, null, null, talk.line)
      const left = [...(inflight.get(id) ?? [])]
      left.splice(left.indexOf(e.tool), 1)
      inflight.set(id, left)
      const last = left[left.length - 1]
      const isError = ran !== undefined && (ran.deny !== undefined || ran.isError === true)
      // 실제로 고친 파일만 센다(거절·실패한 수정은 고친 게 아니다)
      const file = ran !== undefined && !isError && EDIT_TOOLS.has(e.tool) ? fileOf(e) : null
      // 테스트·빌드 명령의 결과만 본다(grep의 일치 없음 같은 건 검증 실패가 아니다). 거절은 결과가 아니니 넘긴다
      const isCheck = e.tool === 'Bash' && ran !== undefined && ran.deny === undefined && isCheckCommand(e)
      // 실험 중인 실수가 다시 났으면 오류를 세는 바로 이 저장에서 적는다(곧 끝나 집계돼도 빠지지 않도록)
      const hitKey = isError && ran !== undefined ? errorLessonKey(e.tool, ran.deny ?? ran.text ?? '') : null
      // 실험 재발 표시와 활동·오류 수를 한 번에 적는다(상태를 쓸 때마다 패널을 다시 그린다)
      await save($, patch(id, x => {
        const a = x.trial !== undefined && hitKey !== null ? { ...x, trial: markHit(x.trial, hitKey) } : x
        return a.activity === 'done' || a.activity === 'failed' ? a : {
        ...a, activity: last === undefined ? 'think' : activityOf(last), tool: last ?? a.tool, errors: (a.errors ?? 0) + (isError ? 1 : 0),
        isCheckFailed: isCheck ? ran?.isError === true : a.isCheckFailed,
        files: file === null || id === 'main' || (a.files ?? []).includes(file) ? a.files : [...(a.files ?? []), file].slice(-50),
        }
      }))
      if (file !== null && id === 'main') await checkRework($, file)
      // 서브에이전트의 오류는 부서의 교훈으로 남긴다
      const who = (await agentsOf($)).find(a => a.id === id)
      // 실패하면 "oops!"(거절은 그 사람 실수가 아니니 말하지 않는다)
      if (ran !== undefined && ran.deny === undefined && ran.isError === true && who !== undefined) {
        const o = oopsOf(who.nick, e.tool, ran.text ?? '', await $.clock.now())
        await speak($, id, o.bubble, o.line)
      }
      if (isError && who?.dept !== undefined && ran !== undefined) {
        const text = ran.deny ?? ran.text ?? ''
        const dept: Dept = who.dept
        const at = await $.clock.now()
        await saveHr($, b => learn(b, dept, e.tool, text, at))
      }
      if (ran !== undefined && id !== 'main') nudge = await watch($, id, e, ran)
    }
    // 여기 오면 next가 답했다(던졌으면 finally 뒤로 나간다)
    const out = ran as NonNullable<typeof ran>
    if (out.deny !== undefined) return out
    const extra: string[] = nudge === null ? [] : [nudge]
    const rec = (out as { result?: unknown }).result
    const status = typeof rec === 'object' && rec !== null ? (rec as { status?: unknown; agentId?: unknown }) : {}
    // 기다려서 받은 서브에이전트의 보고는 결재를 마치고 돌려준다(반려면 그 의견을 붙여)
    if (e.tool === 'Agent' && out.isError !== true && status.status === 'completed' && typeof status.agentId === 'string') {
      const child = status.agentId
      // 남은 시간 안에서만 기다린다(다른 디스패치의 약속을 기다리는 시간은 이 훅의 몫이다). 못 받으면 의견은 다음 도구 결과로 넘어간다
      const stop = new AbortController()
      const deadline = $.clock.sleep(Math.max(1, Math.min(next.budget.remainingMs, 60_000) - 2_000), { signal: stop.signal }).catch(() => undefined)
      let isLate = false
      void deadline.then(() => {
        isLate = true
      })
      const within = async (p: Promise<unknown>) => {
        if (!isLate) await Promise.race([p, deadline])
      }
      await within(syncStatus($))
      // 이미 돌던 동기화가 이 에이전트의 끝남을 못 봤으면 한 번 더 본다
      const known = (await agentsOf($)).find(a => a.id === child)
      if (!approvals.has(child) && known !== undefined && known.endedAt === null) await within(syncStatus($))
      const pending = approvals.get(child)
      if (pending !== undefined) await within(pending)
      stop.abort()
    }
    if (e.tool === 'ExitPlanMode' && id === 'main' && out.isError !== true) {
      const plan = (status as { plan?: unknown }).plan
      const note = typeof plan === 'string' ? await reviewPlan($, plan).catch(() => null) : null
      if (note !== null) extra.push(note)
    }
    extra.push(...takeNotes(id, await agentsOf($)))
    if (extra.length === 0) return out
    return { ...out, context: [...(out.context ?? []), ...extra] }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    await read($, agentsAtom)
    isPaneShown = true
    const feed = (await read($, feedAtom)).slice(-FEED_SHOWN)
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
      const signs = [
        streakMax(a) >= ERROR_STREAK ? `같은 실수 ${streakMax(a)}연속` : null,
        (a.callStreak?.count ?? 0) >= REPEAT_STREAK ? '제자리걸음' : null,
        isOvertime(a.startedAt, a.endedAt, now) && a.id !== 'main' ? '야근' : null,
      ].filter(x => x !== null).map(x => ` · ${x}`).join('')
      const talk = isSpeaking(a.say, now) ? ` · "${a.say.text}"` : ''
      return { key: `row-${a.id}`, text: `${a.nick} ${who} · ${where}${talk} · 도구 ${a.tools}회${errs}${signs} · ${mins}분 · ${a.description || '-'}`, isOff: a.endedAt !== null, isBad: a.activity === 'failed' }
    })

    const feedLines = feed.map((u, i) => ({ key: `feed-${i}`, text: lineText(u, now), color: FEED_COLOR[u.kind] }))

    if (e.surface !== 'terminal') {
      offices.delete(PANE)
      const { Box, Text } = $.ui.resolve(e)
      return (
        <Box flexDirection="column">
          <Text dimColor>사무실 평면도는 터미널에서만 그려집니다. 인사 기록은 /office hr.</Text>
          {lines.map(l => <Box key={l.key}><Text dimColor={l.isOff} color={l.isBad ? 'red' : undefined}>{l.text}</Text></Box>)}
          {feedLines.length > 0 && <Text bold>사내 메신저</Text>}
          {feedLines.map(l => <Box key={l.key}><Text color={l.color} wrap="truncate-end">{l.text}</Text></Box>)}
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
        {feedLines.length > 0 && <Box marginTop={1}><Text bold>사내 메신저</Text></Box>}
        {feedLines.map(l => <Box key={l.key}><Text color={l.color} wrap="truncate-end">{l.text}</Text></Box>)}
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
