// 사무실 메뉴 화면. 사무실 패널과 따로 여는 패널로, 위의 1~5 메뉴를 고르면 그 내용을 패널 안에 표(마크다운)로 보인다.
// 무엇을 보고 있는지는 상태(menuView)에 둔다. 여기에는 메뉴 목록과 화면별 내용(블록)만 둔다.
import type { EngineInterface } from 'claude-code'

import type { BossRating, HrBook, JobRecord } from '../types'
import { rate } from '../core/hr'
import { rankChangeText } from '../core/answer'
import { budgetBlocks } from '../core/budget'
import { cardBlocks, findEmployee, reportBlocks, rosterBlocks } from '../core/report'
import type { Block } from '../core/table'
import { agentsOf, saveHr } from './store'
import { APPROVER_MODEL } from '../core/approval'

export const MENU_PANE = 'agent-office-menu'
export const MENU_TITLE = '사무실 메뉴'

/** 메뉴: 단축키 1~5. view는 상태에 두는 화면 이름 */
export const MENU = [
  { key: 'menu-hr', hotkey: '1', label: '인사 명부', view: 'hr' },
  { key: 'menu-today', hotkey: '2', label: '일간 보고', view: 'today' },
  { key: 'menu-week', hotkey: '3', label: '주간 보고', view: 'week' },
  { key: 'menu-budget', hotkey: '4', label: '예산', view: 'budget' },
  { key: 'menu-settings', hotkey: '5', label: '설정', view: 'settings' },
] as const

/** 인사카드 화면의 이름: card:<별칭> */
export const cardView = (nick: string): string => `card:${nick}`
export const nickOfView = (view: string): string | null => (view.startsWith('card:') ? view.slice(5) : null)

/** 설정 화면에서 켜고 끄는 것 */
export const TOGGLES = [
  { key: 'set-approval', label: '결재', note: `끝낸 일의 보고·확정한 계획을 결재(결재마다 ${APPROVER_MODEL}를 한 번 부름)`, isOn: (b: HrBook) => b.isApproving, flip: (b: HrBook): HrBook => ({ ...b, isApproving: !b.isApproving }) },
  { key: 'set-reorg', label: '조직 개편', note: '계속 평가가 나쁘면 권고사직, 오래 일이 없으면 계약 종료', isOn: (b: HrBook) => b.isReorganizing, flip: (b: HrBook): HrBook => ({ ...b, isReorganizing: !b.isReorganizing }) },
  { key: 'set-coach', label: '인사 메모', note: '업무 지시에 담당·지난 기록·반복 실수를 붙임', isOn: (b: HrBook) => b.isCoaching, flip: (b: HrBook): HrBook => ({ ...b, isCoaching: !b.isCoaching }) },
  { key: 'set-trial', label: '교육 효과 측정', note: '실수 목록을 몇 건에 한 번 빼고 보내 효과를 잼', isOn: (b: HrBook) => b.isTrialing, flip: (b: HrBook): HrBook => ({ ...b, isTrialing: !b.isTrialing }) },
] as const

/** 설정 하나를 뒤집는다(저장한 값 위에서 뒤집으니 빨리 두 번 눌러도 한 번씩 바뀐다). 설정은 상태가 아니라 저장소에 있어 다시 그리게 한다 */
export async function flip($: EngineInterface, key: string) {
  const t = TOGGLES.find(x => x.key === key)
  if (t === undefined) return
  try {
    await saveHr($, t.flip)
  } finally {
    $.ui.invalidate('ui.render')
  }
}

/** 인사카드에서 평가 버튼을 다는 최근 업무(카드의 최근 업무 표와 같은 다섯 건, 떠난 직원은 없음) */
export const ratableOf = (b: HrBook, nick: string): JobRecord[] =>
  b.employees.some(e => e.nick === nick) ? b.log.filter(r => r.nick === nick).slice(0, 5) : []

/** 대표 평가 버튼: 같은 평가를 다시 누르면 거둔다 */
export async function rateJob($: EngineInterface, nick: string, job: number, rating: BossRating) {
  let moved: ReturnType<typeof rate> | null = null
  await saveHr($, b => {
    const was = b.log.find(r => r.nick === nick && r.job === job)?.bossRating
    moved = rate(b, nick, job, was === rating ? null : rating)
    return moved.book
  })
  const change = rankChangeText(moved)
  if (change !== '') $.ui.toast(`${nick}${change}`)
  $.ui.invalidate('ui.render')
}

/** 그 화면의 내용. 설정 화면은 버튼으로 그리므로 설명만 */
export async function viewBlocks($: EngineInterface, b: HrBook, view: string): Promise<Block[]> {
  const now = await $.clock.now()
  const nick = nickOfView(view)
  if (nick !== null) {
    const who = findEmployee(b, nick)
    return who === undefined ? [{ t: 'line', text: `${nick}라는 직원이 없습니다.` }] : cardBlocks(b, who, now)
  }
  if (view === 'today' || view === 'week') return reportBlocks(b, view, now, await agentsOf($))
  if (view === 'budget') {
    const blocks = budgetBlocks(b, await agentsOf($), now)
    return blocks.length > 0 ? blocks : [{ t: 'title', text: '부서 예산' }, { t: 'line', text: '부서 예산이 없습니다. 정하려면 /office budget <부서> <달러> (예: /office budget 개발팀 5), 없애려면 /office budget <부서> off' }]
  }
  if (view === 'settings') return [{ t: 'title', text: '설정' }, { t: 'line', text: '누르면 바로 켜고 끕니다.' }]
  return rosterBlocks(b, now)
}
