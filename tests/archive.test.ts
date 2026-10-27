// 테스트: 기록 보관·내보내기, 부서 배치, 예산 조치(순수 함수).
import { expect, test } from 'claude-code/testing'

import type { HrBook, JobRecord } from '../types'
import { archiveOf, csvCell, exportBase, exportFiles, foldInto, jobsCsvOf, monthOf, monthsCsvOf, monthsOf } from '../core/archive'
import { DEPTS, deptFor, deptOf, emptyBook, hire, MAX_LOG, migrate, record, setDept } from '../core/hr'
import { BUDGET_CHOICES, BUDGET_MS, choiceOf, gateOf, unwaive, waive } from '../core/budget'
import { archiveBlocks, deptMapBlocks, knownTypesOf } from '../core/report'
import { textOf } from '../core/table'
import { agent } from './kit'

/** 2026년 m월 15일 정오(현지 시각: 시간대가 바뀌어도 같은 달) */
const mid = (m: number) => new Date(2026, m - 1, 15, 12).getTime()
const job = (n: number, over: Partial<JobRecord> = {}): JobRecord => ({
  nick: 'BEAR', dept: 'dev', job: n, description: `일 ${n}`, startedAt: mid(1), endedAt: mid(1), outcome: 'done', score: 10, errors: 0, isCheckFailed: false, isReworked: false, alarms: 0, ...over,
})
const isDept = (d: unknown): d is (typeof DEPTS)[number] => DEPTS.includes(d as never)

test('기록 보관: 넘쳐 밀려나는 오래된 일은 지우지 않고 월별 요약으로 접고, 보이는 월별 실적은 남은 기록까지 센다', () => {
  expect(monthOf(mid(3))).toBe('2026-03')
  // 1월에 끝낸 일 MAX_LOG건 뒤에 2월 일 3건: 가장 오래된 1월 일 3건이 접힌다
  let b: HrBook = emptyBook()
  for (let i = 1; i <= MAX_LOG; i++) b = record(b, job(i, { score: i % 2 === 0 ? 10 : -5, outcome: i % 2 === 0 ? 'done' : 'failed', tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, usd: 0.5, unpriced: 0 } }))
  expect(b.archive).toBeUndefined()
  for (let i = 1; i <= 3; i++) b = record(b, job(MAX_LOG + i, { endedAt: mid(2), dept: 'qa', isReworked: i === 1, approval: i === 2 ? 'rejected' : 'approved', bossRating: i === 3 ? 'good' : undefined }))
  expect(b.log.length).toBe(MAX_LOG)
  expect(b.archive?.map(m => m.month)).toEqual(['2026-01'])
  const jan = b.archive?.[0]
  // 접힌 것은 1·2·3번째 일(실패·완료·실패)
  expect([jan?.jobs, jan?.done, jan?.failed, jan?.scoreSum, jan?.usd]).toEqual([3, 1, 2, 0, 1.5])
  expect(jan?.depts.dev).toEqual({ jobs: 3, scoreSum: 0, usd: 1.5 })
  // 보이는 달: 2월(남은 기록) + 1월(접은 3건 + 남은 297건)
  const months = monthsOf(b)
  expect(months.map(m => [m.month, m.jobs])).toEqual([['2026-02', 3], ['2026-01', MAX_LOG]])
  expect([months[0]?.reworks, months[0]?.rejected, months[0]?.good]).toEqual([1, 1, 1])
  // 이미 접은 달에 더 접으면 합친다
  const twice = foldInto(b.archive ?? [], [job(999, { endedAt: mid(1) })])
  expect(twice[0]?.jobs).toBe(4)
  // 화면: 달마다 한 줄, 가장 많이 일한 부서
  const screen = textOf(archiveBlocks(b))
  expect(screen).toContain('2026-02')
  expect(screen).toMatch(/2026-01 +300 +150 +150/)
  expect(screen).toContain('개발팀 300건')
  expect(textOf(archiveBlocks(emptyBook()))).toContain('아직 끝낸 일이 없습니다')
  // 저장했다 읽어도 남고, 모양이 틀린 달은 버린다
  const back = migrate(JSON.parse(JSON.stringify({ ...b, archive: [...(b.archive ?? []), { month: 'bad' }, { month: '2025-12', jobs: 'x', depts: { nope: { jobs: 1 }, qa: { jobs: 2 } } }] })))
  expect(back?.archive?.map(m => m.month)).toEqual(['2026-01', '2025-12'])
  expect(back?.archive?.[1]).toEqual({ month: '2025-12', jobs: 0, done: 0, failed: 0, scoreSum: 0, usd: 0, reworks: 0, rejected: 0, good: 0, bad: 0, depts: { qa: { jobs: 2, scoreSum: 0, usd: 0 } } })
  expect(migrate({ ...emptyBook(), archive: 'x' })?.archive).toBeUndefined()
  expect(archiveOf([{ month: '2026-01' }, { month: '2026-01', jobs: 9 }], isDept)?.length).toBe(1)
})

