// 테스트: 평면도(별칭·방 옮기기·회의·퇴근).
import { expect, test } from 'claude-code/testing'

import { encodeCells, koNick, layoutOf, nickFor, Office, PLAN_ROWS } from '../core/scene'
import { agent, boss, run, rowOf, screen } from './kit'

test('별칭: 종류별 별칭을 먼저 주고, 이미 쓴 별칭은 피하며, 다 쓰면 번호를 붙인다', () => {
  expect(nickFor('main', [])).toBe('BOSS')
  expect(nickFor('Explore', [])).toBe('OWL')
  expect(nickFor('oh-my-claudecode:executor', [])).toBe('BEAR')
  expect(nickFor('builder', [agent('a')])).not.toBe('BEAR')
  const names = ['OWL', 'BEAR', 'HAWK', 'FOX', 'CAT', 'CRANE', 'OTTER', 'WHALE', 'PANDA', 'TIGER', 'KOALA', 'WOLF', 'DEER', 'SEAL', 'MOLE', 'LYNX']
  expect(nickFor('builder', names.map((nick, i) => agent(`x${i}`, { nick })))).toBe('OWL2')
  expect(koNick('OWL2')).toBe('부엉이2')
  expect(koNick('BOSS')).toBe('보스')
})

test('평면도: 방 표지, 부서 섬 표지와 명패, 셀 인코딩', () => {
  const layout = layoutOf(96)
  expect(layout).toEqual({ columns: 96, rows: PLAN_ROWS })
  expect(layoutOf(30).columns).toBe(72)
  const office = new Office(layout)
  const words = run(office, [boss, agent('a1'), agent('a2', { nick: 'HAWK', dept: 'qa', type: 'reviewer' })], 2)
  expect(words.length).toBe(96 * PLAN_ROWS * 3)
  const all = screen(words, 96)
  expect(rowOf(words, 96, 0)).toContain('AGENT OFFICE  working 2')
  for (const name of ['CEO', 'MEETING', 'LIBRARY', 'SERVER', 'WC']) expect(rowOf(words, 96, 1)).toContain(name)
  for (const name of ['OFFICE', 'PANTRY']) expect(rowOf(words, 96, 13)).toContain(name)
  expect(all).toContain('DEV')
  expect(all).toContain('QA')
  // 팀원 책상 명패(팀장이 정해지지 않았으면 팀원 자리)
  expect(all).toContain('BEAR')
  expect(all).toContain('HAWK')
  // 팀장이면 팀장 책상(6칸)에 앉는다
  const leadWords = new Office(layout).draw([boss, agent('a1')], 0, 0, { dev: 'BEAR' })
  expect(screen(leadWords, 96)).toContain('BEAR  ')
  expect(encodeCells(words).length).toBe(Math.ceil((words.length * 4) / 3) * 4)
})

test('하는 일에 따라 방을 옮기고, 새 사람은 입구에서 걸어 들어온다', () => {
  const office = new Office(layoutOf(96))
  run(office, [boss, agent('a1')], 1)
  expect(office.whereIs('main')?.room).toBe('ceo')
  expect(office.whereIs('a1')?.room).toBe('office')
  const owl = agent('a2', { nick: 'OWL', type: 'Explore', dept: 'research', activity: 'read', tool: 'Grep' })
  run(office, [boss, agent('a1'), owl], 1)
  expect(office.whereIs('a2')).toEqual({ room: 'corridor', isMoving: true })
  run(office, [boss, agent('a1'), owl], 80)
  expect(office.whereIs('a2')).toEqual({ room: 'library', isMoving: false })
  run(office, [boss, agent('a1', { activity: 'bash', tool: 'Bash' }), owl], 80)
  expect(office.whereIs('a1')).toEqual({ room: 'server', isMoving: false })
  // 기다리는 동안에만 쉰다(탕비실·화장실)
  run(office, [boss, agent('a1', { activity: 'idle' }), owl], 80)
  expect(['pantry', 'wc']).toContain(office.whereIs('a1')?.room)
})

test('대화하면 회의실에 모이고, 끝내면 보고한 뒤 입구로 퇴근한다', () => {
  const office = new Office(layoutOf(96))
  run(office, [boss, agent('a1')], 1, 0)
  const talking = [boss, agent('a1')].map(a => ({ ...a, meetUntil: 10_000 }))
  run(office, talking, 80, 1000)
  expect(office.whereIs('main')).toEqual({ room: 'meet', isMoving: false })
  expect(office.whereIs('a1')).toEqual({ room: 'meet', isMoving: false })
  expect(rowOf(run(office, talking, 1, 1000), 96, 0)).toContain('meeting 2')
  run(office, [boss, agent('a1')], 80, 20_000)
  expect(office.whereIs('main')?.room).toBe('ceo')
  expect(office.whereIs('a1')?.room).toBe('office')
  const done = agent('a1', { activity: 'done', endedAt: 30_000, meetUntil: 38_000 })
  run(office, [boss, done], 80, 31_000)
  expect(office.whereIs('a1')?.room).toBe('meet')
  run(office, [boss, done], 100, 40_000)
  expect(office.whereIs('a1')).toBeNull()
})
