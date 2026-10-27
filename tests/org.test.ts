// 테스트: 조직(적임자·결재 정확도·조직 개편).
import { expect, test } from 'claude-code/testing'

import type { HrBook, JobRecord } from '../types'
import { decide, emptyBook, hire, migrate, review } from '../core/hr'
import { decisionToast } from '../core/approval'
import { cardOf, findEmployee } from '../core/report'
import { textOf } from '../core/table'
import { accuracyBlocks, accuracyOf, FOLLOW_MS, followUp, IDLE_MS, isRejectTrusted, isSimilar, judgeOf, pickFor, reinstate, reorgOf } from '../core/org'
import { run } from './kit'

test('조직: 비슷한 일을 잘 끝낸 직원을 고르고, 결재는 후속 수정으로 맞았는지 재며, 계속 나쁘거나 오래 일이 없으면 내보낸다', () => {
  // 비슷한 일: 짧은 쪽 낱말의 절반 이상이 겹친다(조사가 붙어도 같은 낱말)
  expect(isSimilar('빌드 고치기', '빌드를 고쳐')).toBe(true)
  expect(isSimilar('README 오타 고치기', 'readme 고치기')).toBe(true)
  expect(isSimilar('문서 정리', '빌드 고치기')).toBe(false)
  expect(isSimilar('', '빌드')).toBe(false)
  // 짧은 영문 낱말은 그대로 같을 때만
  expect(isSimilar('go', 'golang')).toBe(false)
  expect(isSimilar('go api', 'golang apis')).toBe(false)
  expect(isSimilar('run tests', 'test runner')).toBe(true)

  const rec = (over: Partial<JobRecord>): JobRecord => ({ nick: 'PANDA', dept: 'dev', job: 1, description: 'README 고치기', startedAt: 0, endedAt: 100, outcome: 'done', score: 13, errors: 0, isCheckFailed: false, isReworked: false, alarms: 0, ...over })
  let b: HrBook = hire(hire(emptyBook(), 'BEAR', 'dev', 'builder', 0).book, 'PANDA', 'dev', 'builder', 1).book
  b = { ...b, employees: b.employees.map(e => (e.nick === 'BEAR' ? { ...e, xp: 40, jobs: 3, avgScore: 8 } : { ...e, xp: 10, jobs: 1, avgScore: 6 })), log: [rec({})] }
  expect(pickFor(b, 'dev', new Set(), 'README 오타 고치기')).toEqual({ employee: b.employees[1], why: '비슷한 일 1건을 잘 끝냄' })
  // 비슷한 일이 없으면 평균 평가로, 고를 사람이 하나면 까닭 없이, 아무도 없으면 null(새로 뽑는다)
  expect(pickFor(b, 'dev', new Set(), '배포 스크립트')?.why).toBe('평균 평가 B(8.0)')
  expect(pickFor(b, 'dev', new Set(['PANDA']), 'README 고치기')).toEqual({ employee: b.employees[0], why: null })
  expect(pickFor(b, 'qa', new Set(), '리뷰')).toBeNull()
  // 감점을 유예한 반려(결재자의 반려가 자주 빗나감)는 그르친 일로 치지 않는다
  expect(pickFor({ ...b, log: [rec({ approval: 'rejected', isWaived: true })] }, 'dev', new Set(), 'README 오타 고치기')?.employee.nick).toBe('PANDA')
  expect(pickFor({ ...b, log: [rec({ approval: 'rejected' })] }, 'dev', new Set(), 'README 오타 고치기')?.employee.nick).toBe('BEAR')
  // 비슷한 일을 그르쳤으면(반려·재작업) 오히려 뒤로 간다
  expect(pickFor({ ...b, log: [rec({ isReworked: true })] }, 'dev', new Set(), 'README 오타 고치기')?.employee.nick).toBe('BEAR')

  // 후속 수정: 그 일을 한 직원 말고 다른 사람이 10분 안에 같은 파일을 고치면 적는다
  const at = 1_000
  const jobs = [1, 2, 3, 4].map(job => rec({ job, endedAt: at, files: 1, approval: 'rejected', approver: 'BEAR' }))
  let w: HrBook = { ...b, log: jobs, handoffs: [1, 2, 3, 4].map(job => ({ agentId: `p${job}`, nick: 'PANDA', files: [`/r/${job}.ts`], endedAt: at, job })) }
  // 같은 직원(PANDA)이 다음 일에서 제 파일을 더 고친 것은 세지 않는다
  expect(followUp(w, '/r/1.ts', 'PANDA', at + 1)).toBe(w)
  expect(followUp(w, '/r/1.ts', 'BOSS', at + FOLLOW_MS + 1)).toBe(w)
  w = followUp(w, '/r/1.ts', 'BOSS', at + 1)
  expect(w.log.find(r => r.job === 1)?.isFollowedUp).toBe(true)
  // 지켜보는 동안은 판정하지 않고(고쳐졌으면 바로), 지나면 아무도 안 고친 반려는 빗나간 반려
  expect(judgeOf(w.log.find(r => r.job === 2)!, at + 1)).toBeNull()
  expect(judgeOf(w.log.find(r => r.job === 1)!, at + 1)).toBe('right-reject')
  const later = at + FOLLOW_MS + 1
  expect(judgeOf(w.log.find(r => r.job === 2)!, later)).toBe('doubtful')
  expect(judgeOf(rec({ approval: 'approved', files: 1, isFollowedUp: true }), later)).toBe('missed')
  expect(judgeOf(rec({ approval: 'approved', files: 0 }), later)).toBeNull()
  expect(judgeOf(rec({ approval: 'exempt', files: 1 }), later)).toBeNull()
  expect(accuracyOf(w, later)).toEqual([{ approver: 'BEAR', judged: 4, right: 1, missed: 0, doubtful: 3, rejects: 4, rightRejects: 1 }])
  // 판정된 반려 4건 중 1건만 맞았다(1/3 아래): 이 결재자의 반려는 감점하지 않는다
  expect(isRejectTrusted(w, 'BEAR', later)).toBe(false)
  expect(isRejectTrusted(w, 'BEAR', at + 1)).toBe(true)
  expect(isRejectTrusted(w, 'BOSS', later)).toBe(true)
  expect(textOf(accuracyBlocks(w, later))).toMatch(/개발팀장 BEAR\(곰\)\s+4건\s+1\(25%\)\s+0\s+3\s+반려 감점 유예/)
  const bear = b.employees[0]!
  expect(decisionToast(bear, { kind: 'review', approver: 'BOSS', approverTitle: '대표 BOSS' }, '빌드', { verdict: 'rejected', notes: [] }, 0)).toContain('반려 (감점 유예')
  expect(decide(b, 'PANDA', 1, 'approved', 3, 'BEAR').book.log[0]?.approver).toBe('BEAR')
  expect(decide(b, 'PANDA', 1, 'rejected', 0, 'BEAR').book.log[0]).toMatchObject({ approval: 'rejected', isWaived: true, score: 13 })

  // 조직 개편: 업무 5건 이상에 평균이 0 아래면 권고사직, 2건 이하로 30일 넘게 일이 없으면 계약 종료, 일하는 중이면 그대로
  const now = IDLE_MS + 10
  const org: HrBook = { ...b, employees: [
    { ...bear, nick: 'MOLE', jobs: 5, avgScore: -2, lastAt: now },
    { ...bear, nick: 'SEAL', jobs: 1, avgScore: 8, lastAt: 5 },
    { ...bear, nick: 'LYNX', jobs: 6, avgScore: -1, lastAt: now },
    bear,
  ] }
  const r = reorgOf(org, new Set(['LYNX']), now)
  expect(r.gone.map(e => [e.nick, e.reason])).toEqual([['MOLE', '권고사직: 업무 5건, 최근 평균 평가 D(-2.0)'], ['SEAL', '계약 종료: 30일 동안 일이 없음']])
  expect(r.book.employees.map(e => e.nick)).toEqual(['LYNX', 'BEAR'])
  expect(r.book.retired.map(e => e.nick)).toEqual(['MOLE', 'SEAL'])
  expect(reorgOf(r.book, new Set(['LYNX']), now).gone).toEqual([])
  // 떠난 직원은 명부에 남고(인사카드), 예전 기록에는 빈 명부로 채운다
  expect(migrate(r.book)?.retired.map(e => [e.nick, e.retiredAt])).toEqual([['MOLE', now], ['SEAL', now]])
  expect([migrate({ employees: [] })?.retired, migrate({ employees: [] })?.isReorganizing]).toEqual([[], true])
  expect(cardOf(r.book, findEmployee(r.book, 'mole')!, now)).toMatch(/퇴사\s+방금 · 권고사직/)
  // 떠난 직원이 다시 일을 맡았으면 새로 뽑지 않고 그 기록 그대로 복직
  const back = reinstate(r.book, 'SEAL')
  expect([back.employees.map(e => e.nick), back.retired.map(e => e.nick), 'retiredAt' in back.employees[2]!]).toEqual([['LYNX', 'BEAR', 'SEAL'], ['MOLE'], false])
  expect(reinstate(r.book, 'NOBODY')).toBe(r.book)
})
