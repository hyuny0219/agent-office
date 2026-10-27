// 테스트: 사내 대화.
import { expect, test } from 'claude-code/testing'

import { asciiOf, BUBBLE_MS, isSpeaking, lineText, messageOf, oopsOf, orderOf, pushLine, FEED_MAX, selfTalkOf } from '../core/speech'
import { layoutOf, Office } from '../core/scene'
import { agent, boss, run, screen } from './kit'

test('사내 대화: 도구마다 짧은 영문 혼잣말, 설명 있는 명령·실수·지시·메시지는 메신저 한 줄, 말풍선은 잠깐 뜬다', () => {
  expect(selfTalkOf('BEAR', { tool: 'Edit', file_path: '/r/hooks/hr.ts' }, 0).bubble.text).toBe('edit hr.ts')
  const bash = selfTalkOf('BEAR', { tool: 'Bash', command: 'npm test -- --watch=false', description: '테스트 돌려 보기' }, 5)
  expect(bash.bubble.text).toBe('$ npm')
  // 명령 인자·주소의 경로는 말풍선에 싣지 않고(비밀이 섞일 수 있다), 메신저 글은 제어 문자를 지우고 비밀을 가린다
  expect(selfTalkOf('BEAR', { tool: 'Bash', command: 'TOKEN=sk-abc curl -H x' }, 0).bubble.text).toBe('$ curl')
  expect(selfTalkOf('BEAR', { tool: 'WebFetch', url: 'https://docs.example.com/a?key=1' }, 0).bubble.text).toBe('web docs.exam~')
  expect(oopsOf('BEAR', 'Bash', '\x1b[31m(fail)\x1b[0m Authorization: Bearer abc123 \u202Eevil', 0).line.text).toBe('앗, Bash 실패 — (fail) Authorization: Bearer *** evil')
  expect(messageOf('BEAR', 'OWL', { message: 'api_key=sk-live_0123456789 쓰세요' }, 0).line.text).toBe('api_key=*** 쓰세요')
  expect(messageOf('BEAR', 'OWL', { message: 'token 만료로 실패, password reset 메일' }, 0).line.text).toBe('token 만료로 실패, password reset 메일')
  expect(bash.line).toEqual({ at: 5, kind: 'self', from: 'BEAR', text: '테스트 돌려 보기' })
  expect(selfTalkOf('BEAR', { tool: 'Read', file_path: '/r/a.ts' }, 0).line).toBeNull()
  // 윈도우: PowerShell도 Bash처럼 앞 낱말과 설명을 쓰고, 경로는 \\로도 자른다
  const ps = selfTalkOf('BEAR', { tool: 'PowerShell', command: 'Get-ChildItem -Recurse', description: '파일 목록 보기' }, 5)
  expect([ps.bubble.text, ps.line?.text]).toEqual(['$ Get-ChildIt~', '파일 목록 보기'])
  expect(selfTalkOf('BEAR', { tool: 'Edit', file_path: 'C:\\r\\hooks\\hr.ts' }, 0).bubble.text).toBe('edit hr.ts')
  expect(selfTalkOf('OWL', { tool: 'mcp__claude_ai_Exa__web_search_exa' }, 0).bubble.text).toBe('web_search_exa')
  // 한글만 있으면 평면도에 못 그리니 대신할 말
  expect(asciiOf('한글 설명', '...')).toBe('...')
  const oops = oopsOf('BEAR', 'Bash', 'Exit code 1\nFAIL src/a.test.ts', 0)
  expect([oops.bubble.text, oops.bubble.tone, oops.line.text]).toEqual(['oops!', 'bad', '앗, Bash 실패 — FAIL src/a.test.ts'])
  // 지시에서 인사 메모는 빼고 보인다
  const order = orderOf('BOSS', 'BEAR', 'T139 빌드', '만들어\n\n[사내 인사 메모 · agent-office]\n담당', 0)
  expect([order.bubble.text, order.line.text, order.line.to]).toEqual(['BEAR, go!', 'T139 빌드 — 만들어', 'BEAR'])
  expect(messageOf('BEAR', 'OWL', { message: '자료 좀 찾아 줘' }, 0).line.text).toBe('자료 좀 찾아 줘')
  expect(lineText(order.line, 12_000)).toBe('12초 전 BOSS → BEAR (지시): T139 빌드 — 만들어')
  expect(lineText(oops.line, 0)).toBe('0초 전 BEAR: 앗, Bash 실패 — FAIL src/a.test.ts')
  expect(isSpeaking({ text: 'x', at: 0, tone: 'self' }, BUBBLE_MS - 1)).toBe(true)
  expect(isSpeaking({ text: 'x', at: 0, tone: 'self' }, BUBBLE_MS)).toBe(false)
  let feed = [order.line]
  for (let i = 0; i < FEED_MAX + 5; i++) feed = pushLine(feed, oops.line)
  expect(feed).toHaveLength(FEED_MAX)

  // 평면도: 말하는 동안 머리 위에 말풍선, 지나면 사라진다
  const office = new Office(layoutOf(96))
  const talking = [boss, agent('a1', { activity: 'type', say: { text: 'edit hr.ts', at: 0, tone: 'self' } })]
  expect(screen(run(office, talking, 80, 0), 96)).toContain(' edit hr.ts ')
  expect(screen(run(office, talking, 2, BUBBLE_MS), 96)).not.toContain('edit hr.ts')
  // 회의실: 위쪽 자리 사람도(머리 위가 제목·방 이름 줄이면 발밑에), 붙어 앉은 두 사람의 말풍선이 겹치지 않고 다 보인다
  const meeting = new Office(layoutOf(96))
  const pair = [{ ...boss, meetUntil: 99_999, meetWith: 'OWL', say: { text: 'OWL, go!', at: 0, tone: 'talk' as const } },
    agent('o1', { type: 'Explore', nick: 'OWL', dept: 'research', activity: 'think', meetUntil: 99_999, meetWith: 'BOSS', say: { text: 'yes!', at: 0, tone: 'talk' } }),
    agent('o2', { type: 'Explore', nick: 'FOX', dept: 'research', activity: 'think', meetUntil: 99_999, meetWith: 'BOSS', say: { text: 'hmm', at: 0, tone: 'talk' } })]
  const met = screen(run(meeting, pair, 120, 0), 96)
  expect(met).toContain(' OWL, go! ')
  expect(met).toContain(' yes! ')
  expect(met).toContain(' hmm ')
})
