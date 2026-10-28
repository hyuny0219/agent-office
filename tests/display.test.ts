// 테스트: 표·패널 줄·문서 블록.
import { expect, test } from 'claude-code/testing'

import { emptyBook, hire } from '../core/hr'
import { fitParts, rowsOf, widthOf } from '../hooks/view'
import { mdOf, tableLines, textOf } from '../core/table'
import { modelLabel } from '../core/tokens'
import { agent, boss } from './kit'

test('표: 한글은 두 칸으로 세어 칸을 맞추고, 수는 오른쪽에, 줄 끝 빈칸은 남기지 않는다', () => {
  expect(tableLines(['부서', '건수', '비고'], [['개발팀', '3', '재작업 1'], ['QA', '12', '']], ['l', 'r', 'l'])).toEqual([
    '부서    건수  비고',
    '──────  ────  ────────',
    '개발팀     3  재작업 1',
    'QA        12',
  ])
  // 셀 안의 줄바꿈·탭은 한 칸으로, 긴 글은 칸 수로 잘라 …, 모자란 칸은 빈칸, 끝 칸이 수면 채운다
  expect(tableLines(['일', '수'], [['고치기\n\t둘째 줄 아주 긴 설명입니다', '7'], ['짧음']], ['l', 'r'], [12])).toEqual([
    '일            수',
    '────────────  ──',
    '고치기 둘째…   7',
    '짧음',
  ])
})

test('패널 줄: 모델을 짧게 적고, 폭이 모자라면 덜 중요한 칸부터 줄이며, 누구·어디서·맡은 일은 남긴다', () => {
  expect(modelLabel('claude-opus-5-5-20261001')).toBe('Opus 5.5')
  expect(modelLabel('claude-haiku-4-5@20251001')).toBe('Haiku 4.5')
  expect(modelLabel('claude-fable-5-1[1m]')).toBe('Fable 5.1')
  expect(modelLabel('claude-opus-5')).toBe('Opus 5')
  expect(modelLabel('claude-3-5-sonnet-20241022')).toBe('Sonnet 3.5')
  expect(modelLabel('sonnet')).toBe('Sonnet')
  // 날짜를 버전으로 읽지 않고, 다른 이름 속 계열 낱말은 잡지 않는다
  expect(modelLabel('claude-3-opus-20240229')).toBe('Opus 3')
  expect(modelLabel('claude-opus-20261001')).toBe('Opus')
  expect(modelLabel('claude-opus-5-10')).toBe('Opus 5.10')
  expect(modelLabel('us.anthropic.claude-sonnet-4-5-20250929-v1:0')).toBe('Sonnet 4.5')
  expect(modelLabel('magnumopus-7b')).toBe('magnumopus-7')
  expect(widthOf('😀')).toBe(2)
  expect(modelLabel('gpt-something-long')).toBe('gpt-somethin')
  expect(widthOf('BEAR 곰')).toBe(7)
  const tokens = { input: 15000, output: 5000, cacheRead: 0, cacheWrite: 0, usd: 0.08, unpriced: 0 }
  const a = agent('a1', { model: 'claude-opus-5-5', tools: 12, errors: 2, tokens, description: '빌드 스크립트 정리하기', startedAt: 0 })
  const b = emptyBook()
  // 넓으면 다 보인다
  expect(rowsOf([a], b, 180_000)[0]?.text).toBe('BEAR 곰 사원 (개발팀) · 작성 중 Edit · Opus 5.5 · 도구 12회 · 토큰 20.0k($0.08) · 오류 2 · 3분 · 빌드 스크립트 정리하기')
  // 좁으면 도구 수·시간을 빼고 토큰은 비용만, 한글 별명을 빼고, 더 좁으면 오류·비용·모델 순으로 뺀다
  expect(rowsOf([a], b, 180_000, 80)[0]?.text).toBe('BEAR 사원 (개발팀) · 작성 중 Edit · Opus 5.5 · $0.08 · 오류 2 · 빌드 스크립트 정리하기')
  expect(rowsOf([a], b, 180_000, 64)[0]?.text).toBe('BEAR 사원 (개발팀) · 작성 중 Edit · Opus 5.5 · 빌드 스크립트 정리하기')
  expect(rowsOf([a], b, 180_000, 30)[0]?.text).toBe('BEAR 사원 (개발팀) · 작성 중 Edit · 빌드 스크립트 정리하기')
  // 근태 경고는 빼지 않는다
  expect(fitParts([{ key: 'who', full: 'BEAR' }, { key: 'signs', full: '야근' }, { key: 'tools', full: '도구 9회' }], '일', 10)).toBe('BEAR · 야근 · 일')
})

