// 근태. 일하는 모습에서 이상 징후를 찾는다: 같은 오류를 연달아 내거나(헛손질), 같은 도구를 같은 입력으로
// 되풀이하거나(제자리걸음), 오래 붙잡고 있는(야근) 직원. 찾으면 사용자에게 토스트로 알리고, 코칭이 켜져 있으면
// 그 직원이 도구 결과 뒤에 읽는 짧은 알림을 붙인다. 순수 함수만 둔다.
import type { Streak } from '../types'
import { patternOf, tipOf } from './hr'

/** 같은 오류가 이만큼 연달아 나면 알린다(그 뒤로는 이 배수마다) */
export const ERROR_STREAK = 3
/** 같은 도구·같은 입력을 이만큼 연달아 부르면 알린다(그 뒤로는 이 배수마다) */
export const REPEAT_STREAK = 4
/** 이만큼 오래 일하면 야근 */
export const OVERTIME_MS = 20 * 60_000

/** 같은 열쇠면 이어 세고, 다르면 새로 센다 */
export const stepOf = (prev: Streak | undefined, key: string): Streak =>
  prev?.key === key ? { key, count: prev.count + 1 } : { key, count: 1 }

/** 알릴 차례인가: 문턱에 닿았을 때와 그 배수마다 한 번씩 */
export const isAlarm = (s: Streak | undefined, threshold: number): boolean =>
  s !== undefined && s.count >= threshold && s.count % threshold === 0

const hash = (s: string): string => {
  let h = 7
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h.toString(36)
}

// 호출마다 달라지는 겉봉 칸(입력이 아니다)
const ENVELOPE = new Set(['tool', 'agentId', 'tool_use_id', 'consent', 'requestMeta'])

/** 상태를 묻는 도구는 같은 입력으로 되풀이하는 게 정상이다(기다리며 다시 묻는다) */
export const isPolling = (tool: string): boolean => /^(Task\w*|Monitor|ListAgents|ScheduleWakeup)$/.test(tool)

/** 도구와 입력으로 만든 열쇠: 같은 호출을 되풀이하는지 본다 */
export function callKeyOf(e: { tool: string } & object): string {
  const input = Object.entries(e).filter(([k]) => !ENVELOPE.has(k)).sort(([a], [b]) => (a < b ? -1 : 1))
  return `${e.tool}|${hash(JSON.stringify(input))}`
}

/**
 * 오류의 열쇠: 같은 도구·같은 문구(경로·숫자를 지운)면 같은 실수.
 * Bash는 첫 줄이 늘 "Exit code N"이라 그 줄은 건너뛰고, 명령 이름까지 넣는다(grep 일치 없음과 테스트 실패는 다른 실수다).
 */
export function errorKeyOf(tool: string, text: string, e: object = {}): string {
  if (tool !== 'Bash') return `${tool}|${patternOf(text)}`
  const { command } = e as { command?: unknown }
  const head = typeof command === 'string' ? (command.trim().split(/\s+/).find(w => !w.includes('=')) ?? '') : ''
  const body = text.split('\n').filter(l => !/^\s*exit code \d+\s*$/i.test(l)).join('\n')
  return `${tool}|${head === '' ? '' : `${head}: `}${patternOf(body)}`
}

const patternIn = (key: string): string => key.slice(key.indexOf('|') + 1)

/** 같은 실수를 연달아 낼 때 사용자에게 보일 토스트 */
export const errorToast = (nick: string, tool: string, s: Streak): string =>
  `${nick}가 같은 실수를 ${s.count}번 연달아 하고 있습니다: ${tool} "${patternIn(s.key)}"`

/** 같은 호출을 되풀이할 때 사용자에게 보일 토스트 */
export const repeatToast = (nick: string, tool: string, s: Streak): string =>
  `${nick}가 같은 ${tool}를 같은 입력으로 ${s.count}번 연달아 부르고 있습니다(제자리걸음)`

/** 그 직원이 도구 결과 뒤에 읽는 알림(짧게): 같은 방법을 그만두고 다른 길을 찾거나 보고하게 한다 */
export function nudgeOf(kind: 'error' | 'repeat', tool: string, s: Streak): string {
  const head = '[사내 근태 알림 · agent-office]'
  if (kind === 'repeat') {
    return `${head} 같은 ${tool} 호출을 같은 입력으로 ${s.count}번 연달아 했습니다. 결과는 바뀌지 않습니다. ` +
      '이미 얻은 결과로 다음 단계로 넘어가거나, 막혔다면 지금까지 한 일과 막힌 곳을 보고하고 끝내세요.'
  }
  const pattern = patternIn(s.key)
  const tip = tipOf(pattern)
  return `${head} 같은 오류가 ${s.count}번 연달아 났습니다: ${tool} "${pattern}". 같은 방법을 되풀이하지 마세요. ` +
    `${tip === null ? '원인을 다시 살피고' : `${tip}. 그래도 안 되면`} 다른 방법을 찾거나, 막혔다면 지금까지 한 일과 막힌 곳을 보고하고 끝내세요.`
}

/** 야근 중인가(일하는 중이고 오래됐다) */
export const isOvertime = (startedAt: number, endedAt: number | null, now: number): boolean =>
  endedAt === null && now - startedAt >= OVERTIME_MS
