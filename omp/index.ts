// agent-office for oh-my-pi. 서브에이전트(task 도구)를 부서 직원으로 받아 평가·결재·인사 기록을 남기고, 입력창 위에 사무실을 보인다.
// 판단은 모두 core/(Claude Code판과 같은 코드)가 하고, 여기서는 oh-my-pi의 사건·화면·저장소를 잇기만 한다.
// 인사 기록은 Claude Code판과 따로 ~/.omp/agent-office/hr.json에 남는다.
import { completeSimple } from '@oh-my-pi/pi-ai'

import type { Dept, Employee, HrBook, OfficeAgent } from '../types'
import { answerWith } from '../core/answer'
import { decide, deptOf, DEPTS, handOff, hire, leadOf, learn, lessonsFor, record, review, rework, salaryOf, assign, briefOf } from '../core/hr'
import { decisionOf, decisionToast, REJECT_PENALTY, rejectNoteOf, requestOf, routeOf } from '../core/approval'
import type { Facts } from '../core/approval'
import { followUp, isRejectTrusted, pickFor, reorgOf } from '../core/org'
import { addNote, briefNotes, markRejected, noteOf } from '../core/notes'
import { checkRunOf, errLineOf, oopsOf, orderOf, reportLineOf, selfTalkOf, hrLineOf, approvalLineOf } from '../core/speech'
import { isCheckCommand } from '../core/watch'
import { activityOf, layoutOf, nickFor, Office } from '../core/scene'
import { addTokens, chargeReview, priceOf, usdOf } from '../core/tokens'
import type { TokenUse } from '../types'
import { feedRowsOf, rowsOf } from '../core/rows'
import { budgetBlocks, noticed, overrunsOf, overrunText } from '../core/budget'
import { cardBlocks, findEmployee, reportBlocks, rosterBlocks } from '../core/report'
import { mdOf, textOf, widthOf } from '../core/table'
import { playbookBlocks } from '../core/playbook'
import type { Block } from '../core/table'
import { ansiLines } from './ansi'
import { agents, changed, feedOf, hr, onChange, patch, saveHr, say, takeLoadWarning, trim } from './store'

// oh-my-pi의 형식은 확장 쪽에서 느슨하게 받는다(판마다 바뀌는 타입에 묶이지 않도록)
type Ctx = any
type Pi = any

/** 결재자 모델(지금 세대 Haiku) */
const APPROVER = 'haiku'
const APPROVAL_TIMEOUT_MS = 8_000
const EDIT_TOOLS = new Set(['edit', 'write'])
/** omp의 도구 이름(소문자)을 core가 아는 이름(Bash·Read…)으로 */
const toolName = (t: string): string => (t === '' ? t : t[0]!.toUpperCase() + t.slice(1))

const now = () => Date.now()
const textOfContent = (content: unknown): string => (Array.isArray(content) ? content.map((c: any) => (typeof c?.text === 'string' ? c.text : '')).join('') : typeof content === 'string' ? content : '')
const fileOf = (input: Record<string, unknown>): string | null => {
  const f = input.path ?? input.file_path ?? (Array.isArray(input.paths) ? input.paths[0] : undefined)
  return typeof f === 'string' && f !== '' ? f : null
}

/** 결재 의견(에이전트 id →): 부모가 그 에이전트의 결과를 받을 때(wait·task 결과 뒤) 붙인다 */
const notes = new Map<string, string>()
/** 그 에이전트들의 결재 의견을 꺼낸다(한 번만 붙도록 지운다) */
const takeNotes = (ids: readonly string[]): string[] => ids.flatMap(k => {
  const n = notes.get(k)
  notes.delete(k)
  if (n !== undefined) delivered.delete(k)
  return n === undefined ? [] : [n]
})
/** 메인이 결과(wait·task)를 이미 받은 에이전트: 그 뒤에 끝난 결재 의견만 다른 도구 결과에 붙인다 */
const delivered = new Set<string>()
/** 평면도 애니메이션 타이머(세션마다 쌓이지 않게 하나) */
let ticker: ReturnType<typeof setInterval> | null = null
/** 진행 중인 결재(에이전트 id →) */
const approvals = new Map<string, Promise<void>>()
/** 결재에 쓸 지시·보고 */
const papers = new Map<string, { task: string; report: string }>()

function busy(): Set<string> {
  return new Set([...agents.values()].filter(a => a.endedAt === null).map(a => a.nick))
}

