// 패널 메뉴. 누르면 그 /office 하위 명령의 답을 메인 채팅창에 흐린 알림 줄로 남긴다(모델은 읽지 않는다).
import type { EngineInterface } from 'claude-code'

import type { HrBook } from '../types'
import { answer } from './commands'
import { hrOf } from './store'

/** 패널 위의 메뉴: 단축키 1~5 */
export const MENU = [
  { key: 'menu-hr', hotkey: '1', label: '인사 명부', args: 'hr' },
  { key: 'menu-today', hotkey: '2', label: '일간 보고', args: 'report today' },
  { key: 'menu-week', hotkey: '3', label: '주간 보고', args: 'report week' },
  { key: 'menu-budget', hotkey: '4', label: '예산', args: 'budget' },
] as const
export const SETTINGS = { key: 'menu-settings', hotkey: '5' } as const

/** 설정에서 켜고 끄는 것: 버튼 이름과 /office 하위 명령 */
export const TOGGLES = [
  { key: 'set-approval', label: '결재', isOn: (b: HrBook) => b.isApproving, args: 'approval' },
  { key: 'set-reorg', label: '조직 개편', isOn: (b: HrBook) => b.isReorganizing, args: 'reorg' },
  { key: 'set-coach', label: '인사 메모', isOn: (b: HrBook) => b.isCoaching, args: 'hr' },
  { key: 'set-trial', label: '교육 효과 측정', isOn: (b: HrBook) => b.isTrialing, args: 'hr ab' },
] as const

/** 터미널이 한 줄(로그 한 칸)에 그리는 글자 수 */
const LOG_MAX = 2000

/** 긴 글을 줄 단위로 LOG_MAX 안쪽 덩어리로 나눈다(빈 줄도 그대로, 한 줄이 넘치면 그 줄을 max씩 끊는다) */
export function chunksOf(text: string, max = LOG_MAX): string[] {
  if (text === '') return []
  const lines = text.split('\n').flatMap(l => (l.length <= max ? [l] : Array.from({ length: Math.ceil(l.length / max) }, (_, i) => l.slice(i * max, (i + 1) * max))))
  const out: string[] = []
  let buf: string[] = []
  let size = -1
  for (const line of lines) {
    if (buf.length > 0 && size + 1 + line.length > max) {
      out.push(buf.join('\n'))
      buf = []
      size = -1
    }
    buf.push(line)
    size += 1 + line.length
  }
  if (buf.length > 0) out.push(buf.join('\n'))
  return out
}

/**
 * /office 하위 명령의 답을 메인 채팅창에 흐린 알림 줄로 남긴다(모델은 읽지 않는다). 누름에서 부르므로 던지지 않는다.
 * ($.session.append의 system 줄은 기록에만 남고 터미널에 그려지지 않았고, $.command.run은 이 plugin의 명령 hook을 건너뛴다)
 */
export async function postAnswer($: EngineInterface, args: string) {
  try {
    const text = await answer($, args)
    if (text !== null) for (const part of chunksOf(text)) $.ui.log(part)
  } catch {
    $.ui.toast(`/office ${args}를 보이지 못했습니다`)
  }
}

/** 설정 하나를 뒤집고(/office <설정> on|off), 그 결과 한 줄을 채팅창에 남긴 뒤 패널을 다시 그린다(설정은 상태가 아니라 저장소에 있다) */
export async function flip($: EngineInterface, key: string) {
  const t = TOGGLES.find(x => x.key === key)
  if (t === undefined) return
  try {
    // 그려 둔 값이 아니라 누른 때의 값을 본다
    await postAnswer($, `${t.args} ${t.isOn(await hrOf($)) ? 'off' : 'on'}`)
  } finally {
    $.ui.invalidate('ui.render')
  }
}
