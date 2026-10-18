// 사무실 화면. 패널 목록 줄과 사내 메신저 줄을 만들고, 그려 둔 평면도를 프레임마다 다시 칠한다.
// JSX는 register.tsx가 짠다. 여기에는 무엇을 보일지와 평면도를 언제 칠할지만 둔다.
import type { EngineInterface } from 'claude-code'

import type { HrBook, OfficeActivity, OfficeAgent, Utterance } from '../types'
import { DEPT_INFO, leadOf, rankOf } from './hr'
import { isSpeaking, lineText } from './speech'
import { ERROR_STREAK, isOvertime, REPEAT_STREAK } from './watch'
import { encodeCells, isMeeting, koNick, Office, seated, shortType } from './scene'
import type { Layout } from './scene'
import { syncStatus } from './flow'
import { tokenText, totalOf } from './tokens'
import { agentsOf, hrOf, leadsOf } from './store'

export const RASTER = 'office'
/** 평면도 아래에 보이는 메신저 줄 수 */
export const FEED_SHOWN = 5
const FEED_COLOR: Record<Utterance['kind'], string | undefined> = { order: 'cyan', report: 'green', message: 'magenta', self: undefined, error: 'red', approval: 'yellow', hr: 'blue' }

const STATUS_WORD: Record<OfficeActivity, string> = {
  think: '생각 중', type: '작성 중', read: '자료실', bash: '서버실', web: '웹·MCP',
  spawn: '위임 중', idle: '휴식', done: '퇴근', failed: '실패',
}

/** '곰과', '보스와': 받침이 있으면 과 */
const withGwa = (word: string): string => {
  const last = word.charCodeAt(word.length - 1)
  return `${word}${last >= 0xac00 && last <= 0xd7a3 && (last - 0xac00) % 28 !== 0 ? '과' : '와'}`
}

/** 도구별 같은 실수 연속 횟수 중 가장 큰 것 */
const streakMax = (a: OfficeAgent): number => Math.max(0, ...Object.values(a.errStreaks ?? {}).map(s => s.count))

export type Row = { key: string; text: string; isOff: boolean; isBad: boolean }

/** 패널 목록: 앉은 순서대로 10명, 한 사람에 한 줄(누구·어디서 무엇을·말풍선·도구·근태·걸린 시간·맡은 일) */
export function rowsOf(agents: readonly OfficeAgent[], b: HrBook, now: number): Row[] {
  return seated(agents).slice(0, 10).map(a => {
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
    const used = totalOf(a.tokens) > 0 ? ` · 토큰 ${tokenText(totalOf(a.tokens))}` : ''
    const signs = [
      streakMax(a) >= ERROR_STREAK ? `같은 실수 ${streakMax(a)}연속` : null,
      (a.callStreak?.count ?? 0) >= REPEAT_STREAK ? '제자리걸음' : null,
      isOvertime(a.startedAt, a.endedAt, now) && a.id !== 'main' ? '야근' : null,
    ].filter(x => x !== null).map(x => ` · ${x}`).join('')
    const talk = isSpeaking(a.say, now) ? ` · "${a.say.text}"` : ''
    return { key: `row-${a.id}`, text: `${a.nick} ${who} · ${where}${talk} · 도구 ${a.tools}회${used}${errs}${signs} · ${mins}분 · ${a.description || '-'}`, isOff: a.endedAt !== null, isBad: a.activity === 'failed' }
  })
}

/** 사내 메신저: 최근 줄을 종류별 색으로 */
export const feedRowsOf = (feed: readonly Utterance[], now: number) =>
  feed.slice(-FEED_SHOWN).map((u, i) => ({ key: `feed-${i}`, text: lineText(u, now), color: FEED_COLOR[u.kind] }))

export const FRAME_MS = 200
let frame = 0
// 지금 그려져 있는 사무실(패널 id → 그 자리의 사무실). 사람들의 걸음은 자리마다 따로 간다.
const offices = new Map<string, Office>()
let denies = 0
/** 사무실 패널을 그린 적이 있는지(터미널·데스크톱 모두: 5초마다 다시 그린다) */
let isPaneShown = false

export const markPaneShown = () => {
  isPaneShown = true
}
/** 그 자리에 평면도를 그리지 않는다(데스크톱처럼 평면도가 없는 화면) */
export const dropOffice = (requestId: string) => {
  offices.delete(requestId)
}

/** 그 자리의 사무실(폭이 바뀌었으면 새로 짓는다) */
export function officeAt(requestId: string, layout: Layout): Office {
  const had = offices.get(requestId)
  if (had !== undefined && had.layout.columns === layout.columns) return had
  const office = new Office(layout)
  offices.set(requestId, office)
  return office
}

/** 평면도 한 장을 칸으로 칠한다(목록 줄과 같은 사람들·같은 시각으로) */
export const cellsOf = (office: Office, agents: readonly OfficeAgent[], now: number, b: HrBook): string =>
  encodeCells(office.draw(agents, frame, now, leadsOf(b)))

export async function tick($: EngineInterface) {
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