/** 그 부서에서 이 일을 맡을 직원(적임자, 없으면 쉬는 사람, 없으면 새로 뽑는다) */
function staff(type: string, description: string): { employee: Employee; why: string | null } {
  const b = hr()
  const dept = deptOf(type)
  const picked = description.trim() === '' ? null : pickFor(b, dept, busy(), description)
  if (picked !== null) return picked
  const had = assign(b, dept, busy())
  if (had !== undefined) return { employee: had, why: null }
  const taken = [...agents.values(), ...[...b.employees, ...b.retired, ...b.log].map(e => ({ nick: e.nick, endedAt: 0 }))]
  const hired = hire(b, nickFor(type, taken), dept, type, now())
  saveHr(() => hired.book)
  return { employee: hired.employee, why: null }
}

const freshAgent = (id: string, type: string, nick: string, description: string, parentId: string | null): OfficeAgent => ({
  id, type, nick, description, model: null, startedAt: now(), endedAt: null, activity: type === 'main' ? 'idle' : 'think', tool: null, tools: 0,
  parentId, ...(type === 'main' ? {} : { dept: deptOf(type) as Dept }),
})

/** 서브에이전트가 받은 지시에서 업무 설명(첫 줄다운 줄) */
const descriptionOf = (prompt: string): string =>
  prompt.split('\n').map(l => l.trim()).find(l => l !== '' && !/^complete assignment/i.test(l))?.slice(0, 80) ?? ''

/** 모델 한 번의 사용량을 TokenUse로(가격을 아는 모델이면 달러까지) */
function tokensOfUsage(u: any, model: string | undefined): TokenUse | null {
  if (u === null || typeof u !== 'object') return null
  const n = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x > 0 ? x : 0)
  const t: TokenUse = { input: n(u.input), output: n(u.output), cacheRead: n(u.cacheRead), cacheWrite: n(u.cacheWrite), usd: 0, unpriced: 0 }
  const total = t.input + t.output + t.cacheRead + t.cacheWrite
  if (total === 0) return null
  const p = model === undefined ? null : priceOf(model)
  return p === null ? { ...t, unpriced: total } : { ...t, usd: usdOf(t, p) }
}

/** 결재: 결재자 모델을 한 번 부르고, 반려면 의견을 남긴다 */
async function approve(ctx: Ctx, a: OfficeAgent, job: number, xpBefore: number, f: Facts): Promise<void> {
  const b = hr()
  const found = b.employees.find(x => x.nick === a.nick)
  if (found === undefined || !b.isApproving) return
  const e = { ...found, xp: xpBefore }
  const route = routeOf(b, e, f.tools)
  if (route.kind === 'exempt') {
    saveHr(x => decide(x, a.nick, job, 'exempt', 0).book)
    ctx.ui?.notify?.(decisionToast(e, route, f.description, null), 'info')
    return
  }
  if (f.report.trim() === '') return
  const model = ctx.models?.resolve?.(APPROVER)
  if (model === undefined) return
  const apiKey = await ctx.modelRegistry?.getApiKey?.(model)
  const ask = requestOf(e, route, f)
  const signal = AbortSignal.timeout(APPROVAL_TIMEOUT_MS)
  const reply: any = await completeSimple(model, { systemPrompt: [ask.system], messages: [{ role: 'user', content: ask.prompt, timestamp: now() }] } as any, { apiKey, maxTokens: 400, signal } as any)
    .catch(() => null)
  const text = reply === null ? '' : textOfContent(reply.content)
  const spent = reply === null ? null : tokensOfUsage(reply.usage, model.id)
  const d = text === '' ? null : decisionOf(text)
  if (d === null) {
    if (spent !== null) saveHr(x => chargeReview(x, a.nick, job, spent))
    ctx.ui?.notify?.(decisionToast(e, route, f.description, null), 'info')
    return
  }
  const penalty = isRejectTrusted(b, route.approver, now()) ? REJECT_PENALTY : 0
  saveHr(x => {
    const moved = decide(spent === null ? x : chargeReview(x, a.nick, job, spent), a.nick, job, d.verdict, penalty, route.approver).book
    return d.verdict === 'rejected' ? markRejected(moved, a.nick, job, d.notes) : moved
  })
  ctx.ui?.notify?.(decisionToast(e, route, f.description, d, penalty), d.verdict === 'rejected' ? 'warning' : 'info')
  say(approvalLineOf(route.approverTitle, `${e.nick} "${f.description}" ${d.verdict === 'approved' ? '승인' : `반려${d.notes[0] === undefined ? '' : ` — ${d.notes[0]}`}`}`, now()))
  if (d.verdict === 'rejected') notes.set(a.id, rejectNoteOf(e, route, f.description, d))
  changed()
}

