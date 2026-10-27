// 테스트가 함께 쓰는 것: 사무실 사람 만들기, 평면도 프레임 돌리기·글자로 읽기, 패널·명령·띄우기 사건의 겉봉.
import type { OfficeAgent } from '../types'
import { Office, PLAN_ROWS } from '../core/scene'

export const agent = (id: string, over: Partial<OfficeAgent> = {}): OfficeAgent => ({
  id, type: 'builder', nick: 'BEAR', dept: 'dev', description: '빌드', model: null, startedAt: 0, endedAt: null, activity: 'type', tool: 'Edit', tools: 3, ...over,
})
export const boss = agent('main', { type: 'main', nick: 'BOSS', dept: undefined, activity: 'think' })

/** 사람들이 다 걸어갈 때까지 프레임을 돌린다 */
export const run = (office: Office, agents: OfficeAgent[], frames: number, now = 0) => {
  let words: Uint32Array = new Uint32Array()
  for (let f = 0; f < frames; f++) words = office.draw(agents, f, now)
  return words
}
export const rowOf = (words: Uint32Array, columns: number, cy: number) =>
  Array.from({ length: columns }, (_, cx) => String.fromCharCode(words[(cy * columns + cx) * 3] ?? 0)).join('')
export const screen = (words: Uint32Array, columns: number) => Array.from({ length: PLAN_ROWS }, (_, cy) => rowOf(words, columns, cy)).join('\n')

export const PROPS = { title: '에이전트 사무실', isFocused: false, bodyColumns: 96, placement: 'dock', scroll: { offset: 0, bodyRows: 50 }, view: {} } as const
export const RUN = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } } as const
export const SPAWN = { provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5', background: true, fork: false } as const