test('문서 블록: 같은 내용을 글(칸 맞춘 표)과 마크다운(표·제목·글머리)으로 그린다', () => {
  const blocks = [
    { t: 'title', text: '보고' }, { t: 'line', text: '업무 2건' }, { t: 'gap' }, { t: 'section', text: '부서별' },
    { t: 'table', head: ['부서', '건수'], rows: [['개발팀', '2'], ['a|b', '1']], align: ['l', 'r'] },
    { t: 'bullet', text: '하나' }, { t: 'bullet', text: '둘' }, { t: 'field', label: '경력', value: '13' },
  ] as const
  expect(textOf(blocks)).toBe(['보고', '업무 2건', '', '■ 부서별', '부서    건수', '──────  ────', '개발팀     2', 'a|b        1', '- 하나', '- 둘', '경력        13'].join('\n'))
  expect(mdOf(blocks)).toBe(['## 보고', '업무 2건', '### 부서별', '| 부서 | 건수 |\n| --- | ---: |\n| 개발팀 | 2 |\n| a\\|b | 1 |', '- 하나\n- 둘', '**경력** 13'].join('\n\n'))
  // 마크다운: 제어 문자는 지우고 문법 글자는 이스케이프하며, 이름표는 줄바꿈으로 잇고, 빈 셀·잘린 셀도 표 모양을 지킨다
  expect(mdOf([{ t: 'line', text: 'fix __init__ *now*\x1b[31m!\x07' }])).toBe('fix \\_\\_init\\_\\_ \\*now\\*!')
  expect(mdOf([{ t: 'field', label: '경력', value: '13' }, { t: 'field', label: '연봉', value: '4,980만원' }])).toBe('**경력** 13  \n**연봉** 4,980만원')
  expect(mdOf([{ t: 'table', head: ['업무', '수'], rows: [['아주 긴 업무 설명입니다\n둘째', ''], ['짧음']], align: ['l', 'r'], max: [10] }]))
    .toBe('| 업무 | 수 |\n| --- | ---: |\n| 아주 긴… |  |\n| 짧음 |  |')
  expect(mdOf([{ t: 'line', text: '- 줄' }, { t: 'bullet', text: '항목' }])).toBe('\\- 줄\n\n- 항목')
})

test('상황판: 같은 직원이 일을 여러 번 했어도 한 줄(일하는 중이면 그 일, 아니면 가장 최근 일)', () => {
  const owl = (id: string, startedAt: number, endedAt: number | null, description: string) => agent(id, { nick: 'OWL', dept: 'research', startedAt, endedAt, description, activity: endedAt === null ? 'read' : 'done' })
  const b = hire(emptyBook(), 'OWL', 'research', 'Explore', 0).book
  const done = rowsOf([boss, owl('o1', 1000, 2000, '첫 일'), owl('o2', 3000, 4000, '둘째 일')], b, 10_000)
  expect(done.map(r => r.key)).toEqual(['row-main', 'row-o2'])
  expect(done[1]?.isOff).toBe(true)
  const live = rowsOf([boss, owl('o1', 1000, 2000, '첫 일'), owl('o3', 5000, null, '지금 일'), owl('o2', 3000, 4000, '둘째 일')], b, 10_000)
  expect(live.map(r => r.key)).toEqual(['row-main', 'row-o3'])
  expect(live[1]?.text).toContain('지금 일')
  // 같은 사람이 두 일을 하고 있으면(예전 기록 등) 둘 다 보인다(평면도와 같게)
  const two = rowsOf([boss, owl('o3', 5000, null, '지금 일'), owl('o4', 6000, null, '또 다른 일'), owl('o2', 3000, 4000, '둘째 일')], b, 10_000)
  expect(two.map(r => r.key)).toEqual(['row-main', 'row-o4', 'row-o3'])
})
