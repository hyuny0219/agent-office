/** 책상 화면·머리 위 표시를 정하는 지금 하는 일 */
export type OfficeActivity = 'think' | 'type' | 'read' | 'bash' | 'web' | 'spawn' | 'idle' | 'done' | 'failed'

export type OfficeAgent = {
  /** 서브에이전트 id, 메인 루프는 'main' */
  id: string
  /** 에이전트 종류(builder, Explore, …), 메인은 'main' */
  type: string
  /** 별칭(명패의 영문, OWL·BEAR…, 메인은 BOSS). 예전 상태에는 없을 수 있다 */
  nick: string
  description: string
  model: string | null
  startedAt: number
  endedAt: number | null
  activity: OfficeActivity
  /** 지금(마지막으로) 부른 도구 */
  tool: string | null
  /** 지금까지 부른 도구 수 */
  tools: number
  /** SendMessage가 부르는 이름(Agent의 name), 없으면 null */
  name?: string | null
  /** 띄운 쪽(메인은 'main') */
  parentId?: string | null
  /** 이 시각(ms)까지 회의실에서 대화한다(지시받기·메시지·보고) */
  meetUntil?: number
  /** 마지막 대화 상대의 별칭(목록 표시용) */
  meetWith?: string | null
  /** 소속 부서(메인은 없음) */
  dept?: Dept
  /** 이번 일에서 난 도구 오류·거절 수(평가에 쓴다) */
  errors?: number
  /** 이번 일에서 고친 파일(재작업 판정에 쓴다) */
  files?: string[]
  /** 마지막 Bash(테스트·빌드)가 실패했는지. 실패한 채 끝내면 감점 */
  isCheckFailed?: boolean
}

export type Dept = 'dev' | 'research' | 'qa' | 'plan' | 'docs' | 'ops'

/** 직원 한 명(별칭 하나)의 경력. 세션을 넘어 $.store에 남는다 */
export type Employee = {
  nick: string
  dept: Dept
  /** 마지막으로 맡은 에이전트 종류 */
  type: string
  xp: number
  jobs: number
  done: number
  failed: number
  toolErrors: number
  /** 끝낸 뒤 BOSS가 같은 파일을 다시 고친 횟수 */
  reworks: number
  /** 최근 평가 가중 평균(최근 일이 30%) */
  avgScore: number | null
  lastScore: number | null
  hiredAt: number
  lastAt: number | null
}

/** 부서가 반복한 도구 오류(같은 도구·같은 문구끼리 센다) */
export type Lesson = { tool: string; pattern: string; count: number; lastAt: number }

/** 최근에 끝낸 일(재작업 판정용): 이 파일들을 BOSS가 곧 다시 고치면 재작업 */
export type Handoff = {
  agentId: string
  nick: string
  files: string[]
  endedAt: number
  /** 그 직원의 몇 번째 일이었는지(재작업 감점을 그 일의 평가에 맞춰 고친다) */
  job: number
}

export type HrBook = {
  version: 2
  employees: Employee[]
  lessons: Partial<Record<Dept, Lesson[]>>
  handoffs: Handoff[]
  /** 업무 지시에 인사 메모를 붙일지(/office hr on|off) */
  isCoaching: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'agent-office': {
      agents: OfficeAgent[]
    }
  }
}
