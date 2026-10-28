// 사무실 목록 줄과 사내 메신저 줄: 누가 어디서 무엇을 하는지 한 줄씩, 화면 폭에 맞춰 줄인다. 엔진과 무관하다.
import type { HrBook, OfficeActivity, OfficeAgent, Utterance } from '../types'
import { DEPT_INFO, leadOf, rankOf } from './hr'
import { isSpeaking, lineText } from './speech'
import { ERROR_STREAK, isOvertime, REPEAT_STREAK } from './watch'
import { isMeeting, koNick, seated, shortType } from './scene'
import { costText, modelLabel, totalOf, useText } from './tokens'
import { widthOf } from './table'

/** 평면도 아래에 보이는 메신저 줄 수 */
export const FEED_SHOWN = 5
export const FEED_COLOR: Record<Utterance['kind'], string | undefined> = { order: 'cyan', report: 'green', message: 'magenta', self: undefined, error: 'red', approval: 'yellow', hr: 'blue' }

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

/** nick: 누르면 그 직원의 인사카드(BOSS와 아직 인사 기록에 없는 사람은 null) */
export type Row = { key: string; text: string; isOff: boolean; isBad: boolean; nick: string | null }

/** 맡은 일 설명에 적어도 남겨 둘 칸(줄이 길면 끝이 잘린다) */
const DESC_KEEP = 16

/**
 * 한 줄의 칸들. 줄이 폭을 넘으면 덜 중요한 것부터 짧게 하거나 뺀다:
 * 말풍선 인용 → 도구 수 → 걸린 시간 → 토큰(비용만 남김) → 한글 별명 → 오류 수 → 비용 → 모델.
 * 누구·어디서·근태 경고·맡은 일은 늘 남긴다.
 */
type Part = { key: string; full: string; short?: string }
const SHRINK: { key: string; to: 'short' | 'drop' }[] = [
  { key: 'talk', to: 'drop' }, { key: 'tools', to: 'drop' }, { key: 'mins', to: 'drop' }, { key: 'used', to: 'short' },
  { key: 'who', to: 'short' }, { key: 'errs', to: 'drop' }, { key: 'used', to: 'drop' }, { key: 'model', to: 'drop' },
]

/** 칸들을 폭에 맞춘다(맡은 일은 맨 끝이라 남은 칸만큼 보이고 나머지는 화면이 자른다) */
export function fitParts(parts: readonly Part[], desc: string, columns: number): string {
  const state = new Map(parts.map(p => [p.key, p.full]))
  const join = () => [...parts.map(p => state.get(p.key) ?? ''), desc].filter(x => x !== '').join(' · ')
  const room = columns - Math.min(widthOf(desc), DESC_KEEP)
  for (const step of SHRINK) {
    if (widthOf(join()) - widthOf(desc) <= room) break
    const part = parts.find(p => p.key === step.key)
    if (part === undefined || state.get(step.key) === '') continue
    state.set(step.key, step.to === 'drop' ? '' : (part.short ?? part.full))
  }
  return join()
}

/** 패널 목록: 앉은 순서대로 10명, 한 사람에 한 줄(누구·어디서 무엇을·모델·말풍선·도구·근태·걸린 시간·맡은 일), 폭에 맞춰 줄인다 */
export function rowsOf(agents: readonly OfficeAgent[], b: HrBook, now: number, columns = Infinity): Row[] {
  // 한 사람은 한 줄: 사무실 기록은 맡은 일(에이전트 한 번)마다 남으니, 끝난 일은 그 사람이 일하는 중이거나 더 최근 일이 있으면 숨긴다
  // (일하는 중인 일은 다 보인다: 같은 사람이 두 일을 하고 있으면 평면도처럼 둘 다)
  const seen = new Set<string>()
  const people = seated(agents).filter(a => {
    if (a.endedAt === null) {
      seen.add(a.nick)
      return true
    }
    if (seen.has(a.nick)) return false
    seen.add(a.nick)
    return true
  })
  return people.slice(0, 10).map(a => {
    const emp = b.employees.find(x => x.nick === a.nick)
    const isLead = a.dept !== undefined && leadOf(b, a.dept)?.nick === a.nick
    const title = a.id === 'main' ? '대표'
      : `${emp === undefined ? '사원' : rankOf(emp.xp).ko}${isLead ? '·팀장' : ''} (${a.dept === undefined ? shortType(a.type) : DEPT_INFO[a.dept].ko})`
    const where = isMeeting(a, now) ? `회의실${a.meetWith ? `: ${withGwa(koNick(a.meetWith))} 대화` : ''}`
      : a.activity === 'type' || a.activity === 'web' || a.activity === 'read' || a.activity === 'bash' ? `${STATUS_WORD[a.activity]} ${a.tool ?? ''}`.trim()
      : STATUS_WORD[a.activity]
    const mins = Math.floor(((a.endedAt ?? now) - a.startedAt) / 60_000)
    const hasTokens = a.tokens !== undefined && totalOf(a.tokens) > 0
    const signs = [
      streakMax(a) >= ERROR_STREAK ? `같은 실수 ${streakMax(a)}연속` : null,
      (a.callStreak?.count ?? 0) >= REPEAT_STREAK ? '제자리걸음' : null,
      isOvertime(a.startedAt, a.endedAt, now) && a.id !== 'main' ? '야근' : null,
    ].filter(x => x !== null).join(' · ')
    const parts: Part[] = [
      { key: 'who', full: `${a.nick} ${koNick(a.nick)} ${title}`, short: `${a.nick} ${title}` },
      { key: 'where', full: where },
      { key: 'talk', full: isSpeaking(a.say, now) ? `"${a.say.text}"` : '' },
      // 첫 답이 오기 전에는 띄울 때 받은 이름이다('inherit'는 모델 이름이 아니다)
      { key: 'model', full: a.model === null || a.model === '' || a.model === 'inherit' ? '' : modelLabel(a.model) },
      { key: 'tools', full: `도구 ${a.tools}회` },
      { key: 'used', full: hasTokens && a.tokens !== undefined ? `토큰 ${useText(a.tokens)}` : '', short: hasTokens && a.tokens !== undefined && a.tokens.unpriced < totalOf(a.tokens) ? costText(a.tokens) : '' },
      { key: 'errs', full: a.errors ? `오류 ${a.errors}` : '' },
      { key: 'signs', full: signs },
      { key: 'mins', full: `${mins}분` },
    ]
    return { key: `row-${a.id}`, text: fitParts(parts, a.description || '-', columns), isOff: a.endedAt !== null, isBad: a.activity === 'failed', nick: a.id === 'main' || emp === undefined ? null : a.nick }
  })
}

/** 사내 메신저: 최근 줄을 종류별 색으로 */
export const feedRowsOf = (feed: readonly Utterance[], now: number) =>
  feed.slice(-FEED_SHOWN).map((u, i) => ({ key: `feed-${i}`, text: lineText(u, now), color: FEED_COLOR[u.kind] }))

