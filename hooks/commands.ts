// /office 명령. 결재·보고서·인사 기록·켜고 끄기를 글로 답한다. 인자가 없으면 null(패널을 연다).
import type { EngineInterface } from 'claude-code'

import { APPROVER_MODEL, REJECT_PENALTY } from './approval'
import { cardOf, findEmployee, reportOf, rosterText } from './report'
import type { Period } from './report'
import { IDLE_JOBS, IDLE_MS, RETIRE_AVG, RETIRE_JOBS } from './org'
import { CONTROL_EVERY } from './trial'
import { agentsOf, hrOf, saveHr } from './store'
import { budgetLines, deptNamed, dollarsOf } from './budget'
import { usdText } from './tokens'
import { DEPT_INFO, DEPTS } from './hr'

export const COMMAND = {
  name: 'office',
  description: '에이전트 사무실 평면도 보기. budget [<부서> <달러>|<부서> off]: 부서별 하루 비용 한도, approval on|off: 보고·계획 결재 켜고 끄기, reorg on|off: 조직 개편(권고사직·계약 종료) 켜고 끄기, report [today|week]: 일간·주간 보고, hr: 인사 기록(부서·직급·연봉·평가), hr <별칭>: 인사카드, hr on|off: 업무 지시 인사 메모 켜고 끄기, hr ab on|off: 교육 효과 측정(비교군) 켜고 끄기',
  argumentHint: '[budget [<부서> <달러>|<부서> off] | approval on|off | reorg on|off | report [today|week] | hr [<별칭>|on|off|ab on|off]]',
}

/** 글로 답할 하위 명령이면 그 답, 패널을 열 명령이면 null */
export async function answer($: EngineInterface, args: string): Promise<string | null> {
  const [sub, arg, arg2] = args.trim().split(/\s+/)
  if (sub === 'approval') {
    if (arg !== 'on' && arg !== 'off') return `결재: ${(await hrOf($)).isApproving ? '켜짐' : '꺼짐'}. 쓰는 법: /office approval on|off`
    await saveHr($, b => ({ ...b, isApproving: arg === 'on' }))
    return arg === 'on'
      ? `끝낸 일의 보고를 팀장이 결재하고(과장 이상·짧은 일은 전결, 반려 -${REJECT_PENALTY}), 확정한 계획은 기획팀장이 검토합니다. 결재마다 ${APPROVER_MODEL}를 한 번 부릅니다.`
      : '결재를 멈춥니다. 보고와 계획은 결재 없이 넘어갑니다.'
  }
  if (sub === 'reorg') {
    if (arg !== 'on' && arg !== 'off') return `조직 개편: ${(await hrOf($)).isReorganizing ? '켜짐' : '꺼짐'}. 쓰는 법: /office reorg on|off`
    await saveHr($, b => ({ ...b, isReorganizing: arg === 'on' }))
    return arg === 'on'
      ? `조직 개편을 합니다: 업무 ${RETIRE_JOBS}건 이상에 최근 평균 평가가 ${RETIRE_AVG} 아래면 권고사직, 업무 ${IDLE_JOBS}건 이하로 ${IDLE_MS / (24 * 60 * 60_000)}일 넘게 일이 없으면 계약 종료. 떠난 직원의 인사카드는 남습니다.`
      : '조직 개편을 멈춥니다. 직원을 내보내지 않습니다.'
  }
  if (sub === 'budget') {
    const now = await $.clock.now()
    if (arg === undefined || arg === '') {
      const lines = budgetLines(await hrOf($), await agentsOf($), now)
      return lines.length > 0 ? lines.join('\n') : '부서 예산이 없습니다. 쓰는 법: /office budget <부서> <달러> (예: /office budget 개발팀 5), 없애려면 /office budget <부서> off'
    }
    const dept = deptNamed(arg)
    if (dept === null) return `${arg}라는 부서가 없습니다. 부서: ${DEPTS.map(d => DEPT_INFO[d].ko).join(', ')}`
    if (arg2?.toLowerCase() === 'off') {
      await saveHr($, b => {
        const { [dept]: _gone, ...budgets } = b.budgets
        const { [dept]: _told, ...budgetNotices } = b.budgetNotices
        return { ...b, budgets, budgetNotices }
      })
      return `${DEPT_INFO[dept].ko} 예산을 없앱니다.`
    }
    const dollars = dollarsOf(arg2 ?? '')
    if (dollars === null) return '쓰는 법: /office budget <부서> <달러>|off (예: /office budget 개발팀 5)'
    // 새 한도로는 다시 알릴 수 있게 지난 알림을 지운다
    await saveHr($, b => {
      const { [dept]: _was, ...budgetNotices } = b.budgetNotices
      return { ...b, budgets: { ...b.budgets, [dept]: dollars }, budgetNotices }
    })
    return `${DEPT_INFO[dept].ko} 하루 예산을 ${usdText(dollars)}로 정합니다. 최근 24시간 비용(모델 API 정가로 어림)이 넘으면 하루 한 번 알립니다.`
  }
  if (sub === 'report') {
    const want = arg?.toLowerCase()
    if (want !== undefined && want !== 'today' && want !== 'week') return '쓰는 법: /office report [today|week] (today: 최근 24시간, week: 최근 7일)'
    const period: Period = want ?? 'today'
    return reportOf(await hrOf($), period, await $.clock.now(), await agentsOf($))
  }
  if (sub !== 'hr') return null
  if (arg === 'ab') {
    if (arg2 !== 'on' && arg2 !== 'off') return '쓰는 법: /office hr ab on|off (교육 효과 측정 켜기·끄기)'
    await saveHr($, b => ({ ...b, isTrialing: arg2 === 'on' }))
    return arg2 === 'on'
      ? `교육 효과를 잽니다: 실수 목록을 붙일 업무 ${CONTROL_EVERY}건에 한 건은 빼고 보내(비교군), 재발률을 비교합니다.`
      : '교육 효과 측정을 멈춥니다. 실수 목록은 모든 업무에 붙입니다(쌓인 측정 기록은 남깁니다).'
  }
  if (arg === 'on' || arg === 'off') {
    await saveHr($, b => ({ ...b, isCoaching: arg === 'on' }))
    return arg === 'on' ? '업무 지시에 인사 메모(담당·지난 기록·부서가 반복한 실수·평가 기준)를 붙입니다.' : '업무 지시에 인사 메모를 붙이지 않습니다. 평가·연봉은 계속 기록합니다.'
  }
  const b = await hrOf($)
  if (arg !== undefined && arg !== '') {
    const who = findEmployee(b, arg)
    return who === undefined ? `${arg}라는 직원이 없습니다. /office hr로 명부를 보세요.` : cardOf(b, who, await $.clock.now())
  }
  return rosterText(b, await $.clock.now())
}
