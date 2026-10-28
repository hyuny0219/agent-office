// /office 명령: 글 답은 core/answer.ts(엔진과 무관), 여기서는 Claude Code의 저장소·시계·파일 쓰기를 이어 준다.
import type { EngineInterface } from 'claude-code'

import { answerWith } from '../core/answer'
import { agentsOf, hrOf, journalEntries, saveHr } from './store'

export { COMMAND, rankChangeText } from '../core/answer'

/** 내보내기 기본 폴더(세션 폴더 아래) */
export const EXPORT_DIR = 'agent-office-export'

/**
 * 내보낼 파일을 쓴다: 폴더를 주지 않으면 세션 폴더의 agent-office-export/에(그 폴더에는 모두 무시하는 .gitignore를 함께 둬
 * 인사 기록이 저장소에 커밋되지 않게 한다). 쓴 절대 경로를 돌려준다
 */
async function writeFiles($: EngineInterface, files: readonly { name: string; text: string }[], dir: string | null): Promise<string[]> {
  // 홈 폴더를 알 길이 없어 ~는 펴지 않는다(세션 폴더 아래에 ~라는 폴더를 만들지 않도록 거절한다)
  if (dir !== null && dir.startsWith('~')) throw new Error('~는 쓸 수 없습니다. 절대 경로(/Users/…)로 적어 주세요')
  const cwd = await $.session.cwd()
  const base = dir ?? EXPORT_DIR
  const root = /^([A-Za-z]:)?[\\/]/.test(base) ? base : `${cwd.replace(/[\\/]$/, '')}/${base}`
  if (dir === null) await $.fs.write(`${root}/.gitignore`, '# agent-office 내보내기: 인사 기록이 저장소에 들어가지 않게 모두 무시한다\n*\n')
  const out: string[] = []
  for (const f of files) {
    const path = `${root.replace(/[\\/]$/, '')}/${f.name}`
    await $.fs.write(path, f.text)
    out.push(path)
  }
  return out
}

/** 글로 답할 하위 명령이면 그 답, 패널을 열 명령이면 null */
export async function answer($: EngineInterface, args: string): Promise<string | null> {
  return answerWith({ book: () => hrOf($), save: fn => saveHr($, fn), agents: () => agentsOf($), now: () => $.clock.now(), write: (files, dir) => writeFiles($, files, dir), journal: () => journalEntries($) }, args)
}
