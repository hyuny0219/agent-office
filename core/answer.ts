// /office 명령의 글 답. 결재·보고서·인사 기록·켜고 끄기. 인자가 없으면 null(사무실 화면을 연다).
// 엔진과 무관하다: 인사 기록을 읽고 쓰는 길과 시계는 Desk로 받는다(Claude Code·oh-my-pi가 각자 준다).
import type { HrBook, OfficeAgent } from '../types'

import { APPROVER_MODEL, REJECT_PENALTY } from './approval'
import { cardOf, deptMapBlocks, findEmployee, reportOf, rosterText } from './report'
import type { Period } from './report'
import { IDLE_JOBS, IDLE_MS, RETIRE_AVG, RETIRE_JOBS } from './org'
import { CONTROL_EVERY } from './trial'
import { budgetLines, deptNamed, dollarsOf, unwaive } from './budget'
import { exportFiles } from './archive'
import type { ExportKind } from './archive'
import { adopt, dropRule, markSeen, MAX_RULES, settled, playbookBlocks, proposalsOf, roomOf } from './playbook'
import { textOf } from './table'
import { usdText } from './tokens'
import { BOSS_RATE_POINTS, DEPT_INFO, DEPTS, deptFor, deptOf, isTypeKey, MAX_DEPT_MAP, rate, setDept, typeKey } from './hr'

/** 평가로 직급이 바뀌었으면 한마디 */
export const rankChangeText = (m: { promotedTo: string | null; demotedTo: string | null } | null): string =>
  m === null ? '' : m.promotedTo !== null ? ` (${withRo(m.promotedTo)} 승진)` : m.demotedTo !== null ? ` (${withRo(m.demotedTo)} 강등)` : ''

/** '대리로', '사원으로': 받침이 있으면(ㄹ 받침은 빼고) 으로 */
const withRo = (word: string): string => {
  const c = word.charCodeAt(word.length - 1) - 0xac00
  const jong = c >= 0 && c <= 11171 ? c % 28 : 0
  return `${word}${jong !== 0 && jong !== 8 ? '으로' : '로'}`
}

export const COMMAND = {
  name: 'office',
  description: '에이전트 사무실 평면도 보기. menu: 메뉴 화면(인사 명부·보고서·예산·설정·지침·월별 기록을 표로), export [json|csv] [<폴더>]: 인사 기록 내보내기, dept [<종류> <부서>|<종류> reset]: 에이전트 종류의 부서 배치, playbook [<부서> adopt <n|all>|<부서> drop <n>]: 부서 지침(평가로 만든 개선안을 채택), rate <별칭> good|bad|clear: 최근 끝낸 일에 대표 평가, budget [<부서> <달러>|<부서> off]: 부서별 하루 비용 한도, approval on|off: 보고·계획 결재 켜고 끄기, reorg on|off: 조직 개편(권고사직·계약 종료) 켜고 끄기, report [today|week]: 일간·주간 보고, hr: 인사 기록(부서·직급·연봉·평가), hr <별칭>: 인사카드, hr on|off: 업무 지시 인사 메모 켜고 끄기, hr ab on|off: 교육 효과 측정(비교군) 켜고 끄기',
  argumentHint: '[menu | export [json|csv] [<폴더>] | dept [<종류> <부서>|<종류> reset] | playbook [<부서> adopt <n|all>|<부서> drop <n>] | rate <별칭> good|bad|clear | budget [<부서> <달러>|<부서> off] | approval on|off | reorg on|off | report [today|week] | hr [<별칭>|on|off|ab on|off]]',
}

/** 명령이 인사 기록과 사무실을 읽고 쓰는 길 */
export type Desk = {
  book: () => Promise<HrBook>
  save: (fn: (b: HrBook) => HrBook) => Promise<void>
  agents: () => Promise<readonly OfficeAgent[]>
  now: () => Promise<number>
  /** 내보낼 파일들을 쓴다(dir이 없으면 그 판의 기본 폴더에). 쓴 경로를 돌려준다 */
  write: (files: readonly { name: string; text: string }[], dir: string | null) => Promise<string[]>
}

