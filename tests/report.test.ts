// 테스트: 보고서·인사카드.
import { expect, test } from 'claude-code/testing'

import type { HrBook, JobRecord } from '../types'
import { emptyBook, handOff, hire, migrate, review, rework } from '../core/hr'
import { agoText, cardOf, durationText, findEmployee, jobsIn, reportOf } from '../core/report'

test('보고서·인사카드: 기간 안 일만 모아 부서별 실적·MVP·살펴볼 일을 내고, 재작업은 그 일의 기록에도 적힌다', () => {
  const H = 60 * 60_000
  const now = 10 * 24 * H
  const job = (over: Partial<JobRecord>): JobRecord => ({
    nick: 'BEAR', dept: 'dev', job: 1, description: '빌드', startedAt: now - H, endedAt: now - 30 * 60_000, outcome: 'done',
    score: 13, errors: 0, isCheckFailed: false, isReworked: false, alarms: 0, ...over,
  })
  let b: HrBook = hire(hire(emptyBook(), 'BEAR', 'dev', 'builder', 0).book, 'OWL', 'research', 'Explore', 0).book
  b = review(b, 'BEAR', { isDone: true, isKilled: false, errors: 0 }, now).book
  b = { ...b, log: [
    job({ job: 2, description: '고치기', score: 3, errors: 3, isCheckFailed: true, alarms: 1 }),
    job({ nick: 'OWL', dept: 'research', description: '조사', outcome: 'failed', score: -5, startedAt: now - 3 * H, endedAt: now - 2 * H }),
    job({}),
    // 8일 전: 주간 보고에도 들지 않는다
    job({ description: '옛일', startedAt: now - 8 * 24 * H - H, endedAt: now - 8 * 24 * H }),
  ] }
  expect(jobsIn(b, 'today', now)).toHaveLength(3)
  expect(jobsIn(b, 'week', now)).toHaveLength(3)
  const today = reportOf(b, 'today', now)
  expect(today).toContain('에이전트 사무실 일간 보고 (최근 24시간)')
  expect(today).toContain('업무 3건 · 완료 2 / 실패 1(완료율 67%)')
  expect(today).toContain('근무 2시간')
  expect(today).toContain('개발팀     2        2/0    100%  B(8.0)        3     -     -  테스트 실패 완료 1 · 근태 알림 1')
  expect(today).toContain('조사팀     1        0/1      0%  D(-5.0)       0     -     -\n')
  expect(today).toContain('MVP: BEAR 곰 사원 (2건, 평가 합계 +16)')
  expect(today).toContain('■ 살펴볼 일(2건)')
  expect(today).toMatch(/BEAR\s+고치기\s+C\(\+3\)\s+테스트·빌드 실패한 채 완료 · 근태 알림 1/)
  expect(today).toMatch(/OWL\s+조사\s+D\(-5\)\s+실패/)
  expect(today).not.toContain('옛일')
  expect(reportOf(emptyBook(), 'week', now)).toContain('이 기간에 끝낸 업무가 없습니다.')

  // 재작업은 그 일(같은 직원·같은 순번)의 기록에도 적는다
  b = handOff(b, { agentId: 'x', nick: 'BEAR', files: ['/r/a.ts'], endedAt: now, job: 2 })
  b = rework(b, '/r/a.ts', now + 1000).book
  expect(b.log[0]?.isReworked).toBe(true)
  expect(b.log[0]?.score).toBe(-1)
  expect(b.log[2]?.isReworked).toBe(false)

  expect(findEmployee(b, 'bear')?.nick).toBe('BEAR')
  expect(findEmployee(b, '부엉이')?.nick).toBe('OWL')
  expect(findEmployee(b, 'NOBODY')).toBeUndefined()
  const card = cardOf(b, findEmployee(b, 'BEAR') as never, now)
  expect(card).toContain('인사카드: BEAR 곰 — 개발팀 사원 · 팀장 (builder)')
  expect(card).toContain('대리까지')
  expect(card).toContain('+ 팀장 수당 600')
  expect(card).toContain('■ 최근 업무')
  expect(card).toContain('30분 전  고치기  완료  D(-1)   -          30분     3     -  테스트·빌드 실패한 채 완료 · 재작업 · 근태 알림 1')
  expect(card).not.toContain('조사')
  expect(cardOf(b, findEmployee(b, 'OWL') as never, now)).toContain('아직 끝낸 업무가 없습니다')

  expect(durationText(40_000)).toBe('40초')
  expect(durationText(-5 * 60_000)).toBe('0초')
  // 그때 연봉을 적어 두면 인건비는 그것으로 잰다(나중에 승진해도 지난 일 값이 바뀌지 않는다): 3600만원/2080시간 × 1시간
  expect(reportOf({ ...b, log: [job({ startedAt: now - 2 * H, endedAt: now - H, salary: 3600 })] }, 'today', now)).toContain('인건비 약 17,308원')
  expect(durationText(80 * 60_000)).toBe('1시간 20분')
  expect(agoText(now - 3 * H, now)).toBe('3시간 전')
  // 예전 기록에는 log가 없다: 빈 목록으로 채우고, 망가진 칸은 버린다
  expect(migrate({ employees: [] })?.log).toEqual([])
  expect(migrate({ employees: [], log: [job({}), { nick: 'X' }, null] })?.log).toHaveLength(1)
  // 모르는 부서(더 새 판)는 지원팀으로 살리고, 망가진 연봉 칸은 버린다
  const moved = migrate({ employees: [], log: [{ ...job({}), dept: 'future', salary: 'x' }] })?.log[0]
  expect(moved?.dept).toBe('ops')
  expect(moved?.salary).toBeUndefined()
})