/** 서브에이전트가 일을 끝냈다: 평가하고 인사 기록·업무 노트에 남긴 뒤 결재에 올린다 */
function appraise(ctx: Ctx, a: OfficeAgent, isDone: boolean) {
  if (a.endedAt !== null) return
  const ended = now()
  patch(a.id, x => ({ ...x, endedAt: ended, activity: isDone ? 'done' : 'failed', tool: null }))
  const got = agents.get(a.id) ?? a
  let xpBefore = 0
  let job = 0
  let score = 0
  saveHr(x => {
    xpBefore = x.employees.find(y => y.nick === a.nick)?.xp ?? 0
    const reviewed = review(x, a.nick, { isDone, isKilled: false, errors: got.errors ?? 0, tools: got.tools, isCheckFailed: got.isCheckFailed }, ended)
    score = reviewed.score
    const withTokens = got.tokens === undefined ? reviewed.book
      : { ...reviewed.book, employees: reviewed.book.employees.map(y => (y.nick === a.nick ? { ...y, tokens: addTokens(y.tokens, got.tokens), tokenJobs: (y.tokenJobs ?? 0) + 1 } : y)) }
    const employee = withTokens.employees.find(y => y.nick === a.nick)
    job = employee?.jobs ?? 0
    const logged = record(withTokens, {
      nick: a.nick, dept: a.dept ?? deptOf(a.type), job, description: got.description, startedAt: got.startedAt, endedAt: ended,
      outcome: isDone ? 'done' : 'failed', score, errors: got.errors ?? 0, isCheckFailed: isDone && got.isCheckFailed === true, isReworked: false,
      alarms: got.alarms ?? 0, files: (got.files ?? []).length, ...(employee === undefined ? {} : { salary: salaryOf(withTokens, employee) }),
      ...(got.tokens === undefined ? {} : { tokens: got.tokens }),
    })
    const noted = employee === undefined ? logged : addNote(logged, a.nick, noteOf(job, got.description, papers.get(a.id)?.report ?? '', got.files ?? [], got.errLines ?? []))
    return isDone ? handOff(noted, { agentId: a.id, nick: a.nick, files: got.files ?? [], endedAt: ended, job }) : noted
  })
  ctx.ui?.notify?.(`${a.nick} 평가 ${score >= 0 ? '+' : ''}${score}`, 'info')
  say(reportLineOf(a.nick, 'BOSS', papers.get(a.id)?.report ?? '', ended).line)
  const f: Facts = {
    description: got.description, task: papers.get(a.id)?.task ?? '', report: papers.get(a.id)?.report ?? '', tools: got.tools, errors: got.errors ?? 0,
    isCheckFailed: got.isCheckFailed === true, alarms: got.alarms ?? 0, files: (got.files ?? []).length, durationMs: ended - got.startedAt,
    fileNames: got.files ?? [], checks: got.checks ?? [], errLines: got.errLines ?? [],
  }
  const p = (isDone ? approve(ctx, got, job, xpBefore, f) : Promise.resolve()).catch(() => undefined).finally(() => {
    approvals.delete(a.id)
    papers.delete(a.id)
    checkBudget(ctx)
    trim()
  })
  approvals.set(a.id, p)
}

/** 부서 하루 예산을 넘었으면 하루 한 번 알린다 */
function checkBudget(ctx: Ctx) {
  const b = hr()
  const over = overrunsOf(b, [...agents.values()], now())
  if (over.length === 0) return
  saveHr(x => noticed(x, over.map(o => o.dept), now()))
  for (const o of over) {
    ctx.ui?.notify?.(`${overrunText(o)}. 한도를 바꾸려면 /office budget ${o.dept} <달러>`, 'warning')
    say(hrLineOf(overrunText(o), now()))
  }
}

/** 오래 일이 없거나 계속 성과가 나쁜 직원을 내보낸다(조직 개편이 켜져 있을 때) */
function reorganize(ctx: Ctx) {
  if (!hr().isReorganizing) return
  let gone: ReturnType<typeof reorgOf>['gone'] = []
  saveHr(x => {
    const r = reorgOf(x, busy(), now())
    gone = r.gone
    return r.book
  })
  for (const e of gone) {
    ctx.ui?.notify?.(`${e.nick} ${e.reason}`, 'info')
    say(hrLineOf(`${e.nick} ${e.reason}`, now()))
  }
}

// ── 화면: 입력창 위 사무실(목록, 켜면 평면도) ─────────────

const FRAME_MS = 200
let isPlanShown = false
let office: Office | null = null
let frame = 0

/** 위젯이 받은 화면(사이드바를 띄울 때 쓴다) */
let lastTui: any = null

