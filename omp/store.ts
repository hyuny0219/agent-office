// oh-my-pi판 저장소. 인사 기록은 세션을 넘어 남도록 파일에(~/.omp/agent-office/hr.json), 사무실 사람들과 사내 메신저는
// 이 프로세스의 메모리에 둔다(oh-my-pi는 부모·자식 세션이 모듈 변수를 같이 쓴다). Claude Code판과 기록을 나누지 않는다.
// 터미널 여러 개에서 omp를 같이 써도 기록이 사라지지 않게, 쓸 때마다 잠그고 파일의 최신 내용 위에 고친다.
import { existsSync, mkdirSync, readFileSync, renameSync, rmdirSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import type { HrBook, JournalEntry, OfficeAgent, Utterance } from '../types'
import { journalOf } from '../core/journal'
import { emptyBook, migrate } from '../core/hr'
import { pushLine } from '../core/speech'

/** 인사 기록 폴더(환경 변수 AGENT_OFFICE_HOME으로 바꿀 수 있다) */
export const HR_DIR = process.env.AGENT_OFFICE_HOME ?? join(homedir(), '.omp', 'agent-office')
export const HR_FILE = join(HR_DIR, 'hr.json')
const LOCK = `${HR_FILE}.lock`
/** 이보다 오래된 잠금은 죽은 프로세스가 남긴 것으로 본다 */
const STALE_LOCK_MS = 5_000

let book: HrBook | null = null
/** 마지막으로 읽거나 쓴 파일의 수정 시각(다른 프로세스가 고쳤는지 본다) */
let seenMtime = -1
/** 읽지 못한 파일을 옆으로 옮겨 두었으면 그 경로(세션을 열 때 알린다) */
let quarantined: string | null = null
export const takeLoadWarning = (): string | null => {
  const q = quarantined
  quarantined = null
  return q
}

const mtimeOf = (): number => {
  try {
    return statSync(HR_FILE).mtimeMs
  } catch {
    return -1
  }
}

/** 파일에서 읽는다. 있는데 읽을 수 없으면(깨졌거나 모르는 모양) 덮어쓰지 않게 옆으로 옮겨 두고 새로 시작한다 */
function load(): HrBook {
  seenMtime = mtimeOf()
  if (!existsSync(HR_FILE)) return emptyBook()
  try {
    const got = migrate(JSON.parse(readFileSync(HR_FILE, 'utf8')))
    if (got !== null) return got
  } catch {
    // 아래에서 옮긴다
  }
  const bad = `${HR_FILE}.bad-${Date.now()}`
  try {
    renameSync(HR_FILE, bad)
    quarantined = bad
  } catch {
    // 옮기지 못해도 새로 시작한다
  }
  seenMtime = -1
  return emptyBook()
}

/** 인사 기록(다른 프로세스가 파일을 고쳤으면 다시 읽는다) */
export function hr(): HrBook {
  if (book === null || mtimeOf() !== seenMtime) book = load()
  return book
}

const sleep = (ms: number) => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/** 잠금(폴더 만들기는 원자적이다). 오래된 잠금은 치우고, 끝내 못 잡으면 잠금 없이 쓴다 */
function withLock<T>(fn: () => T): T {
  mkdirSync(HR_DIR, { recursive: true, mode: 0o700 })
  let held = false
  for (let i = 0; i < 100 && !held; i++) {
    try {
      mkdirSync(LOCK)
      held = true
    } catch {
      try {
        if (Date.now() - statSync(LOCK).mtimeMs > STALE_LOCK_MS) rmdirSync(LOCK)
      } catch {
        // 다른 프로세스가 막 치웠다
      }
      sleep(10)
    }
  }
  try {
    return fn()
  } finally {
    if (held) {
      try {
        rmdirSync(LOCK)
      } catch {
        // 이미 없다
      }
    }
  }
}

/** 인사 기록을 고치고 파일에 남긴다: 잠근 뒤 파일의 최신 내용 위에 고치고, 임시 파일에 쓰고 바꿔 끼운다(본인만 읽을 수 있게) */
export function saveHr(fn: (b: HrBook) => HrBook): HrBook {
  // 고친 결과는 한 번만 만든다(쓰기가 실패해도 fn을 다시 부르지 않도록)
  let next: HrBook | null = null
  try {
    return withLock(() => {
      next = fn(mtimeOf() === seenMtime && book !== null ? book : load())
      const tmp = `${HR_FILE}.${process.pid}.tmp`
      writeFileSync(tmp, JSON.stringify(next), { mode: 0o600 })
      renameSync(tmp, HR_FILE)
      book = next
      seenMtime = mtimeOf()
      return next
    })
  } catch {
    // 저장이 막혀도 사무실은 돈다(이번 세션 동안은 메모리에 남는다)
    book = next ?? fn(book ?? emptyBook())
    return book
  }
}

// ── 업무 일지: 인사 기록 옆 journal.json(보고 글이 들어 커지므로 따로). 쓸 때마다 같은 잠금으로 파일의 최신 내용 위에 고친다 ─────

export const JOURNAL_FILE = join(HR_DIR, 'journal.json')
let journal: JournalEntry[] | null = null
let journalMtime = -1
const journalMtimeOf = (): number => {
  try {
    return statSync(JOURNAL_FILE).mtimeMs
  } catch {
    return -1
  }
}
function loadJournal(): JournalEntry[] {
  journalMtime = journalMtimeOf()
  try {
    return journalOf(JSON.parse(readFileSync(JOURNAL_FILE, 'utf8')))
  } catch {
    // 없거나 깨졌으면 새로(일지는 인사 기록이 아니니 옮겨 두지 않는다)
    return []
  }
}
/** 업무 일지(최근 것이 앞) */
export function journalList(): JournalEntry[] {
  if (journal === null || journalMtimeOf() !== journalMtime) journal = loadJournal()
  return journal
}
/** 업무 일지를 고치고 파일에 남긴다(본인만 읽을 수 있게) */
export function saveJournal(fn: (list: JournalEntry[]) => JournalEntry[]): JournalEntry[] {
  let next: JournalEntry[] | null = null
  try {
    return withLock(() => {
      next = fn(journalMtimeOf() === journalMtime && journal !== null ? journal : loadJournal())
      const tmp = `${JOURNAL_FILE}.${process.pid}.tmp`
      writeFileSync(tmp, JSON.stringify(next), { mode: 0o600 })
      renameSync(tmp, JOURNAL_FILE)
      journal = next
      journalMtime = journalMtimeOf()
      return next
    })
  } catch {
    journal = next ?? fn(journal ?? [])
    return journal
  }
}

/** 사무실 사람들(에이전트 id →) */
export const agents = new Map<string, OfficeAgent>()
/** 사내 메신저 */
let feed: Utterance[] = []
export const feedOf = (): readonly Utterance[] => feed
export const say = (u: Utterance) => {
  feed = pushLine(feed, u)
}

/** 사람들 목록이 바뀔 때 다시 그릴 곳(위젯) */
const listeners = new Set<() => void>()
export const onChange = (fn: () => void): (() => void) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
export const changed = () => {
  for (const fn of listeners) fn()
}

/** 그 사람을 고친다(없으면 그대로) */
export function patch(id: string, fn: (a: OfficeAgent) => OfficeAgent) {
  const a = agents.get(id)
  if (a === undefined) return
  agents.set(id, fn(a))
  changed()
}

/** 끝난 사람은 최근 30명까지만 */
export function trim() {
  const ended = [...agents.values()].filter(a => a.endedAt !== null).sort((x, y) => (y.endedAt ?? 0) - (x.endedAt ?? 0))
  for (const a of ended.slice(30)) agents.delete(a.id)
}