test('내보내기: JSON은 인사 기록 통째, CSV는 업무 기록·월별 요약(엑셀용 BOM, 따옴표, 수식이 될 글은 막는다)', () => {
  expect(csvCell('보통')).toBe('보통')
  expect(csvCell('a,b')).toBe('"a,b"')
  expect(csvCell('그는 "네"라고')).toBe('"그는 ""네""라고"')
  expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`)
  expect(csvCell('-1+2')).toBe("'-1+2")
  // 앞 공백·전각 기호도 막는다
  expect(csvCell(' =1+1')).toBe("' =1+1")
  expect(csvCell('＝1+1')).toBe("'＝1+1")
  expect(csvCell(-3)).toBe('-3')
  expect(csvCell(undefined)).toBe('')
  expect(csvCell(true)).toBe('true')
  const at = new Date(2026, 9, 27, 15, 30, 5).getTime()
  expect(exportBase(at)).toBe('agent-office-20261027-153005')
  const b = record(record(emptyBook(), job(1)), job(2, { description: '=cmd|"/c calc"', approval: 'rejected', approver: 'HAWK', bossRating: 'bad', tokens: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, usd: 0.25, unpriced: 0 } }))
  const ko = (d: string) => (d === 'dev' ? '개발팀' : d)
  const jobs = jobsCsvOf(b, ko as never)
  expect(jobs.startsWith('﻿별칭,부서,몇 번째 일,업무,')).toBe(true)
  const lines = jobs.trimEnd().split('\r\n')
  expect(lines.length).toBe(3)
  expect(lines[1]).toContain(`BEAR,개발팀,2,"'=cmd|""/c calc""",`)
  expect(lines[1]).toContain(',rejected,HAWK,bad,,0.2500,0.0000')
  expect(monthsCsvOf(b, ko as never).trimEnd().split('\r\n')).toEqual(['﻿달,부서,업무,완료,실패·중단,평균 평가,비용(달러),재작업,반려,대표 좋음,대표 아쉬움', '2026-01,전체,2,2,0,10.0,0.2500,0,1,0,1', '2026-01,개발팀,2,,,10.0,0.2500,,,,'])
  const asJson = exportFiles(b, 'json', at, ko as never)
  expect(asJson.map(f => f.name)).toEqual(['agent-office-20261027-153005.json'])
  const parsed = JSON.parse(asJson[0]?.text ?? '{}')
  expect(parsed.app).toBe('agent-office')
  expect(migrate(parsed.book)?.log.length).toBe(2)
  expect(exportFiles(b, 'csv', at, ko as never).map(f => f.name)).toEqual(['agent-office-20261027-153005-jobs.csv', 'agent-office-20261027-153005-months.csv'])
})

test('부서 배치: 대표가 바꾼 배치를 먼저 보고, 기본과 같으면 적지 않으며, 이상한 종류·부서는 읽지 않는다', () => {
  const b0 = emptyBook()
  expect(deptFor(b0, 'oh-my-claudecode:writer')).toBe('docs')
  const b1 = setDept(b0, 'oh-my-claudecode:Writer', 'qa')
  expect(b1.deptMap).toEqual({ writer: 'qa' })
  expect(deptFor(b1, 'writer')).toBe('qa')
  expect(deptOf('writer')).toBe('docs')
  // 기본으로 돌리면 표에서 빠진다(빈 표는 남기지 않는다)
  expect(setDept(b1, 'writer', 'docs').deptMap).toBeUndefined()
  expect(setDept(b1, 'writer', null).deptMap).toBeUndefined()
  expect(setDept(b0, 'bad name!', 'qa')).toBe(b0)
  // 표: 직원이 맡아 본 종류와 바꾼 종류
  const b2 = hire(b1, 'OWL', 'research', 'Explore', 0).book
  expect(knownTypesOf(b2)).toEqual(['explore', 'writer'])
  const shown = textOf(deptMapBlocks(b2))
  expect(shown).toMatch(/explore +조사팀 +\(기본\)/)
  expect(shown).toMatch(/writer +품질팀 +문서팀/)
  const back = migrate({ ...b2, deptMap: { writer: 'qa', 'x y': 'dev', scout: 'nope', ok: 'plan' } })
  expect(back?.deptMap).toEqual({ writer: 'qa', ok: 'plan' })
  expect(migrate({ ...b2, deptMap: 'x' })?.deptMap).toBeUndefined()
  // 객체의 상속 이름은 표에 없는 종류이고, 열쇠로 쓸 수 없다(쓰면 표를 읽을 때 엉뚱한 값이 나온다)
  for (const k of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
    expect(deptOf(k)).toBe('ops')
    expect(deptFor(b0, k)).toBe('ops')
    expect(setDept(b0, k, 'dev')).toBe(b0)
  }
  expect(migrate(JSON.parse('{"employees":[],"deptMap":{"__proto__":"dev","constructor":"qa","writer":"qa"}}'))?.deptMap).toEqual({ writer: 'qa' })
  expect(textOf(deptMapBlocks(hire(b0, 'X', 'ops', 'constructor', 0).book))).toMatch(/constructor +지원팀/)
})

test('예산 조치: 한도를 넘은 부서는 맡기기 전에 묻고, "계속"이면 24시간 동안 다시 묻지 않으며, 모르는 답은 맡기지 않는다', () => {
  const spent = (usd: number): JobRecord => job(1, { endedAt: 1000, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, usd, unpriced: 0 } })
  const b = { ...record(emptyBook(), spent(3)), budgets: { dev: 2 } }
  expect(gateOf(b, [], 'qa', 2000)).toBeNull()
  expect(gateOf({ ...b, budgets: { dev: 5 } }, [], 'dev', 2000)).toBeNull()
  expect(gateOf(b, [], 'dev', 2000)).toEqual({ dept: 'dev', spent: 3, budget: 2 })
  // 일하는 중인 사람이 쓴 것도 든다
  expect(gateOf({ ...b, budgets: { dev: 4 } }, [agent('c1', { tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, usd: 1.5, unpriced: 0 } })], 'dev', 2000)?.spent).toBe(4.5)
  const waived = waive(b, 'dev', 2000)
  expect(gateOf(waived, [], 'dev', 2000 + BUDGET_MS - 1)).toBeNull()
  expect(gateOf(waived, [], 'dev', 2000 + BUDGET_MS + 1)).toBeNull()
  // 24시간이 지나면 다시 묻는다(그때 쓴 비용이 남아 있으면)
  const later = { ...record(waived, { ...spent(3), endedAt: 2000 + BUDGET_MS }), budgets: { dev: 2 } }
  expect(gateOf(later, [], 'dev', 2000 + BUDGET_MS + 1)?.spent).toBe(3)
  expect(unwaive(waived, 'dev').budgetWaivers).toBeUndefined()
  expect(choiceOf(BUDGET_CHOICES.go)).toBe('go')
  expect(choiceOf(BUDGET_CHOICES.once)).toBe('once')
  expect(choiceOf(BUDGET_CHOICES.stop)).toBe('stop')
  expect(choiceOf('그냥 해')).toBe('stop')
  expect(choiceOf(undefined)).toBe('stop')
  expect(migrate({ ...waived, budgetWaivers: { dev: 5, qa: 'x', nope: 1 } })?.budgetWaivers).toEqual({ dev: 5 })
})