/** 글로 답할 하위 명령이면 그 답, 화면을 열 명령이면 null */
export async function answerWith(desk: Desk, args: string): Promise<string | null> {
  const [sub, arg, arg2] = args.trim().split(/\s+/)
  if (sub === 'approval') {
    if (arg !== 'on' && arg !== 'off') return `결재: ${(await desk.book()).isApproving ? '켜짐' : '꺼짐'}. 쓰는 법: /office approval on|off`
    await desk.save(b => ({ ...b, isApproving: arg === 'on' }))
    return arg === 'on'
      ? `끝낸 일의 보고를 팀장이 결재하고(과장 이상·짧은 일은 전결, 반려 -${REJECT_PENALTY}), 확정한 계획은 기획팀장이 검토합니다. 결재마다 ${APPROVER_MODEL}를 한 번 부릅니다.`
      : '결재를 멈춥니다. 보고와 계획은 결재 없이 넘어갑니다.'
  }
  if (sub === 'reorg') {
    if (arg !== 'on' && arg !== 'off') return `조직 개편: ${(await desk.book()).isReorganizing ? '켜짐' : '꺼짐'}. 쓰는 법: /office reorg on|off`
    await desk.save(b => ({ ...b, isReorganizing: arg === 'on' }))
    return arg === 'on'
      ? `조직 개편을 합니다: 업무 ${RETIRE_JOBS}건 이상에 최근 평균 평가가 ${RETIRE_AVG} 아래면 권고사직, 업무 ${IDLE_JOBS}건 이하로 ${IDLE_MS / (24 * 60 * 60_000)}일 넘게 일이 없으면 계약 종료. 떠난 직원의 인사카드는 남습니다.`
      : '조직 개편을 멈춥니다. 직원을 내보내지 않습니다.'
  }
  if (sub === 'budget') {
    const now = await desk.now()
    if (arg === undefined || arg === '') {
      const lines = budgetLines(await desk.book(), await desk.agents(), now)
      return lines.length > 0 ? lines.join('\n') : '부서 예산이 없습니다. 쓰는 법: /office budget <부서> <달러> (예: /office budget 개발팀 5), 없애려면 /office budget <부서> off'
    }
    const dept = deptNamed(arg)
    if (dept === null) return `${arg}라는 부서가 없습니다. 부서: ${DEPTS.map(d => DEPT_INFO[d].ko).join(', ')}`
    if (arg2?.toLowerCase() === 'off') {
      await desk.save(b => {
        const { [dept]: _gone, ...budgets } = b.budgets
        const { [dept]: _told, ...budgetNotices } = b.budgetNotices
        return { ...unwaive(b, dept), budgets, budgetNotices }
      })
      return `${DEPT_INFO[dept].ko} 예산을 없앱니다.`
    }
    const dollars = dollarsOf(arg2 ?? '')
    if (dollars === null) return '쓰는 법: /office budget <부서> <달러>|off (예: /office budget 개발팀 5)'
    // 새 한도로는 다시 알리고 다시 물을 수 있게 지난 알림과 "계속"을 지운다
    await desk.save(b => {
      const { [dept]: _was, ...budgetNotices } = b.budgetNotices
      return { ...unwaive(b, dept), budgets: { ...b.budgets, [dept]: dollars }, budgetNotices }
    })
    return `${DEPT_INFO[dept].ko} 하루 예산을 ${usdText(dollars)}로 정합니다. 최근 24시간 비용(모델 API 정가로 어림)이 넘으면 하루 한 번 알리고, 그 부서에 새 일을 맡길 때 계속·이번만·맡기지 않기를 묻습니다.`
  }
  if (sub === 'rate') {
    const use = '쓰는 법: /office rate <별칭> good|bad|clear (그 직원이 가장 최근에 끝낸 일에 대표 평가: 좋음 +' + BOSS_RATE_POINTS + ' · 아쉬움 -' + BOSS_RATE_POINTS + ')'
    const want = arg2?.toLowerCase()
    if (arg === undefined || arg === '' || (want !== 'good' && want !== 'bad' && want !== 'clear')) return use
    const b = await desk.book()
    const who = findEmployee(b, arg)
    if (who === undefined) return `${arg}라는 직원이 없습니다. /office hr로 명부를 보세요.`
    if (!b.employees.some(e => e.nick === who.nick)) return `${who.nick}는 떠난 직원이라 평가할 수 없습니다.`
    const last = b.log.filter(r => r.nick === who.nick).sort((x, y) => y.job - x.job)[0]
    if (last === undefined) return `${who.nick}는 아직 끝낸 일이 없습니다.`
    let moved: ReturnType<typeof rate> | null = null
    await desk.save(x => {
      moved = rate(x, who.nick, last.job, want === 'clear' ? null : want)
      return moved.book
    })
    const said = want === 'clear' ? `${who.nick} "${last.description}"의 대표 평가를 거둡니다.` : `${who.nick} "${last.description}"에 대표 평가 ${want === 'good' ? `좋음(+${BOSS_RATE_POINTS})` : `아쉬움(-${BOSS_RATE_POINTS})`}을 줍니다.`
    return `${said}${rankChangeText(moved)}`
  }
  if (sub === 'playbook') {
    const b = await desk.book()
    if (arg === undefined || arg === '') {
      const at = await desk.now()
      // 후보를 보였으니 사무실 화면의 새 후보 알림 줄을 내린다(바뀐 것이 없으면 저장하지 않는다)
      if (markSeen(b, at) !== b) await desk.save(x => markSeen(x, at))
      return textOf(playbookBlocks(b, at))
    }
    const dept = deptNamed(arg)
    if (dept === null) return `${arg}라는 부서가 없습니다. 부서: ${DEPTS.map(d => DEPT_INFO[d].ko).join(', ')}`
    const [, , action, which] = args.trim().split(/\s+/)
    if (action === 'adopt') {
      const at = await desk.now()
      const props = proposalsOf(b, dept, at)
      const picked = which === 'all' ? props : props.filter((_, i) => String(i + 1) === which)
      if (picked.length === 0) return `채택할 후보가 없습니다. /office playbook으로 ${DEPT_INFO[dept].ko} 후보 번호를 보세요.`
      const room = roomOf(b, dept)
      if (room < picked.length) return `${DEPT_INFO[dept].ko} 지침은 ${MAX_RULES}개까지입니다(남은 자리 ${Math.max(0, room)}). 먼저 /office playbook ${DEPT_INFO[dept].ko} drop <번호>로 빼세요.`
      await desk.save(x => settled(adopt(x, dept, picked, at), dept, at))
      return `${DEPT_INFO[dept].ko} 지침에 ${picked.length}개를 더합니다. 지금부터 그 부서 업무 지시에 붙고, 적용 전 성적(최근 업무)과 비교합니다:\n${picked.map(p => `- ${p.text}`).join('\n')}`
    }
    if (action === 'drop') {
      const n = Number(which)
      const rule = b.playbooks?.[dept]?.rules[n - 1]
      if (rule === undefined) return `${DEPT_INFO[dept].ko}에 ${which ?? ''}번 지침이 없습니다.`
      const at = await desk.now()
      // 뺀 지침이 다시 후보로 드러나도 대표가 방금 한 일이니 새 후보로 알리지 않는다
      await desk.save(x => settled(dropRule(x, dept, n), dept, at))
      return `${DEPT_INFO[dept].ko} 지침에서 뺍니다: ${rule.text}`
    }
    return '쓰는 법: /office playbook [<부서> adopt <후보 번호|all> | <부서> drop <지침 번호>]'
  }
  if (sub === 'dept') {
    const b = await desk.book()
    if (arg === undefined || arg === '') return textOf(deptMapBlocks(b))
    const key = typeKey(arg)
    if (!isTypeKey(key)) return `${arg}는 에이전트 종류 이름으로 쓸 수 없습니다(글자·숫자·._@- 만).`
    const use = `쓰는 법: /office dept <종류> <부서>|reset (부서: ${DEPTS.map(d => DEPT_INFO[d].ko).join(', ')})`
    if (arg2 === undefined || arg2 === '') return `${key}: ${DEPT_INFO[deptFor(b, key)].ko}${b.deptMap?.[key] === undefined ? '(기본)' : ` (기본은 ${DEPT_INFO[deptOf(key)].ko})`}. ${use}`
    const dept = arg2.toLowerCase() === 'reset' ? null : deptNamed(arg2)
    if (dept === null && arg2.toLowerCase() !== 'reset') return `${arg2}라는 부서가 없습니다. ${use}`
    if (dept !== null && b.deptMap?.[key] === undefined && dept !== deptOf(key) && Object.keys(b.deptMap ?? {}).length >= MAX_DEPT_MAP) return `바꾼 배치는 ${MAX_DEPT_MAP}가지 종류까지입니다. 먼저 /office dept <종류> reset으로 되돌리세요.`
    await desk.save(x => setDept(x, key, dept))
    const to = DEPT_INFO[dept ?? deptOf(key)].ko
    return dept === null ? `${key}를 기본 배치(${to})로 되돌립니다.` : `${key}를 ${to}에 배치합니다. 이미 뽑은 직원은 제 부서에 남고, 새로 맡기는 일부터 ${to} 직원이 받습니다.`
  }
  if (sub === 'export') {
    // 꼴을 빼고 폴더만 주면(경로처럼 생긴 것) json으로 본다
    const isPathFirst = arg !== undefined && /^[~./\\]|^[A-Za-z]:[\\/]/.test(arg)
    const want = isPathFirst ? 'json' : (arg ?? 'json').toLowerCase()
    if (want !== 'json' && want !== 'csv') return '쓰는 법: /office export [json|csv] [<폴더>] (json: 인사 기록 통째, csv: 업무 기록과 월별 요약)'
    // 폴더 이름에는 띄어쓰기가 들 수 있다: 원문에서 꼴 다음부터 끝까지(겹친 빈칸도 그대로)
    const rest = args.trim().replace(/^\S+\s*/, '')
    const dir = (isPathFirst ? rest : rest.replace(/^\S+\s*/, '')).trim()
    const files = exportFiles(await desk.book(), want as ExportKind, await desk.now(), d => DEPT_INFO[d].ko)
    try {
      const paths = await desk.write(files, dir === '' ? null : dir)
      return `내보냈습니다:\n${paths.map(p => `- ${p}`).join('\n')}`
    } catch (err) {
      return `내보내지 못했습니다: ${err instanceof Error ? err.message : String(err)}`.split('\n')[0] ?? ''
    }
  }
  if (sub === 'report') {
    const want = arg?.toLowerCase()
    if (want !== undefined && want !== 'today' && want !== 'week') return '쓰는 법: /office report [today|week] (today: 최근 24시간, week: 최근 7일)'
    const period: Period = want ?? 'today'
    return reportOf(await desk.book(), period, await desk.now(), await desk.agents())
  }
  if (sub !== 'hr') return null
  if (arg === 'ab') {
    if (arg2 !== 'on' && arg2 !== 'off') return '쓰는 법: /office hr ab on|off (교육 효과 측정 켜기·끄기)'
    await desk.save(b => ({ ...b, isTrialing: arg2 === 'on' }))
    return arg2 === 'on'
      ? `교육 효과를 잽니다: 실수 목록을 붙일 업무 ${CONTROL_EVERY}건에 한 건은 빼고 보내(비교군), 재발률을 비교합니다.`
      : '교육 효과 측정을 멈춥니다. 실수 목록은 모든 업무에 붙입니다(쌓인 측정 기록은 남깁니다).'
  }
  if (arg === 'on' || arg === 'off') {
    await desk.save(b => ({ ...b, isCoaching: arg === 'on' }))
    return arg === 'on' ? '업무 지시에 인사 메모(담당·지난 기록·부서가 반복한 실수·평가 기준)를 붙입니다.' : '업무 지시에 인사 메모를 붙이지 않습니다. 평가·연봉은 계속 기록합니다.'
  }
  const b = await desk.book()
  if (arg !== undefined && arg !== '') {
    const who = findEmployee(b, arg)
    return who === undefined ? `${arg}라는 직원이 없습니다. /office hr로 명부를 보세요.` : cardOf(b, who, await desk.now())
  }
  return rosterText(b, await desk.now())
}
