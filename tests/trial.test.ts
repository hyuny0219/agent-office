// 테스트: 교육 효과 측정.
import { expect, test } from 'claude-code/testing'

import type { HrBook } from '../types'
import { briefOf, emptyBook, hire, isMuted, learn, lessonKey, migrate, RETEST_MS } from '../core/hr'
import { CONTROL_EVERY, effectText, enroll, markHit, MIN_CONTROL, MIN_MEMO, settle, verdictOf } from '../core/trial'
import { run } from './kit'

test('교육 효과: 순번으로 비교군을 두고, 근거가 모여야 판정하며, 효과 없는 실수는 2주 동안만 빼고 다시 잰다', () => {
  let b = hire(emptyBook(), 'BEAR', 'dev', 'builder', 1).book
  b = learn(learn(b, 'dev', 'Edit', 'String to replace not found in file.', 5), 'dev', 'Edit', 'String to replace not found in file.', 6)
  const lesson = b.lessons.dev![0]!
  const key = lessonKey(lesson)
  expect(enroll(b, [])).toBeNull()
  expect(enroll({ ...b, isTrialing: false }, [key])).toBeNull()
  const arms: string[] = []
  for (let i = 0; i < CONTROL_EVERY; i++) {
    const r = enroll(b, [key])!
    arms.push(r.arm)
    b = r.book
  }
  expect(arms).toEqual(['memo', 'memo', 'memo', 'memo', 'control'])
  expect(markHit({ arm: 'memo', keys: [key], hits: [] }, 'Bash|other').hits).toEqual([])

  const run = (book: HrBook, memoHits: number, controlHits: number, at: number) => {
    for (let i = 0; i < MIN_MEMO; i++) book = settle(book, { arm: 'memo', keys: [key], hits: i < memoHits ? [key] : [] }, at)
    for (let i = 0; i < MIN_CONTROL; i++) book = settle(book, { arm: 'control', keys: [key], hits: i < controlHits ? [key] : [] }, at)
    return book
  }
  // 드문 실수(둘 다 재발 없음)나 비교군 재발이 적으면 모른다: 근거 없이 빼지 않는다
  expect(verdictOf(run(b, 0, 0, 10).trials[key])).toBe('unknown')
  expect(verdictOf(run(b, 5, 1, 10).trials[key])).toBe('unknown')
  // 메모군 재발이 더 적으면 효과 있음
  expect(verdictOf(run(b, 1, 3, 10).trials[key])).toBe('effective')

  // 붙여도 비교군만큼 재발: 효과 없음 → 2주 동안 메모에서 빠진다
  const bad = run(b, 6, 3, 10)
  expect(verdictOf(bad.trials[key])).toBe('ineffective')
  expect(bad.trials[key]?.ineffectiveAt).toBe(10)
  expect(isMuted(bad, lesson, 11)).toBe(true)
  expect(effectText(bad.trials[key], true)).toContain('효과 없음(2주 동안 메모에서 뺀 뒤 다시 잼): 메모 10건 중 재발 6(60%) / 비교군 5건 중 재발 3(60%)')
  expect(briefOf(bad, bad.employees[0]!, 11)).not.toContain('반복한 실수')
  // 측정을 끄면 다시 붙는다
  expect(briefOf({ ...bad, isTrialing: false }, bad.employees[0]!, 11)).toContain('반복한 실수')
  // 2주가 지나면 다시 붙고, 다음 집계는 처음부터 센다
  expect(isMuted(bad, lesson, 10 + RETEST_MS)).toBe(false)
  const again = settle(bad, { arm: 'memo', keys: [key], hits: [] }, 10 + RETEST_MS)
  expect(again.trials[key]).toEqual({ memo: { jobs: 1, hits: 0 }, control: { jobs: 0, hits: 0 }, lastAt: 10 + RETEST_MS })

  // 교훈이 밀려나도 측정 기록은 남는다
  let evicted = bad
  for (let i = 0; i < 8; i++) evicted = learn(evicted, 'dev', 'Bash', `other ${'abcdefgh'[i]}`, 100 + i)
  expect(evicted.lessons.dev!.some(l => lessonKey(l) === key)).toBe(false)
  expect(evicted.trials[key]).toBeDefined()

  // 망가진 측정 기록도 고쳐 받는다
  const odd = migrate({ employees: [], trials: { [key]: { memo: {}, lastAt: 'x' }, bad: 3 } })!
  expect(odd.trials).toEqual({ [key]: { memo: { jobs: 0, hits: 0 }, control: { jobs: 0, hits: 0 }, lastAt: 0 } })
})
