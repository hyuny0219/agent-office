// 업무 흐름. 엔진이 알려 주는 에이전트 상태를 사무실로 옮기고(끝남·실패·대기), 끝낸 일을 평가해 인사 기록에 남기고,
// 보고를 결재에 올리고, 근태(같은 실수 연발·제자리걸음·야근)와 재작업을 본다. 결정은 순수 함수 모듈에 맡기고
// 여기서는 그 결과를 상태·인사 기록·토스트·메신저로 옮긴다.
import type { EngineInterface } from 'claude-code'

import type { OfficeActivity, OfficeAgent, Streak, TrialTicket } from '../types'
import { CHECK_PENALTY, decide, DEPT_INFO, DEPTS, deptOf, gradeOf, handOff, hire, lessonsFor, warn, rankOf, record, review, rework, REWORK_PENALTY, salaryOf } from './hr'
import { APPROVAL_TIMEOUT_MS, APPROVER_MODEL, decisionOf, decisionToast, planNoteOf, planRequestOf, planReviewerOf, planReviewOf, REJECT_PENALTY, rejectNoteOf, requestOf, routeOf } from './approval'
import type { Facts } from './approval'
import { approvalLineOf, replyOf, reportLineOf } from './speech'
import { settle } from './trial'
import { callKeyOf, ERROR_STREAK, errorKeyOf, errorToast, isAlarm, isOvertime, isPolling, nudgeOf, REPEAT_STREAK, repeatToast, stepOf } from './watch'
import { shortType } from './scene'
import { admit, agentsOf, fresh, hrOf, MEET_MS, meet, nickOfId, patch, save, saveHr, speak } from './store'

/** 파일을 고치는 도구(재작업 판정에 쓴다) */
export const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
export const fileOf = (e: object): string | null => {
  const { file_path, notebook_path } = e as { file_path?: unknown; notebook_path?: unknown }
  const f = file_path ?? notebook_path
  return typeof f === 'string' && f !== '' ? f : null
}
const baseName = (f: string): string => f.split('/').pop() ?? f
/** 테스트·빌드·타입 검사로 보이는 Bash 명령 */
const CHECK_RE = /\b(test|tests|build|tsc|jest|vitest|pytest|mocha|lint|typecheck|check|cargo|go\s+(test|build|vet)|make|gradle|mvn|ruff|mypy|eslint)\b/
export const isCheckCommand = (e: object): boolean => {
  const { command } = e as { command?: unknown }
  return typeof command === 'string' && CHECK_RE.test(command)
}

/** 결재에 쓸 지시·보고(에이전트 id →). 패널이 구독하는 상태에 두지 않는다: 길어서 쓸 때마다 패널로 실려 간다 */
export const papers = new Map<string, { task?: string; report?: string }>()
/** 진행 중인 결재(에이전트 id → 반려면 띄운 쪽이 읽을 글) */
export const approvals = new Map<string, Promise<string | null>>()
/** 띄운 쪽이 아직 못 읽은 결재 결과(메인은 다음 도구 결과 뒤에 읽는다) */
let notes: { agentId: string; parentId: string; text: string }[] = []
const MAX_NOTES = 20

export const movedText = (r: { promotedTo: string | null; demotedTo: string | null }): string =>
  r.promotedTo !== null ? ` · ${r.promotedTo} 승진!` : r.demotedTo !== null ? ` · ${r.demotedTo}(으)로 강등` : ''

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
export async function reviewPlan($: EngineInterface, plan: string): Promise<string | null> {
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
export function takeNotes(callerId: string, agents: readonly OfficeAgent[]): string[] {
  // 메인은 자기 몫과, 띄운 쪽이 이미 끝나 읽을 수 없는 몫을 가져간다
  const isGone = (id: string) => agents.find(a => a.id === id)?.endedAt !== null
  const mine = notes.filter(n => n.parentId === callerId || (callerId === 'main' && isGone(n.parentId)))
  notes = notes.filter(n => !mine.includes(n))
  return mine.map(n => n.text)
}

/** BOSS가 파일을 고쳤다: 방금 끝낸 직원의 파일이면 재작업으로 깎는다 */
export async function checkRework($: EngineInterface, file: string) {
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
export function syncStatus($: EngineInterface): Promise<void> {
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

/**
 * 근태: 같은 오류를 연달아 내거나 같은 호출을 되풀이하면 사용자에게 알리고 기록한다.
 * 코칭이 켜져 있으면 그 직원에게 붙일 알림을 돌려준다.
 */
export async function watch($: EngineInterface, id: string, e: { tool: string } & object, ran: { deny?: string; text?: string; isError?: boolean }): Promise<string | null> {
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

/**
 * 기다려서 받은 서브에이전트의 보고: 그 결재가 끝날 때까지 기다린다(반려 의견을 같은 결과에 붙이도록).
 * 남은 시간 안에서만 기다린다(다른 디스패치의 약속을 기다리는 시간은 이 훅의 몫이다). 못 받으면 의견은 다음 도구 결과로 넘어간다
 */
export async function awaitApproval($: EngineInterface, child: string, remainingMs: number) {
  const stop = new AbortController()
  const deadline = $.clock.sleep(Math.max(1, Math.min(remainingMs, 60_000) - 2_000), { signal: stop.signal }).catch(() => undefined)
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
