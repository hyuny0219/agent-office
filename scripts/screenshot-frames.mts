// README 스크린샷용 장면. mod의 scene.ts를 그대로 돌려 프레임마다 셀을 뽑아 JSON으로 쓴다.
// 사용: npx tsx scripts/screenshot-frames.mts > frames.json  (그다음 scripts/render-screenshot.py)
import type { OfficeAgent } from '../types'
import { Office, layoutOf } from '../hooks/scene.ts'

const COLUMNS = 96
const FRAMES = 90

const mk = (id: string, type: string, nick: string, dept: OfficeAgent['dept'], activity: OfficeAgent['activity'], tool: string | null, over: Partial<OfficeAgent> = {}): OfficeAgent =>
  ({ id, type, nick, dept, description: '', model: null, startedAt: 0, endedAt: null, activity, tool, tools: 7, ...over })

/** 프레임 f에서의 사무실 사람들: 회의, 각자 일, 새로 들어오는 사람, 방을 옮기는 사람 */
const cast = (f: number): OfficeAgent[] => {
  const list = [
    mk('main', 'main', 'BOSS', undefined, 'spawn', 'Agent', { meetUntil: 1e9 }),
    mk('fox', 'planner', 'FOX', 'plan', 'think', null, { meetUntil: 1e9 }),
    mk('bear', 'builder', 'BEAR', 'dev', 'type', 'Edit'),
    mk('panda', 'general-purpose', 'PANDA', 'dev', 'web', 'WebFetch'),
    mk('owl', 'Explore', 'OWL', 'research', 'read', 'Grep'),
    mk('whale', 'document-specialist', 'WHALE', 'research', 'type', 'Write'),
    // 매는 서버실에서 테스트를 돌리다가 자리로 돌아와 고친다
    mk('hawk', 'reviewer', 'HAWK', 'qa', f < 45 ? 'bash' : 'type', f < 45 ? 'Bash' : 'Edit'),
    mk('cat', 'verifier', 'CAT', 'qa', 'think', null),
    mk('crane', 'writer', 'CRANE', 'docs', 'idle', null),
  ]
  // 수달은 조금 늦게 출근해 입구에서 걸어 들어온다
  if (f >= 6) list.push(mk('otter', 'debugger', 'OTTER', 'dev', 'type', 'Edit'))
  return list
}

const layout = layoutOf(COLUMNS)
const office = new Office(layout)
const leads = { dev: 'BEAR', research: 'OWL', qa: 'HAWK', plan: 'FOX', docs: 'CRANE' } as const
const frames: string[] = []
for (let f = 0; f < FRAMES; f++) {
  const words = office.draw(cast(f), f, 1000, leads)
  frames.push(Buffer.from(words.buffer, words.byteOffset, words.byteLength).toString('base64'))
}

// 패널 아래 목록(실제 패널과 같은 문구)
const list = [
  'BOSS 보스 대표 · 회의실: 여우와 대화 · 도구 7회 · 12분 · 메인 대화',
  'BEAR 곰 과장·팀장 (개발팀) · 작성 중 Edit · 도구 31회 · 8분 · 결제 모듈 리팩터링',
  'OWL 부엉이 대리·팀장 (조사팀) · 자료실 Grep · 도구 18회 · 5분 · 호출부 조사',
  'HAWK 매 대리·팀장 (품질팀) · 작성 중 Edit · 도구 22회 · 6분 · 리뷰 지적 반영',
  'OTTER 수달 사원 (개발팀) · 작성 중 Edit · 도구 4회 · 1분 · 실패 테스트 고치기',
]
process.stdout.write(JSON.stringify({ columns: layout.columns, rows: layout.rows, frames, list }))
