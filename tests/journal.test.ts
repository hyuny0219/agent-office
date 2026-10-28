// 테스트: 업무 일지(실제로 한 일의 보고서).
import { expect, test } from 'claude-code/testing'

import type { JobRecord, JournalEntry } from '../types'
import { emptyBook, hire, record } from '../core/hr'
import { addEntry, dayBlocks, dayOf, entryOf, journalBlocks, journalOf, journalViewFor, journalViewOf, MAX_ENTRIES, noteApproval, REPORT_MAX, reportOf } from '../core/journal'
import { mdOf, textOf } from '../core/table'
import { agent } from './kit'

const NOW = new Date(2026, 9, 28, 15, 0).getTime()
const MIN = 60_000

test('일지 항목: 고친 파일·확인 명령·오류·보고를 남기고, 보고는 비밀을 가리고 앞부분만, 같은 일이면 바꾸며 200건까지', () => {
  const a = agent('c1', { nick: 'BEAR', dept: 'dev', description: '로그인 버그 고치기', startedAt: NOW - 12 * MIN, files: ['/r/src/login.ts', '/r/src/login.test.ts'],
    checks: [{ cmd: 'npm test', result: 'pass', tail: '12 passed' }], errLines: ['Edit: string to replace not found'] })
  const e = entryOf(a, 3, 'done', NOW, '로그인 버그를 고쳤습니다.\napi_key=sk-abcdefghijklmnop 를 지웠습니다.\n\n\n\n테스트 통과.')
  expect([e.nick, e.dept, e.job, e.outcome, e.files.length, e.checks[0]?.result, e.errors[0]]).toEqual(['BEAR', 'dev', 3, 'done', 2, 'pass', 'Edit: string to replace not found'])
  expect(e.report).not.toContain('sk-abcdefghijklmnop')
  expect(e.report).toContain('api_key=***')
  expect(e.report).not.toContain('\n\n\n')
  expect(Array.from(reportOf('가'.repeat(REPORT_MAX + 50))).length).toBe(REPORT_MAX)
  // 같은 사람·같은 일은 바꾸고, 최근 것이 앞
  let list: JournalEntry[] = addEntry([], e)
  list = addEntry(list, { ...e, job: 4, endedAt: NOW + MIN })
  list = addEntry(list, { ...e, report: '고쳐 씀' })
  expect(list.map(x => [x.job, x.report])).toEqual([[3, '고쳐 씀'], [4, e.report]])
  let many: JournalEntry[] = []
  for (let i = 0; i < MAX_ENTRIES + 5; i++) many = addEntry(many, { ...e, job: i })
  expect(many.length).toBe(MAX_ENTRIES)
  // 결재 의견(비밀은 가림)
  expect(noteApproval(list, 'BEAR', 4, ['테스트 결과를 적을 것', 'token=abcdef123456'])[1]?.approvalNotes).toEqual(['테스트 결과를 적을 것', 'token=***'])
  // 저장했다 읽어도 남고, 모양이 틀린 항목은 버린다
  const back = journalOf(JSON.parse(JSON.stringify([...list, { nick: 3 }, 'x', { nick: 'OWL', job: 1, checks: [{ cmd: 'x', result: 'nope', tail: '' }], files: [1, 'a.ts'] }])))
  expect(back.length).toBe(3)
  expect(back[2]?.checks).toEqual([])
  expect(back[2]?.files).toEqual(['a.ts'])
  expect(journalOf('x')).toEqual([])
})

