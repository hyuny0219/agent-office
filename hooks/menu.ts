// 패널 메뉴. 누르면 그 내용을 메인 채팅창에 알림으로 남긴다(모델은 읽지 않는다). /office 하위 명령과 같은 글을 쓴다.
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

/**
 * 메인 채팅창에 알림 한 블록을 남긴다(사람만 본다). 남기지 못하면(다른 plugin이 막았거나 plugin이 끼어들 수 없는 세션)
 * 토스트로 같은 내용을 /office 명령으로 보라고 알린다
 */
export async function post($: EngineInterface, text: string, args: string) {
  const r = await $.session.append({ message: { type: 'system', content: [{ type: 'text', text }] } })
    .catch(() => ({ deny: 'refused' }))
  if ('deny' in r && r.deny !== undefined) $.ui.toast(`채팅창에 남기지 못했습니다. /office ${args}로 보세요`)
}

/** /office 하위 명령의 답을 채팅창에 남긴다. 누름에서 부르므로 던지지 않는다 */
export async function postAnswer($: EngineInterface, args: string) {
  try {
    const text = await answer($, args)
    if (text !== null) await post($, text, args)
  } catch {
    $.ui.toast(`/office ${args}를 보이지 못했습니다`)
  }
}

/** 설정 하나를 뒤집고, 그 결과 한 줄을 채팅창에 남긴 뒤 패널을 다시 그린다(설정은 상태가 아니라 저장소에 있다) */
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
