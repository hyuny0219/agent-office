// oh-my-pi의 task 도구 입력 읽기와 예산 확인 대상 고르기. omp에 기대지 않는 순수 함수라 bun 테스트가 그대로 부른다.
import type { Dept, HrBook, OfficeAgent } from '../types'
import { DEPTS, deptFor } from '../core/hr'
import { gateOf } from '../core/budget'
import type { Overrun } from '../core/budget'

/** 서브에이전트가 받은 지시에서 업무 설명(첫 줄다운 줄) */
export const descriptionOf = (prompt: string): string =>
  prompt.split('\n').map(l => l.trim()).find(l => l !== '' && !/^complete assignment/i.test(l))?.slice(0, 80) ?? ''

/** task 도구가 맡기는 일 하나: 에이전트 종류(비었으면 null: omp가 세션의 기본 에이전트를 쓴다)와 설명 */
export type TaskItem = { type: string | null; what: string }

/** task 도구 입력의 일들(한 건이든 tasks 묶음이든) */
export function tasksOf(input: Record<string, unknown>): TaskItem[] {
  const one = (x: unknown): TaskItem | null => {
    if (typeof x !== 'object' || x === null) return null
    const o = x as Record<string, unknown>
    const type = typeof o.agent === 'string' && o.agent.trim() !== '' ? o.agent.trim() : null
    return { type, what: descriptionOf(typeof o.task === 'string' ? o.task : '') }
  }
  // 묶음의 일에 종류가 없으면 omp는 바깥 칸이 아니라 세션의 기본 에이전트를 쓴다(그래서 바깥 종류를 물려받지 않는다)
  const list = Array.isArray(input.tasks) ? input.tasks.map(one) : [one(input)]
  return list.filter((x): x is TaskItem => x !== null)
}

/**
 * 물어야 하는 예산 초과(부서마다 한 번): 종류가 있는 일은 그 부서를 보고, 종류가 빈 일은 omp가 어느 기본 에이전트를 쓸지
 * (세션의 spawn 정책·plan mode) 확장에서 알 수 없으므로 예산을 넘은 부서를 모두 본다(예산을 우회하지 않도록)
 */
export function gatesFor(book: HrBook, agents: readonly OfficeAgent[], items: readonly TaskItem[], now: number): { o: Overrun; what: string }[] {
  const out: { o: Overrun; what: string }[] = []
  const seen = new Set<Dept>()
  for (const t of items) {
    for (const dept of t.type === null ? DEPTS : [deptFor(book, t.type)]) {
      if (seen.has(dept)) continue
      const o = gateOf(book, agents, dept, now)
      if (o === null) continue
      seen.add(dept)
      out.push({ o, what: t.type === null ? `${t.what || '설명 없음'}, 기본 에이전트` : t.what })
    }
  }
  return out
}