test('일지 보고서: 기간·사람으로 골라 누가 무엇을 했는지(결과·평가·결재·대표 평가·파일·확인·오류·보고)를 날짜별로 엮는다', () => {
  let book = hire(emptyBook(), 'BEAR', 'dev', 'builder', 0).book
  const rec = (job: number, over: Partial<JobRecord> = {}): JobRecord => ({ nick: 'BEAR', dept: 'dev', job, description: '', startedAt: 0, endedAt: 0, outcome: 'done', score: 13, errors: 0, isCheckFailed: false, isReworked: false, alarms: 0, ...over })
  book = record(record(book, rec(1, { approval: 'rejected', approver: 'BOSS', score: 6 })), rec(2, { bossRating: 'good', isReworked: true }))
  const base = entryOf(agent('c1', { nick: 'BEAR', dept: 'dev', startedAt: NOW - 30 * MIN }), 1, 'done', NOW - 20 * MIN, '고쳤습니다\n- 목록 같은 줄')
  const first = { ...base, description: '로그인 버그 고치기', files: ['/r/src/login.ts'], checks: [{ cmd: 'npm test', result: 'fail' as const, tail: '1 failed' }], approvalNotes: ['테스트를 다시 돌릴 것'] }
  const yesterday = { ...base, job: 2, description: '문서 정리', endedAt: NOW - 26 * 60 * MIN, startedAt: NOW - 27 * 60 * MIN }
  const entries = [first, yesterday]
  const today = textOf(journalBlocks(book, entries, NOW, 'today'))
  expect(today).toContain('업무 일지: 오늘 (최근 24시간)')
  expect(today).toContain('끝낸 일 1건(완료 1 · 실패·중단 0) · 고친 파일 1개 · 확인 실패가 있던 일 1건')
  expect(today).toContain(`── ${dayOf(NOW)} ──`)
  expect(today).toMatch(/■ \d\d:\d\d BEAR 사원 \(개발팀\) — 로그인 버그 고치기/)
  expect(today).toContain('- 결과: 완료 · 10분 · 평가 B(+6)')
  expect(today).toContain('- 결재: 반려(BOSS) — 테스트를 다시 돌릴 것')
  expect(today).toContain('- 고친 파일 1개: src/login.ts')
  expect(today).toContain('- 확인: npm test — 실패 (1 failed)')
  expect(today).toContain('> 고쳤습니다')
  expect(today).not.toContain('문서 정리')
  const week = textOf(journalBlocks(book, entries, NOW, 'week'))
  expect(week).toContain('문서 정리')
  expect(week).toContain('- 대표 평가: 좋음 · 끝낸 뒤 BOSS가 다시 고침(재작업)')
  expect(textOf(journalBlocks(book, entries, NOW, { nick: 'bear' }))).toContain('업무 일지: BEAR (최근 2건)')
  expect(textOf(journalBlocks(book, [], NOW, 'today'))).toContain('이 기간에 끝낸 일이 없습니다')
  // 마크다운: 직원 보고는 줄마다 끊은 인용으로(링크·강조 같은 서식 글자는 이스케이프된다)
  const md = mdOf(journalBlocks(book, entries, NOW, 'today'))
  expect(md).toContain('> 고쳤습니다  \n> \\- 목록 같은 줄')
  expect(mdOf([{ t: 'quote', lines: ['[링크](http://x) **굵게**'] }])).not.toContain('[링크](http://x)')
  // 하루치 파일
  expect(textOf(dayBlocks(book, entries, dayOf(NOW)))).toContain(`업무 일지 ${dayOf(NOW)}`)
})

test('일지 경계: 업무 설명·파일 경로도 비밀을 가리고 자르며, 사람별 보기는 그 사람만, 화면 이름을 읽고, 옮긴 글의 서식·주소는 끊는다', () => {
  const a = agent('c1', { nick: 'BEAR', dept: 'dev', description: `배포 API_KEY=sk-live-abcdef0123456 ${'긴'.repeat(300)}`, files: ['/r/token=abcdef123456/x.ts'] })
  const e = entryOf(a, 1, 'done', NOW, '보고', 'qa')
  expect(e.description).not.toContain('sk-live-abcdef0123456')
  expect(Array.from(e.description).length).toBe(200)
  expect(e.files[0]).toContain('token=***')
  expect(e.dept).toBe('qa')
  const book = hire(hire(emptyBook(), 'BEAR', 'dev', 'builder', 0).book, 'OWL', 'research', 'Explore', 0).book
  const owl = { ...e, nick: 'OWL', dept: 'research' as const, description: 'OWL 일' }
  const bearOnly = textOf(journalBlocks(book, [owl, { ...e, description: 'BEAR 일' }], NOW, { nick: 'bear' }))
  expect(bearOnly).toContain('BEAR 일')
  expect(bearOnly).not.toContain('OWL 일')
  expect([journalViewFor(undefined), journalViewFor('week'), journalViewFor('owl'), journalViewFor('이상'), journalViewFor('save')]).toEqual(['journal', 'journal:week', 'journal:OWL', null, null])
  expect([journalViewOf('journal'), journalViewOf('journal:week'), journalViewOf('journal:OWL'), journalViewOf('hr')]).toEqual(['today', 'week', { nick: 'OWL' }, null])
  const md = mdOf([{ t: 'quote', lines: ['제목', '===', '- 목록', '1. 번호', 'https://evil.example/login'] }])
  expect(md).toContain('> \\===')
  expect(md).toContain('> \\- 목록')
  expect(md).toContain('> 1\\. 번호')
  expect(md).not.toContain('https://')
  // 파일로 쓸 때는 화면 한도로 자르지 않는다
  const long = Array.from({ length: 2000 }, (_, i) => ({ t: 'line' as const, text: `줄 ${i} ${'가'.repeat(60)}` }))
  expect(mdOf(long)).toContain('…(잘림)')
  expect(mdOf(long, Infinity)).not.toContain('…(잘림)')
})
