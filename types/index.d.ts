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
  avgScore: number | null
  lastScore: number | null
  hiredAt: number
  lastAt: number | null
}

/** 부서가 반복한 도구 오류(같은 도구·같은 문구끼리 센다) */
export type Lesson = { tool: string; pattern: string; count: number; lastAt: number }

export type HrBook = {
  version: 1
  employees: Employee[]
  lessons: Partial<Record<Dept, Lesson[]>>
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
