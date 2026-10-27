// 테스트: 근태(연달아 세기·문턱).
import { expect, test } from 'claude-code/testing'

import { OVERTIME_MS, attend, callKeyOf, errorKeyOf, isAlarm, isOvertime, isPolling, nudgeOf, stepOf } from '../core/watch'
import { agent } from './kit'

test('근태: 같은 것을 연달아 세고, 문턱과 그 배수마다 알리며, 호출 열쇠는 겉봉 칸을 빼고 입력만 본다', () => {
  let s = stepOf(undefined, 'a')
  s = stepOf(s, 'a')
  expect(isAlarm(s, 3)).toBe(false)
  s = stepOf(s, 'a')
  expect(isAlarm(s, 3)).toBe(true)
  expect(isAlarm(stepOf(s, 'a'), 3)).toBe(false)
  expect(stepOf(s, 'b')).toEqual({ key: 'b', count: 1 })
  expect(callKeyOf({ tool: 'Read', file_path: '/a', agentId: 'x', tool_use_id: '1' })).toBe(callKeyOf({ tool: 'Read', agentId: 'y', tool_use_id: '2', file_path: '/a' }))
  expect(callKeyOf({ tool: 'Read', file_path: '/a' })).not.toBe(callKeyOf({ tool: 'Read', file_path: '/b' }))
  // 경로·숫자만 다른 오류는 같은 실수
  expect(errorKeyOf('Read', 'ENOENT: no such file /a/b line 3')).toBe(errorKeyOf('Read', 'ENOENT: no such file /c line 9'))
  // Bash는 "Exit code N" 줄을 건너뛰고 명령 이름으로 가른다
  expect(errorKeyOf('Bash', 'Exit code 1\nFAIL src/a.test.ts', { command: 'npm test' })).toBe('Bash|npm: FAIL src<경로>')
  expect(errorKeyOf('Bash', 'Exit code 1', { command: 'grep foo .' })).not.toBe(errorKeyOf('Bash', 'Exit code 1', { command: 'CI=1 npm test' }))
  expect(errorKeyOf('Bash', 'Exit code 1', { command: 'CI=1 npm test' })).toBe('Bash|npm: ')
  expect(errorKeyOf('PowerShell', 'Exit code 1', { command: 'npm test' })).toBe('PowerShell|npm: ')
  const nudge = nudgeOf('error', 'Edit', { key: errorKeyOf('Edit', 'String to replace not found in file.'), count: 3 })
  expect(nudge).toContain('같은 오류가 3번 연달아')
  expect(nudge).toContain('Read로 다시 읽어')
  expect(nudge).toContain('보고하고 끝내세요')
  expect(isPolling('TaskGet')).toBe(true)
  expect(isPolling('Grep')).toBe(false)
  expect(isOvertime(0, null, OVERTIME_MS)).toBe(true)
  expect(isOvertime(0, 5, OVERTIME_MS)).toBe(false)
})

test('근태 판정(두 판 공통): 같은 오류 3번째에 헛손질, 같은 호출 4번째에 제자리걸음, 성공하면 그 도구의 오류 연속은 끊기고, 기다리는 도구는 세지 않는다', () => {
  let a = agent('c1', { nick: 'BEAR' })
  const kinds: (string | null)[] = []
  for (let i = 0; i < 3; i++) {
    const r = attend(a, { tool: 'Bash', command: 'cat /no/such' }, true, 'cat: /no/such: No such file or directory')
    kinds.push(r.kind)
    a = r.agent
  }
  expect(kinds).toEqual([null, null, 'error'])
  expect(a.alarms).toBe(1)
  // 성공하면 그 도구의 오류 연속이 끊긴다
  a = attend(a, { tool: 'Bash', command: 'ls' }, false, '').agent
  expect(a.errStreaks?.Bash).toBeUndefined()
  // 같은 입력을 되풀이하면 4번째에 제자리걸음
  const reps: (string | null)[] = []
  for (let i = 0; i < 4; i++) {
    const r = attend(a, { tool: 'Read', file_path: '/a.ts' }, false, '')
    reps.push(r.kind)
    a = r.agent
  }
  expect(reps).toEqual([null, null, null, 'repeat'])
  expect(a.alarms).toBe(2)
  // 상태를 묻는 도구는 되풀이해도 세지 않는다
  let w = agent('c2')
  for (let i = 0; i < 8; i++) w = attend(w, { tool: 'TaskOutput', task_id: 'x' }, false, '').agent
  expect(w.alarms ?? 0).toBe(0)
})
