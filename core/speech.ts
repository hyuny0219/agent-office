// 사내 대화. 직원들이 일하며 하는 말을 만든다: 평면도 머리 위에 잠깐 뜨는 짧은 말풍선(영문, 평면도 글자는 영문뿐)과
// 평면도 아래 사내 메신저에 남는 한 줄(한글). 지시·보고·메시지·혼잣말·실수·결재. 순수 함수만 둔다.
import type { Bubble, CheckRun, Utterance, UtteranceKind } from '../types'
import { isCheckSegment, isShell, segmentsOf } from './watch'

/** 말풍선이 떠 있는 시간 */
export const BUBBLE_MS = 3500
/** 말풍선 글자 수 */
export const BUBBLE_CHARS = 14
/** 메신저에 남기는 줄 수 */
export const FEED_MAX = 40
const LINE_CHARS = 90

const baseName = (f: string): string => f.split(/[\\/]/).pop() ?? f
/**
 * 화면에 보일 글을 다듬는다: 터미널 제어 문자(색·커서 이동)와 글 방향 뒤집기를 지우고,
 * 비밀처럼 보이는 값(토큰·키·암호·Authorization)은 가린다. 메신저는 다른 mod도 읽는 세션 상태다.
 */
export const scrub = (s: string): string =>
  s.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/[\x00-\x08\x0b-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g, '')
    // Authorization: <방식> <값>: 방식은 두고 값을 가린다
    .replace(/\b(authorization\s*[:=]\s*)(?:(basic|bearer|token|digest)\s+)?[^\s"']+/gi, (_m, head: string, scheme?: string) => `${head}${scheme === undefined ? '' : `${scheme} `}***`)
    // 이름=값·이름: 값만 가린다("token 만료" 같은 평범한 말은 두고), Bearer 뒤는 값처럼 생겼을 때만
    .replace(/\b(token|secret|password|passwd|api[_-]?key)(\S*?)(\s*[:=]\s*)(["']?)(?!\*\*\*)[^\s"']+/gi, '$1$2$3$4***')
    .replace(/\b(bearer\s+)(?!\*\*\*)[A-Za-z0-9._~+/=-]{8,}/gi, '$1***')
    .replace(/\b(sk|pk|ghp|gho|xox[abp])[-_][A-Za-z0-9_-]{8,}/g, '***')
/** 한 줄로 줄여 앞부분만 */
export const headOf = (s: string, n = LINE_CHARS): string => {
  const one = Array.from(scrub(s).replace(/\s+/g, ' ').trim())
  return one.length <= n ? one.join('') : `${one.slice(0, n - 1).join('')}…`
}
/** 평면도에 그릴 수 있는 글자만 남긴다(영문·숫자·기호). 남는 게 없으면 대신할 말 */
export const asciiOf = (s: string, or: string, n = BUBBLE_CHARS): string => {
  const t = scrub(s).replace(/[^\x20-\x7e]/g, '').replace(/\s+/g, ' ').trim()
  const kept = t.length >= 2 ? t : or
  return kept.length <= n ? kept : `${kept.slice(0, n - 1)}~`
}

const said = (at: number, kind: UtteranceKind, from: string, text: string, to?: string): Utterance =>
  ({ at, kind, from, text: headOf(text), ...(to === undefined ? {} : { to }) })

const str = (x: unknown): string => (typeof x === 'string' ? x : '')

/**
 * 도구를 부를 때 하는 혼잣말: 말풍선은 늘, 메신저 줄은 말로 된 설명이 있을 때만(Bash·PowerShell의 description).
 * 도구마다 무엇을 하는지 짧게.
 */
export function selfTalkOf(nick: string, e: { tool: string } & object, at: number): { bubble: Bubble; line: Utterance | null } {
  const x = e as Record<string, unknown>
  const file = baseName(str(x.file_path) || str(x.notebook_path) || str(x.path))
  const bub = (s: string): Bubble => ({ text: asciiOf(s, '...'), at, tone: 'self' })
  const desc = str(x.description)
  let bubble: Bubble
  switch (e.tool) {
    // 명령은 앞 낱말만(인자에 비밀이 섞일 수 있다): 환경 변수 대입은 건너뛴다
    case 'Bash': case 'PowerShell': bubble = bub(`$ ${str(x.command).trim().split(/\s+/).find(w => !w.includes('=')) ?? ''}`); break
    case 'Edit': case 'Write': case 'NotebookEdit': bubble = bub(`edit ${file}`); break
    case 'Read': bubble = bub(`read ${file}`); break
    case 'Grep': bubble = bub(`grep ${str(x.pattern)}`); break
    case 'Glob': bubble = bub(`find ${str(x.pattern)}`); break
    case 'WebSearch': bubble = bub(`web ${str(x.query)}`); break
    case 'WebFetch': bubble = bub(`web ${(str(x.url).match(/^\w+:\/\/([^/?#]+)/) ?? [])[1] ?? ''}`); break
    case 'TodoWrite': case 'TaskCreate': case 'TaskUpdate': bubble = bub('todo...'); break
    default: bubble = bub(e.tool.startsWith('mcp__') ? (e.tool.split('__')[2] ?? 'mcp') : e.tool.toLowerCase())
  }
  // 말로 된 설명이 있는 도구만 메신저에 남긴다(모든 도구를 남기면 소음이다)
  const line = isShell(e.tool) && desc.trim() !== '' ? said(at, 'self', nick, desc) : null
  return { bubble, line }
}

/** 근거로 남길 한 줄: 공백·줄바꿈을 한 칸으로 접고 백틱은 '로 바꿔(칸을 깨거나 가짜 줄을 만들지 못하도록) 비밀을 가린다 */
const oneLine = (s: string, max: number): string => scrub(s.replace(/\s+/g, ' ').replace(/`/g, "'").trim()).slice(0, max)

/** 출력의 첫(또는 마지막) 의미 있는 줄: "Exit code N" 줄은 건너뛰고, 한 줄로, 비밀은 가리고 */
export function lineOf(text: string, which: 'first' | 'last', max = 120): string {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l !== '' && !/^exit code \d+$/i.test(l))
  return oneLine((which === 'first' ? lines[0] : lines[lines.length - 1]) ?? '', max)
}

/**
 * 명령 이름: 첫 줄을 &&·;로 나눠 확인(테스트·빌드)으로 보이는 조각(없으면 마지막 조각)에서, 환경 변수 대입을 건너뛰고
 * 앞 낱말을 세 개까지, 옵션·인자·특수 문자를 만나면 멈춘다(cd x && npm test → npm test, ./gradlew build → ./gradlew build).
 * 인자에 섞일 수 있는 비밀은 남기지 않고, 남은 것도 가린다
 */
export function commandNameOf(command: string): string {
  const segs = segmentsOf(command)
  const seg = segs.find(isCheckSegment) ?? segs[segs.length - 1] ?? ''
  const out: string[] = []
  for (const w of seg.split(/\s+/)) {
    if (out.length === 0 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(w)) continue
    if (!/^(\.{0,2}\/)?[A-Za-z0-9][\w.:/@+-]*$/.test(w) || w.includes('://') || out.length >= 3) break
    out.push(w)
  }
  const name = scrub(out.join(' ')).slice(0, 60)
  return name === '' ? '(명령)' : name
}

/** 테스트·빌드 명령 한 번의 기록(결재 근거). 종료 코드를 믿을 수 없는 명령은 "알 수 없음" */
export function checkRunOf(e: object, isFailed: boolean, text: string): CheckRun {
  const x = e as Record<string, unknown>
  const command = str(x.command)
  const isUnsure = x.run_in_background === true || /\|\||[^|]\|[^|]|;|\n|&\s*$/.test(command.trim())
  return { cmd: commandNameOf(command), result: isUnsure ? 'unsure' : isFailed ? 'fail' : 'pass', tail: lineOf(text, 'last', 80) }
}

/** 도구 오류 한 줄(결재 근거) */
export const errLineOf = (tool: string, text: string): string => `${tool}: ${lineOf(text, 'first')}`

/** 도구가 실패했을 때: 말풍선 oops!, 메신저에 무엇이 실패했는지 */
export function oopsOf(nick: string, tool: string, text: string, at: number): { bubble: Bubble; line: Utterance } {
  const why = text.split('\n').map(l => l.trim()).find(l => l !== '' && !/^exit code \d+$/i.test(l)) ?? ''
  return {
    bubble: { text: 'oops!', at, tone: 'bad' },
    line: said(at, 'error', nick, `앗, ${tool} 실패${why === '' ? '' : ` — ${why}`}`),
  }
}

/** 업무 지시: 띄운 쪽이 직원을 불러 맡긴다 */
export function orderOf(from: string, to: string, description: string, prompt: string, at: number, why: string | null = null): { bubble: Bubble; line: Utterance } {
  const body = prompt.split('\n\n[사내 인사 메모')[0] ?? prompt
  return {
    bubble: { text: asciiOf(`${to}, go!`, 'go!'), at, tone: 'talk' },
    line: said(at, 'order', from, `${description}${why === null ? '' : ` (배정: ${why})`}${body.trim() === '' ? '' : ` — ${body}`}`, to),
  }
}

/** 받는 쪽의 대답(지시받을 때 "넵!", 보고받을 때 "수고!") */
export const replyOf = (text: string, at: number): Bubble => ({ text, at, tone: 'talk' })

/** 끝낸 일의 보고 */
export function reportLineOf(from: string, to: string, answer: string, at: number): { bubble: Bubble; line: Utterance } {
  return {
    bubble: { text: 'done!', at, tone: 'good' },
    line: said(at, 'report', from, answer.trim() === '' ? '(보고 없이 끝냄)' : answer, to),
  }
}

/** SendMessage: 직원끼리 주고받는 메시지 */
export function messageOf(from: string, to: string, e: object, at: number): { bubble: Bubble; line: Utterance } {
  const x = e as Record<string, unknown>
  const body = str(x.message) || str(x.summary) || str(x.content)
  return {
    bubble: { text: asciiOf(`-> ${to}`, '->'), at, tone: 'talk' },
    line: said(at, 'message', from, body === '' ? '(메시지)' : body, to),
  }
}

/** 인사 발령(조직 개편 등): 인사팀이 알린다 */
export const hrLineOf = (text: string, at: number): Utterance => said(at, 'hr', '인사팀', text)

/** 결재·계획 검토 결과(결재자는 평면도에 없을 수 있어 메신저에만) */
export const approvalLineOf = (from: string, text: string, at: number): Utterance => said(at, 'approval', from, text)

/** 메신저에 한 줄 더한다(최근 것이 뒤, FEED_MAX까지) */
export const pushLine = (feed: readonly Utterance[], u: Utterance): Utterance[] => [...feed, u].slice(-FEED_MAX)

/** 말풍선이 아직 떠 있는가 */
export const isSpeaking = (b: Bubble | undefined, now: number): b is Bubble => b !== undefined && now - b.at < BUBBLE_MS

const KIND_KO: Record<UtteranceKind, string> = { order: '지시', report: '보고', message: '메시지', self: '혼잣말', error: '', approval: '결재', hr: '발령' }

/** 메신저 한 줄: "12초 전 BOSS → BEAR (지시): …" */
export function lineText(u: Utterance, now: number): string {
  const s = Math.max(0, Math.floor((now - u.at) / 1000))
  const ago = s < 60 ? `${s}초 전` : s < 3600 ? `${Math.floor(s / 60)}분 전` : `${Math.floor(s / 3600)}시간 전`
  const who = u.to === undefined ? u.from : `${u.from} → ${u.to}`
  const kind = KIND_KO[u.kind]
  return `${ago} ${who}${kind === '' ? '' : ` (${kind})`}: ${u.text}`
}
