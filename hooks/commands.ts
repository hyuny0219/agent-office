// /office 명령: 글 답은 core/answer.ts(엔진과 무관), 여기서는 Claude Code의 저장소·시계를 이어 준다.
import type { EngineInterface } from 'claude-code'

import { answerWith } from '../core/answer'
import { agentsOf, hrOf, saveHr } from './store'

export { COMMAND, rankChangeText } from '../core/answer'

/** 글로 답할 하위 명령이면 그 답, 패널을 열 명령이면 null */
export async function answer($: EngineInterface, args: string): Promise<string | null> {
  return answerWith({ book: () => hrOf($), save: fn => saveHr($, fn), agents: () => agentsOf($), now: () => $.clock.now() }, args)
}
