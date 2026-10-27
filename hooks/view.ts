// 사무실 화면. 패널 목록 줄과 사내 메신저 줄을 만들고, 그려 둔 평면도를 프레임마다 다시 칠한다.
// JSX는 register.tsx가 짠다. 여기에는 무엇을 보일지와 평면도를 언제 칠할지만 둔다.
import type { EngineInterface } from 'claude-code'

import type { HrBook, OfficeAgent } from '../types'
import { encodeCells, Office } from '../core/scene'
import type { Layout } from '../core/scene'
import { syncStatus } from './flow'
import { agentsOf, hrOf, leadsOf } from './store'

export { widthOf } from '../core/table'
export { feedRowsOf, fitParts, FEED_SHOWN, rowsOf } from '../core/rows'
export type { Row } from '../core/rows'

export const RASTER = 'office'
export const FRAME_MS = 200
let frame = 0
// 지금 그려져 있는 사무실(패널 id → 그 자리의 사무실). 사람들의 걸음은 자리마다 따로 간다.
const offices = new Map<string, Office>()
let denies = 0
/** 사무실 패널을 그린 적이 있는지(터미널·데스크톱 모두: 5초마다 다시 그린다) */
let isPaneShown = false

export const markPaneShown = () => {
  isPaneShown = true
}
/** 그 자리에 평면도를 그리지 않는다(데스크톱처럼 평면도가 없는 화면) */
export const dropOffice = (requestId: string) => {
  offices.delete(requestId)
}

/** 그 자리의 사무실(폭이 바뀌었으면 새로 짓는다) */
export function officeAt(requestId: string, layout: Layout): Office {
  const had = offices.get(requestId)
  if (had !== undefined && had.layout.columns === layout.columns) return had
  const office = new Office(layout)
  offices.set(requestId, office)
  return office
}

/** 평면도 한 장을 칸으로 칠한다(목록 줄과 같은 사람들·같은 시각으로) */
export const cellsOf = (office: Office, agents: readonly OfficeAgent[], now: number, b: HrBook): string =>
  encodeCells(office.draw(agents, frame, now, leadsOf(b)))

export async function tick($: EngineInterface) {
  frame++
  if (frame % 5 === 0) await syncStatus($)
  // 패널의 "n초 전"과 말풍선 인용은 상태가 안 바뀌면 그대로라, 5초마다 한 번 다시 그린다
  if (frame % 25 === 0 && isPaneShown) $.ui.invalidate('ui.render')
  if (offices.size === 0) return
  const agents = await agentsOf($)
  const leads = leadsOf(await hrOf($))
  const now = await $.clock.now()
  for (const [requestId, office] of offices) {
    const cells = encodeCells(office.draw(agents, frame, now, leads))
    const blitted = await $.ui.blit({ requestId, key: RASTER, cells, columns: office.layout.columns, rows: office.layout.rows })
    if (blitted.deny === undefined) {
      denies = 0
      continue
    }
    // 닫혔거나 크기가 바뀌었다: 그 자리는 멈추고, 몇 번까지만 다시 그려 달라고 한다
    offices.delete(requestId)
    if (++denies <= 3) $.ui.invalidate('ui.render')
  }
}
