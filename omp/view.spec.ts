// omp판 화면 줄 만들기 테스트(bun test omp). omp 없이 돈다: 화면 줄은 순수 함수다.
import { describe, expect, test } from 'bun:test'

import type { OfficeAgent } from '../types'
import { emptyBook, hire, record, setDept } from '../core/hr'
import { widthOf } from '../core/table'
import { clip, menuHead, menuLines, MENU, pad, plain, sideLines, TWO_COLUMN_MIN, viewBlocks, widgetLines } from './view'
import type { Scene } from './view'

const NOW = 1_000_000
const bear: OfficeAgent = { id: 'a1', type: 'builder', nick: 'BEAR', dept: 'dev', description: '결제 화면 고치기', model: 'claude-sonnet-5-5', startedAt: NOW - 60_000, endedAt: null, activity: 'type', tool: 'Edit', tools: 3 }
const scene = (over: Partial<Scene> = {}): Scene => ({ agents: [bear], book: hire(emptyBook(), 'BEAR', 'dev', 'builder', 0).book, feed: [{ at: NOW - 1000, kind: 'order', from: 'BOSS', to: 'BEAR', text: '결제 화면 고치기' }], now: NOW, ...over })

describe('칸 맞춤', () => {
  test('ANSI 코드는 칸을 차지하지 않고, 한글은 두 칸으로 자르며, 모자라면 빈칸으로 채운다', () => {
    expect(plain(clip('\x1b[31m가나다라\x1b[0m', 5))).toBe('가나')
    expect(widthOf(plain(pad('\x1b[2m가\x1b[0m', 6)))).toBe(6)
    expect(plain(clip('\x1b]8;;https://x\x07링크\x1b]8;;\x07abc', 5))).toBe('링크a')
  })
})

describe('입력창 위 패널', () => {
  test(`${TWO_COLUMN_MIN}칸 이상이면 2단(목록 | 메신저), 좁으면 위아래로 쌓고, 어느 줄도 폭을 넘지 않는다`, () => {
    for (const w of [60, 89, 90, 140]) {
      const lines = widgetLines(w, scene(), null)
      for (const l of lines) expect(widthOf(plain(l))).toBeLessThanOrEqual(w)
      const isTwo = lines.some(l => plain(l).includes(' │ '))
      expect(isTwo).toBe(w >= TWO_COLUMN_MIN)
      expect(lines.map(plain).join('\n')).toContain('BEAR')
    }
  })
  test('아무도 없으면 안내 줄을, 평면도를 켜면(72칸 이상) 그 줄을 위에 붙인다', () => {
    expect(plain(widgetLines(100, scene({ agents: [], feed: [] }), null)[0] ?? '')).toContain('아직 일하는 에이전트가 없습니다')
    const withPlan = widgetLines(100, scene(), w => [`PLAN ${w}`])
    expect(plain(withPlan[0] ?? '')).toBe('PLAN 100')
    expect(widgetLines(70, scene(), () => ['PLAN']).some(l => plain(l) === 'PLAN')).toBe(false)
  })
})

describe('사이드바', () => {
  test('내용 높이만큼의 테두리 상자이고, 평면도는 안쪽 72칸 이상일 때만 넣는다', () => {
    const box = sideLines(48, scene(), () => ['PLAN'])
    expect(plain(box[0] ?? '').startsWith('╭')).toBe(true)
    expect(plain(box[box.length - 1] ?? '').startsWith('╰')).toBe(true)
    expect(box.some(l => plain(l).includes('PLAN'))).toBe(false)
    for (const l of box) expect(widthOf(plain(l))).toBeLessThanOrEqual(48)
    expect(sideLines(74, scene(), () => ['PLAN']).some(l => plain(l) === '│ PLAN')).toBe(true)
  })
})

describe('메뉴 화면', () => {
  test('1~7: 고른 메뉴는 뒤집어 보이고, 7은 월별 기록, 설정에는 부서 배치 표가 있다', () => {
    expect(MENU.map(m => m.key).join('')).toBe('1234567')
    expect(menuHead('archive')).toContain('\x1b[7m 7 기록 \x1b[0m')
    const s = scene({ book: setDept(record(hire(emptyBook(), 'BEAR', 'dev', 'builder', 0).book, { nick: 'BEAR', dept: 'dev', job: 1, description: '빌드', startedAt: 0, endedAt: NOW, outcome: 'done', score: 13, errors: 0, isCheckFailed: false, isReworked: false, alarms: 0 }), 'builder', 'qa') })
    const archive = menuLines('archive', 120, s, null).map(plain).join('\n')
    expect(archive).toContain('월별 기록')
    expect(archive).toMatch(/\d{4}-\d{2} +1 +1/)
    const settings = menuLines('settings', 120, s, null).map(plain).join('\n')
    expect(settings).toContain('a: [켜짐] 결재')
    expect(settings).toMatch(/builder +품질팀 +개발팀/)
    // 마크다운 부품이 있으면 그것으로 그린다
    expect(menuLines('archive', 80, s, md => [`MD ${md.length > 0}`])[2]).toContain('MD true')
    expect(viewBlocks('card:NOBODY', s)[0]).toEqual({ t: 'line', text: 'NOBODY라는 직원이 없습니다.' })
  })
})