// ── 사이드바(켜야 보임): 오른쪽에 겹쳐 띄우는 사무실. 일반 터미널에서 겹친 화면이 떠 있으면 omp는 전역 단축키(Ctrl+O 등)를 쉬게 하므로
// 기본은 입력창 위 2단 패널이다. 사이드바는 키를 받지 않아(handleInput 없음), omp가 정한 곳(입력창·승인 창)으로 키가 그대로 간다 ─────────────

/** 사이드바를 보이는 최소 터미널 폭 */
const SIDE_MIN_COLUMNS = 120
let side: { hide: () => void } | null = null
/** 사이드바를 띄워 둘지(기본 꺼짐, AGENT_OFFICE_SIDE=1이면 켜고 시작). /office side로 바꾼다 */
let isSideWanted = process.env.AGENT_OFFICE_SIDE === '1'
/** 사이드바가 그리는 평면도(입력창 위 패널과 폭이 달라 따로 둔다) */
let sideOffice: Office | null = null

function sideComponent(beforeRender: () => void) {
  const off = onChange(() => lastTui?.requestRender?.())
  return {
    render(width: number): string[] {
      beforeRender()
      const b = hr()
      const t = now()
      const list = [...agents.values()]
      const inner = Math.max(10, width - 2)
      const bar = `\x1b[2m│\x1b[0m `
      const lines: string[] = [`\x1b[2m╭${'─'.repeat(Math.max(0, width - 1))}\x1b[0m`, `${bar}\x1b[1m에이전트 사무실\x1b[0m \x1b[2m(/office side 닫기 · /office menu)\x1b[0m`]
      if (isPlanShown && inner >= 72) {
        const layout = layoutOf(inner)
        if (sideOffice === null || sideOffice.layout.columns !== layout.columns) sideOffice = new Office(layout)
        const leads = Object.fromEntries(DEPTS.map(d => [d, leadOf(b, d)?.nick]).filter(([, n]) => n !== undefined))
        for (const l of ansiLines(sideOffice.draw(list, frame, t, leads), layout.columns, layout.rows)) lines.push(`${bar}${l}`)
      }
      const rows = rowsOf(list, b, t, inner)
      for (const r of rows.length === 0 ? [{ text: '아직 일하는 에이전트가 없습니다', isOff: true, isBad: false }] : rows) lines.push(`${bar}${r.isOff ? `\x1b[2m${r.text}\x1b[0m` : r.isBad ? `\x1b[31m${r.text}\x1b[0m` : r.text}`)
      const feed = feedRowsOf(feedOf(), t)
      lines.push(bar, `${bar}\x1b[1m사내 메신저\x1b[0m`, ...(feed.length === 0 ? [`${bar}\x1b[2m아직 오간 말이 없습니다\x1b[0m`] : feed.map(f => `${bar}\x1b[2m${f.text}\x1b[0m`)))
      // 내용 높이만큼의 테두리 상자(화면 높이를 채우면 omp가 위에서부터 그리는 입력창·상태 줄을 가린다)
      lines.push(`\x1b[2m╰${'─'.repeat(Math.max(0, width - 1))}\x1b[0m`)
      return lines.map(l => clip(l, width))
    },
    invalidate() {},
    dispose() {
      off()
    },
  }
}

/** 사이드바를 띄운다(이미 떠 있으면 그대로). 띄울 수 없으면 false */
function openSide(): boolean {
  if (side !== null) return true
  const tui = lastTui
  if (tui === null || typeof tui.showOverlay !== 'function') return false
  // 키는 omp가 정한 곳(입력창·승인 창)으로 가지만, 겹친 화면에 포커스가 가면 입력창이 커서를 그리지 않는다:
  // 띄우기 전의 입력창이 계속 커서를 그리게 한다(한글 조합 위치도 그 커서를 따른다)
  const editor = tui.getFocused?.() ?? null
  const comp = sideComponent(() => {
    if (editor !== null && typeof editor === 'object' && 'focused' in editor && tui.getFocused?.() === comp) editor.focused = true
  })
  const handle = tui.showOverlay(comp, { anchor: 'top-right', width: '34%', minWidth: 44, maxHeight: '100%', visible: (w: number) => w >= SIDE_MIN_COLUMNS })
  if (editor !== null && typeof editor === 'object' && 'focused' in editor) editor.focused = true
  side = {
    hide: () => {
      handle.hide()
      comp.dispose()
    },
  }
  tui.requestRender?.()
  return true
}

/** 사이드바를 켜고 끈다. 켜졌으면 true, 띄울 수 없는 화면이면 null */
function toggleSide(): boolean | null {
  if (side !== null) {
    side.hide()
    side = null
    isSideWanted = false
    lastTui?.requestRender?.()
    return false
  }
  isSideWanted = true
  return openSide() ? true : null
}

/** 사이드바가 지금 보이는지(넓은 창에서 떠 있을 때): 그동안 입력창 위 목록은 숨긴다 */
const isSideShown = (width: number): boolean => side !== null && (lastTui?.terminal?.columns ?? width) >= SIDE_MIN_COLUMNS

export function officeComponent(tui: any) {
  lastTui = tui
  // 기본으로 사이드바를 띄운다(위젯이 화면에 붙은 뒤에)
  if (isSideWanted && side === null) setTimeout(() => {
    if (isSideWanted) openSide()
  }, 0)
  const off = onChange(() => tui.requestRender?.())
  return {
    render(width: number): string[] {
      if (isSideShown(width)) return []
      const b = hr()
      const t = now()
      const list = [...agents.values()]
      const lines: string[] = []
      if (isPlanShown && width >= 72) {
        const layout = layoutOf(width)
        if (office === null || office.layout.columns !== layout.columns) office = new Office(layout)
        const leads = Object.fromEntries(DEPTS.map(d => [d, leadOf(b, d)?.nick]).filter(([, n]) => n !== undefined))
        lines.push(...ansiLines(office.draw(list, frame, t, leads), layout.columns, layout.rows))
      }
      // 2단: 왼쪽 사무실 목록 | 오른쪽 사내 메신저(좁으면 위아래로)
      const isTwo = width >= TWO_COLUMN_MIN
      const leftW = isTwo ? Math.floor(width * 0.55) : width
      const rightW = isTwo ? width - leftW - 3 : width
      const rows = rowsOf(list, b, t, leftW)
      const left = rows.length === 0 ? ['\x1b[2m에이전트 사무실: 아직 일하는 에이전트가 없습니다 (/office menu)\x1b[0m'] : rows.map(r => (r.isOff ? `\x1b[2m${r.text}\x1b[0m` : r.isBad ? `\x1b[31m${r.text}\x1b[0m` : r.text))
      const feed = feedRowsOf(feedOf(), t).slice(isTwo ? -Math.max(left.length, 3) : -2)
      const right = feed.length === 0 ? ['\x1b[2m사내 메신저: 아직 오간 말이 없습니다\x1b[0m'] : feed.map(f => `\x1b[2m${f.text}\x1b[0m`)
      if (!isTwo) {
        lines.push(...left.map(l => clip(l, width)), ...right.map(l => clip(l, width)))
        return lines.map(l => clip(l, width))
      }
      for (let i = 0; i < Math.max(left.length, right.length); i++) {
        lines.push(`${pad(left[i] ?? '', leftW)} \x1b[2m│\x1b[0m ${clip(right[i] ?? '', rightW)}`)
      }
      return lines.map(l => clip(l, width))
    },
    invalidate() {},
    dispose() {
      off()
    },
  }
}

/** 2단 패널을 쓰는 최소 폭 */
const TWO_COLUMN_MIN = 90

/** 보이는 칸 수에 맞춰 자르고 모자라면 빈칸으로 채운다 */
function pad(line: string, width: number): string {
  const cut = clip(line, width)
  const seen = widthOf(cut.replace(/\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, ''))
  return `${cut}${' '.repeat(Math.max(0, width - seen))}`
}

/** 보이는 칸 수로 자른다(ANSI 코드는 칸을 차지하지 않는다) */
function clip(line: string, width: number): string {
  let out = ''
  let w = 0
  // 색(SGR)·지우기 같은 CSI와 링크(OSC)는 칸을 차지하지 않는다
  for (const m of line.matchAll(/\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|[\s\S]/gu)) {
    const s = m[0]
    if (s.startsWith('\x1b')) {
      out += s
      continue
    }
    const cw = widthOf(s)
    if (w + cw > width) break
    out += s
    w += cw
  }
  return `${out}\x1b[0m`
}

// ── 메뉴 화면: 1~5로 고른 것을 표로, 설정은 그 자리에서 켜고 끈다 ─────────────

const MENU = [
  { key: '1', label: '인사 명부', view: 'hr' },
  { key: '2', label: '일간 보고', view: 'today' },
  { key: '3', label: '주간 보고', view: 'week' },
  { key: '4', label: '예산', view: 'budget' },
  { key: '5', label: '설정', view: 'settings' },
  { key: '6', label: '지침', view: 'playbook' },
] as const
const TOGGLES = [
  { key: 'a', label: '결재', isOn: (b: HrBook) => b.isApproving, flip: (b: HrBook): HrBook => ({ ...b, isApproving: !b.isApproving }) },
  { key: 'r', label: '조직 개편', isOn: (b: HrBook) => b.isReorganizing, flip: (b: HrBook): HrBook => ({ ...b, isReorganizing: !b.isReorganizing }) },
  { key: 'm', label: '인사 메모', isOn: (b: HrBook) => b.isCoaching, flip: (b: HrBook): HrBook => ({ ...b, isCoaching: !b.isCoaching }) },
  { key: 't', label: '교육 효과 측정', isOn: (b: HrBook) => b.isTrialing, flip: (b: HrBook): HrBook => ({ ...b, isTrialing: !b.isTrialing }) },
] as const

function viewBlocks(view: string): Block[] {
  const b = hr()
  const t = now()
  if (view.startsWith('card:')) {
    const who = findEmployee(b, view.slice(5))
    return who === undefined ? [{ t: 'line', text: `${view.slice(5)}라는 직원이 없습니다.` }] : cardBlocks(b, who, t)
  }
  if (view === 'today' || view === 'week') return reportBlocks(b, view, t, [...agents.values()])
  if (view === 'budget') {
    const blocks = budgetBlocks(b, [...agents.values()], t)
    return blocks.length > 0 ? blocks : [{ t: 'title', text: '부서 예산' }, { t: 'line', text: '부서 예산이 없습니다. /office budget <부서> <달러> (예: /office budget 개발팀 5)' }]
  }
  if (view === 'playbook') return playbookBlocks(b, t)
  if (view === 'settings') return [{ t: 'title', text: '설정' }, { t: 'line', text: '글자를 누르면 바로 켜고 끕니다.' }, ...TOGGLES.map(x => ({ t: 'bullet', text: `${x.key}: ${x.isOn(b) ? '[켜짐]' : '[꺼짐]'} ${x.label}` } as const))]
  return rosterBlocks(b, t)
}

async function openMenu(ctx: Ctx, first: string) {
  if (ctx.hasUI === false || ctx.ui?.custom === undefined) {
    ctx.ui?.notify?.(textOf(viewBlocks(first)), 'info')
    return
  }
  let markdown: any = null
  try {
    // 패키지의 하위 경로는 omp가 실행할 때 푼다(타입 검사 쪽에서는 이름만 넘긴다)
    const tuiPath = '@oh-my-pi/pi-tui'
    const themePath = '@oh-my-pi/pi-tui/theme/tui-adapters'
    const tuiMod: any = await import(tuiPath)
    const themeMod: any = await import(themePath)
    markdown = (text: string) => new tuiMod.Markdown(text, 1, 0, themeMod.getMarkdownTheme())
  } catch {
    markdown = null
  }
  await ctx.ui.custom((tui: any, _theme: any, _kb: any, done: (r: undefined) => void) => {
    let view = first
    const head = () => `${MENU.map(m => (m.view === view ? `\x1b[7m ${m.key} ${m.label} \x1b[0m` : ` ${m.key} ${m.label} `)).join(' ')}   \x1b[2mq 닫기\x1b[0m`
    return {
      render(width: number): string[] {
        const blocks = viewBlocks(view)
        const body = markdown === null ? textOf(blocks).split('\n') : [...markdown(mdOf(blocks)).render(width)]
        return [clip(head(), width), '', ...body.map((l: string) => clip(l, width))]
      },
      handleInput(data: string) {
        const m = MENU.find(x => x.key === data)
        if (m !== undefined) view = m.view
        else if (view === 'settings' && TOGGLES.some(x => x.key === data)) saveHr(TOGGLES.find(x => x.key === data)!.flip)
        else if (data === 'q' || data === '\x1b') return done(undefined)
        tui.requestRender?.()
      },
      invalidate() {},
    }
  }, { overlay: true })
}

// ── 사건 연결 ─────────────

export default function agentOffice(pi: Pi) {
  pi.registerCommand('office', {
    description: '에이전트 사무실: 인자 없이 평면도 켜고 끄기, side(오른쪽 사이드바 켜고 끄기), menu(메뉴 화면), playbook [<부서> adopt <n|all>|<부서> drop <n>](부서 지침), report [today|week], hr [<별칭>], rate <별칭> good|bad|clear, budget, approval·reorg·hr on|off',
    handler: async (args: string, ctx: Ctx) => {
      const a = (args ?? '').trim()
      if (a === '') {
        isPlanShown = !isPlanShown
        ctx.ui?.notify?.(isPlanShown ? '사무실 평면도를 켭니다.' : '사무실 평면도를 끕니다(목록만).', 'info')
        changed()
        return
      }
      if (a.toLowerCase() === 'menu') return openMenu(ctx, 'hr')
      if (a.toLowerCase() === 'side') {
        const on = toggleSide()
        ctx.ui?.notify?.(on === null ? '사이드바를 띄울 수 없는 화면입니다(대화형 터미널에서만).' : on ? `사이드바를 켭니다(터미널 폭 ${SIDE_MIN_COLUMNS}칸 이상일 때 보임). 끄려면 /office side` : '사이드바를 끕니다.', 'info')
        return
      }
      const text = await answerWith({ book: async () => hr(), save: async fn => void saveHr(fn), agents: async () => [...agents.values()], now: async () => now() }, a)
      if (text === null) {
        ctx.ui?.notify?.(`모르는 명령입니다: /office ${a}. 쓰는 법: /office [menu | report today|week | hr [<별칭>] | rate <별칭> good|bad|clear | budget | approval|reorg|hr on|off]`, 'warning')
        return
      }
      changed()
      // 보고서·명부·인사카드는 메뉴 화면에 표로(사용법 안내나 켜고 끄기 답은 알림으로)
      const [sub, arg] = a.split(/\s+/).map(x => x.toLowerCase())
      const isReport = sub === 'report' && (arg === undefined || arg === 'today' || arg === 'week')
      const isHr = sub === 'hr' && (arg === undefined || !['on', 'off', 'ab'].includes(arg)) && !/라는 직원이 없습니다/.test(text)
      if ((isReport || isHr) && ctx.ui?.custom !== undefined) return openMenu(ctx, isReport ? (arg === 'week' ? 'week' : 'today') : arg === undefined ? 'hr' : `card:${a.split(/\s+/)[1]}`)
      ctx.ui?.notify?.(text, 'info')
    },
  })

  pi.on('session_start', async (_e: any, ctx: Ctx) => {
    if (ctx.agent?.kind === 'sub') return
    if (!agents.has('main')) agents.set('main', { ...freshAgent('main', 'main', 'BOSS', '메인 대화', null) })
    const bad = takeLoadWarning()
    if (bad !== null) ctx.ui?.notify?.(`인사 기록 파일을 읽을 수 없어 ${bad}로 옮겨 두고 새로 시작합니다.`, 'warning')
    reorganize(ctx)
    ctx.ui?.setWidget?.('agent-office', (tui: any) => officeComponent(tui), { placement: 'aboveEditor' })
    // 세션을 새로 열 때마다 타이머가 쌓이지 않게 하나만 둔다
    if (ticker !== null) clearInterval(ticker)
    ticker = setInterval(() => {
      frame++
      if (isPlanShown) changed()
    }, FRAME_MS)
    ticker.unref?.()
  })

  // 서브에이전트: 지시를 받을 때 부서 직원에게 맡기고, 인사 메모는 그 서브에이전트의 시스템 프롬프트에만 붙인다(메인의 지시는 건드리지 않는다)
  pi.on('before_agent_start', async (e: any, ctx: Ctx) => {
    if (ctx.agent?.kind !== 'sub' || e.reason !== 'prompt' || agents.has(ctx.agent.id)) return
    const type = String(ctx.agent.name ?? 'task')
    const description = descriptionOf(String(e.prompt ?? ''))
    const { employee, why } = staff(type, description)
    agents.set(ctx.agent.id, { ...freshAgent(ctx.agent.id, type, employee.nick, description, ctx.agent.parentId ?? 'main'), dept: employee.dept })
    papers.set(ctx.agent.id, { task: String(e.prompt ?? '').slice(0, 4000), report: '' })
    say(orderOf('BOSS', employee.nick, description, '', now(), why).line)
    changed()
    const b = hr()
    if (!b.isCoaching) return
    const memo = briefOf(b, employee, now(), lessonsFor(b, employee.dept, now()), why, briefNotes(b, employee, description))
    return memo === null ? undefined : { systemPrompt: [...(e.systemPrompt ?? []), memo] }
  })

  pi.on('tool_call', async (e: any, ctx: Ctx) => {
    const id = ctx.agent?.kind === 'sub' ? ctx.agent.id : 'main'
    const a = agents.get(id)
    // 끝난 사람(평가를 마친 서브에이전트)의 늦은 도구는 세지 않는다
    if (a === undefined || (id !== 'main' && a.endedAt !== null)) return
    const name = toolName(String(e.toolName ?? ''))
    const talk = selfTalkOf(a.nick, { tool: name, ...(e.input ?? {}) }, now())
    patch(id, x => ({ ...x, activity: activityOf(name), tool: name, tools: x.tools + 1, say: talk.bubble }))
    if (talk.line !== null) say(talk.line)
  })

  pi.on('tool_result', async (e: any, ctx: Ctx) => {
    const id = ctx.agent?.kind === 'sub' ? ctx.agent.id : 'main'
    const a = agents.get(id)
    const input = (e.input ?? {}) as Record<string, unknown>
    const tool = String(e.toolName ?? '')
    const text = textOfContent(e.content)
    // 메인이 결과를 받는 자리(wait·task): 끝난 서브에이전트의 결재가 끝나기를 잠깐 기다려 반려 의견을 붙인다
    if (id === 'main' && (tool === 'wait' || tool === 'task')) {
      // 결과에 그 에이전트 id가 낱말로 보이면(부분 문자열로 다른 에이전트를 잡지 않게)
      const ids = [...agents.keys()].filter(k => k !== 'main' && new RegExp(`(^|[^\\w-])${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\w-]|$)`).test(text))
      if (ids.length > 0) {
        let timer: ReturnType<typeof setTimeout> | undefined
        await Promise.race([Promise.all(ids.map(k => approvals.get(k) ?? Promise.resolve())), new Promise(r => { timer = setTimeout(r, APPROVAL_TIMEOUT_MS) })])
        if (timer !== undefined) clearTimeout(timer)
      }
      for (const k of ids) delivered.add(k)
      const extra = takeNotes(ids)
      if (extra.length > 0) return { content: [...(e.content ?? []), ...extra.map(t => ({ type: 'text', text: `\n\n${t}` }))] }
      return
    }
    // 메인이 결과를 이미 받은 에이전트의 결재가 그 뒤에 끝났으면, 메인의 다음 도구 결과 뒤에 의견을 붙인다(기록은 아래에서 그대로 한다)
    const late = id === 'main' ? takeNotes([...notes.keys()].filter(k => delivered.has(k))) : []
    const withLate = late.length === 0 ? undefined : { content: [...(e.content ?? []), ...late.map(t => ({ type: 'text', text: `\n\n${t}` }))] }
    if (a === undefined || (id !== 'main' && a.endedAt !== null)) return withLate
    const name = toolName(tool)
    const isError = e.isError === true
    const file = !isError && EDIT_TOOLS.has(tool) ? fileOf(input) : null
    const isCheck = tool === 'bash' && isCheckCommand(input)
    patch(id, x => ({
      ...x, activity: 'think', errors: (x.errors ?? 0) + (isError ? 1 : 0),
      isCheckFailed: isCheck ? isError : x.isCheckFailed,
      ...(id === 'main' ? {} : {
        files: file === null || (x.files ?? []).includes(file) ? x.files : [...(x.files ?? []), file].slice(-50),
        checks: isCheck ? [...(x.checks ?? []), checkRunOf(input, isError, text)].slice(-3) : x.checks,
        errLines: isError ? [...(x.errLines ?? []), errLineOf(name, text)].slice(-3) : x.errLines,
      }),
    }))
    if (file !== null) {
      // 끝낸 일의 파일을 곧 다른 사람이 고치면 후속 수정, BOSS가 고치면 재작업
      saveHr(x => followUp(x, file, a.nick, now()))
      if (id === 'main') saveHr(x => rework(x, file, now()).book)
    }
    if (isError) {
      const o = oopsOf(a.nick, name, text, now())
      patch(id, x => ({ ...x, say: o.bubble }))
      say(o.line)
      if (a.dept !== undefined) saveHr(x => learn(x, a.dept as Dept, name, text, now()))
    }
    return withLate
  })

  pi.on('message_end', async (e: any, ctx: Ctx) => {
    const m = e.message
    if (m?.role !== 'assistant') return
    const id = ctx.agent?.kind === 'sub' ? ctx.agent.id : 'main'
    const used = tokensOfUsage(m.usage, typeof m.model === 'string' ? m.model : undefined)
    if (used === null) return
    patch(id, x => (x.endedAt !== null && id !== 'main' ? x : { ...x, tokens: addTokens(x.tokens, used), ...(typeof m.model === 'string' ? { model: m.model } : {}) }))
    if (id !== 'main') checkBudget(ctx)
  })

  // 서브에이전트가 일을 끝냈다(이어서 돌 일이 없을 때): 마지막 답을 보고로 평가·결재
  pi.on('agent_end', async (e: any, ctx: Ctx) => {
    if (ctx.agent?.kind !== 'sub' || e.willContinue === true) return
    const a = agents.get(ctx.agent.id)
    if (a === undefined) return
    const last = [...(e.messages ?? [])].reverse().find((m: any) => m?.role === 'assistant')
    const report = last === undefined ? '' : textOfContent(last.content)
    const p = papers.get(a.id)
    if (p !== undefined) papers.set(a.id, { ...p, report: report.slice(0, 8000) })
    appraise(ctx, a, last !== undefined && last.stopReason !== 'error' && last.stopReason !== 'aborted')
  })
}
