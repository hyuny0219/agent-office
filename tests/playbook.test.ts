// 테스트: 부서 지침.
import { expect, test } from 'claude-code/testing'

import type { JobRecord } from '../types'
import { briefOf, emptyBook, hire, migrate } from '../core/hr'
import { textOf } from '../core/table'
import { adopt, dropRule, effectLine, effectOf, playbookBlocks, playbookLines, proposalsOf, statsOf } from '../core/playbook'

test('부서 지침: 반복되는 흠으로 후보를 내고, 채택하면 업무 지시에 붙으며, 적용 전후 성적을 견주고, 빼고 저장해도 남는다', () => {
  const rec = (job: number, over: Partial<JobRecord> = {}): JobRecord => ({ nick: 'BEAR', dept: 'dev', job, description: `일 ${job}`, startedAt: job * 10, endedAt: job * 10 + 5, outcome: 'done', score: 10, errors: 0, isCheckFailed: false, isReworked: false, alarms: 0, ...over })
  let b = hire(emptyBook(), 'BEAR', 'dev', 'builder', 0).book
  // 4건이면 아직 후보가 없다
  b = { ...b, log: [1, 2, 3, 4].map(j => rec(j, { isCheckFailed: true })) }
  expect(proposalsOf(b, 'dev', 0)).toEqual([])
  // 결재 3건 중 반려 2건은 아직 적어 반려 후보가 없고, 4건이 되면 나온다
  const few = { ...b, log: [rec(6, { approval: 'rejected' }), rec(5, { approval: 'rejected', isCheckFailed: true }), rec(4, { approval: 'approved' }), rec(3), rec(2, { isCheckFailed: true }), rec(1)] }
  expect(proposalsOf(few, 'dev', 0).map(p => p.key)).toEqual(['check'])
  // 5건 중 1건(20%)만으로는 후보를 내지 않는다(적어도 2건)
  expect(proposalsOf({ ...b, log: [rec(5, { isReworked: true }), rec(4), rec(3), rec(2), rec(1)] }, 'dev', 0)).toEqual([])
  // 6건 중 테스트 실패 완료 2건(33%), 반려 2/4(50%): 두 지침 후보
  b = { ...b, log: [rec(6, { approval: 'rejected' }), rec(5, { approval: 'rejected', isCheckFailed: true }), rec(4, { approval: 'approved' }), rec(3, { approval: 'approved' }), rec(2, { isCheckFailed: true }), rec(1)] }
  const props = proposalsOf(b, 'dev', 0)
  expect(props.map(p => p.key)).toEqual(['check', 'report'])
  expect(props[0]?.why).toBe('최근 6건 중 테스트·빌드 실패한 채 끝냄 33%')
  expect(statsOf(b.log).rejectRate).toBe(0.5)
  // 되풀이한 실수(3회 이상, 피하는 법이 있는 것)도 후보
  const withLesson = { ...b, lessons: { dev: [{ tool: 'Edit', pattern: 'String to replace not found in file.', count: 3, lastAt: 1 }] } }
  expect(proposalsOf(withLesson, 'dev', 0).map(p => p.key)).toContain('lesson:Edit|String to replace not found in file.')
  // 교육 효과 측정에서 효과 없다고 빼 둔 실수는 지침 후보로도 다시 나오지 않는다
  const muted = { ...withLesson, trials: { 'Edit|String to replace not found in file.': { memo: 10, memoHits: 6, control: 5, controlHits: 3, ineffectiveAt: 0 } } } as never
  expect(proposalsOf(muted, 'dev', 1).map(p => p.key)).not.toContain('lesson:Edit|String to replace not found in file.')
  // 채택: 지침에 더하고 적용 전 성적을 남기며, 같은 후보는 다시 나오지 않는다
  const adopted = adopt(b, 'dev', [props[0]!], 100)
  expect(adopted.playbooks?.dev?.rules.map(r => r.key)).toEqual(['check'])
  expect(adopted.playbooks?.dev?.before?.jobs).toBe(6)
  expect(proposalsOf(adopted, 'dev', 0).map(p => p.key)).toEqual(['report'])
  // 같은 열쇠는 다시 들어가지 않고, 8개가 차면 더 들어가지 않는다
  expect(adopt(adopted, 'dev', [props[0]!], 101)).toBe(adopted)
  const full = adopt(b, 'dev', Array.from({ length: 9 }, (_, i) => ({ key: `k${i}`, text: `지침 ${i}`, why: '' })), 100)
  expect(full.playbooks?.dev?.rules.map(r => r.key)).toEqual(['k0', 'k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'k7'])
  expect(proposalsOf(full, 'dev', 0).length > 0 && textOf(playbookBlocks(full, 0))).toContain('지침이 8개로 찼습니다')
  // 비교군에는 실수에서 온 지침을 빼고, 지침에 있는 피하는 법은 실수 줄에서 다시 쓰지 않는다
  const mixed = adopt(withLesson, 'dev', proposalsOf(withLesson, 'dev', 0), 100)
  expect(playbookLines(mixed, 'dev')).toContain('Edit 전에 바꿀 부분을 Read로 다시 읽어 원문을 그대로 옮긴다')
  expect(playbookLines(mixed, 'dev', true)).not.toContain('Edit 전에 바꿀 부분을 Read로 다시 읽어 원문을 그대로 옮긴다')
  const memo = briefOf(mixed, mixed.employees[0]!, 100, mixed.lessons.dev) ?? ''
  expect(memo.split('Edit 전에 바꿀 부분을 Read로 다시 읽어').length - 1).toBe(1)
  // 그 부서 업무 지시에 붙는다
  expect(briefOf(adopted, adopted.employees[0]!, 100) ?? '').toContain('개발팀 지침(대표가 승인함):\n- 끝내기 전에 테스트·빌드를 돌리고')
  // 적용 뒤 업무가 없으면 비교 없음, 생기면 전후 비교
  expect(effectOf(adopted, 'dev')).toBeNull()
  // 채택한 뒤에 시작한 일만 적용 뒤로 센다
  const later = { ...adopted, log: [rec(9, { startedAt: 90, endedAt: 300, score: 1 }), rec(8, { startedAt: 160, endedAt: 200, score: 13 }), rec(7, { startedAt: 120, endedAt: 150, score: 13 }), ...adopted.log] }
  const e = effectOf(later, 'dev')!
  expect([e.after.jobs, e.after.checkFailRate, e.after.avgScore]).toEqual([2, 0, 13])
  expect(effectLine(e)).toContain('평균 평가 10.0 → 13.0 · 테스트 실패 완료 33% → 0%')
  expect(effectLine(e)).toContain('적용 뒤 2건, 아직 적음')
  // 화면: 지침·전후 비교·후보가 표로
  const shown = textOf(playbookBlocks(later, 0))
  expect(shown).toContain('■ 개발팀')
  expect(shown).toContain('전후 비교: 평균 평가 10.0 → 13.0')
  expect(shown).toContain('(마지막 채택 기준)')
  expect(shown).toContain('/office playbook 개발팀 adopt')
  // 저장했다 읽어도 남고, 이상한 값은 버린다
  const back = migrate(JSON.parse(JSON.stringify({ ...later, playbooks: { ...later.playbooks, qa: { rules: [{ key: 1 }] }, nope: { rules: [] } } })))
  expect(back?.playbooks?.dev?.rules[0]?.key).toBe('check')
  expect(back?.playbooks?.dev?.before?.jobs).toBe(6)
  expect(back?.playbooks).not.toHaveProperty('qa')
  // 빼면 없어진다
  expect(dropRule(later, 'dev', 1).playbooks?.dev).toBeUndefined()
  expect(dropRule(later, 'dev', 5)).toBe(later)
})
