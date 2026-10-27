// omp판 task 도구 입력 읽기와 예산 확인 대상 테스트(bun test omp).
import { describe, expect, test } from 'bun:test'

import type { JobRecord } from '../types'
import { emptyBook, record, setDept } from '../core/hr'
import { gatesFor, tasksOf } from './tasks'

const spent = (dept: JobRecord['dept'], usd: number): JobRecord => ({ nick: 'X', dept, job: 1, description: '', startedAt: 0, endedAt: 1000, outcome: 'done', score: 10, errors: 0, isCheckFailed: false, isReworked: false, alarms: 0, tokens: { input: 1, output: 0, cacheRead: 0, cacheWrite: 0, usd, unpriced: 0 } })

describe('task 입력', () => {
  test('한 건·묶음을 읽고, 빈 종류는 null(omp가 세션 기본 에이전트를 쓴다: 묶음의 일도 바깥 종류를 물려받지 않는다)', () => {
    expect(tasksOf({ agent: 'scout', task: '로그 찾기\n자세히' })).toEqual([{ type: 'scout', what: '로그 찾기' }])
    expect(tasksOf({ task: '고치기' })).toEqual([{ type: null, what: '고치기' }])
    expect(tasksOf({ agent: ' ', task: 'x' })[0]?.type).toBeNull()
    expect(tasksOf({ agent: 'task', tasks: [{ task: 'a' }, { agent: 'scout', task: 'b' }, 'bad'] })).toEqual([{ type: null, what: 'a' }, { type: 'scout', what: 'b' }])
    expect(tasksOf({ tasks: [{ task: 'a' }] })).toEqual([{ type: null, what: 'a' }])
  })
})

describe('예산 확인 대상', () => {
  const book = { ...record(record(emptyBook(), spent('dev', 3)), spent('plan', 5)), budgets: { dev: 2, plan: 1, qa: 9 } }
  test('종류가 있으면 그 부서만, 부서마다 한 번, 바꾼 배치를 따른다', () => {
    expect(gatesFor(book, [], [{ type: 'task', what: 'a' }, { type: 'task', what: 'b' }], 2000).map(g => [g.o.dept, g.what])).toEqual([['dev', 'a']])
    expect(gatesFor(book, [], [{ type: 'code-reviewer', what: 'r' }], 2000)).toEqual([])
    expect(gatesFor(setDept(book, 'scout', 'plan'), [], [{ type: 'scout', what: 's' }], 2000).map(g => g.o.dept)).toEqual(['plan'])
  })
  test('종류가 비면(기본 에이전트를 알 수 없으면) 예산을 넘은 부서를 모두 본다', () => {
    expect(gatesFor(book, [], [{ type: null, what: '고치기' }], 2000).map(g => [g.o.dept, g.what])).toEqual([['dev', '고치기, 기본 에이전트'], ['plan', '고치기, 기본 에이전트']])
    expect(gatesFor({ ...book, budgets: {} }, [], [{ type: null, what: 'x' }], 2000)).toEqual([])
  })
})
