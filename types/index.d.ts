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
  /** 도구별로 연달아 난 같은 오류(헛손질) */
  errStreaks?: Record<string, Streak>
  /** 연달아 부른 같은 도구·같은 입력(제자리걸음) */
  callStreak?: Streak
  /** 야근을 이미 알렸는지 */
  isOvertimeNoticed?: boolean
  /** 교육 효과 측정 중이면 이번 업무의 실험 기록 */
  trial?: TrialTicket
  /** 이번 일에서 받은 근태 알림 수 */
  alarms?: number
  /** 머리 위 말풍선(잠깐 뜬다) */
  say?: Bubble
}

/** 평면도 머리 위 말풍선: 영문 짧은 말, 그 말을 한 때, 말투(혼잣말·대화·실수·좋은 소식) */
export type Bubble = { text: string; at: number; tone: 'self' | 'talk' | 'bad' | 'good' }

export type UtteranceKind = 'order' | 'report' | 'message' | 'self' | 'error' | 'approval'

/** 사내 메신저 한 줄 */
export type Utterance = { at: number; kind: UtteranceKind; from: string; to?: string; text: string }

/** 같은 것이 연달아 몇 번 났는지 */
export type Streak = { key: string; count: number }

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
  /** 근태 알림(같은 실수 연발·제자리걸음)을 받은 횟수 */
  alarms: number
  /** 결재에서 반려된 횟수 */
  rejections: number
  /** 최근 평가 가중 평균(최근 일이 30%) */
  avgScore: number | null
  lastScore: number | null
  hiredAt: number
  lastAt: number | null
}

/** 부서가 반복한 도구 오류(같은 도구·같은 문구끼리 센다) */
export type Lesson = {
  tool: string
  pattern: string
  count: number
  lastAt: number
}

/** 실수 하나(교훈 열쇠)의 교육 효과 측정: 메모에 붙인 업무·뺀 업무(비교군)와 그중 재발한 수 */
export type TrialStats = {
  memo: { jobs: number; hits: number }
  control: { jobs: number; hits: number }
  lastAt: number
  /** 메모를 붙여도 재발이 줄지 않는다고 판정한 때. 그 뒤 한동안 메모에서 빼고, 지나면 다시 잰다 */
  ineffectiveAt?: number
}

export type TrialArm = 'memo' | 'control'

/** 이번 업무가 어느 쪽에 들었고, 실험 중인 교훈 중 무엇이 재발했는지 */
export type TrialTicket = { arm: TrialArm; keys: string[]; hits: string[] }

/** 최근에 끝낸 일(재작업 판정용): 이 파일들을 BOSS가 곧 다시 고치면 재작업 */
export type Handoff = {
  agentId: string
  nick: string
  files: string[]
  endedAt: number
  /** 그 직원의 몇 번째 일이었는지(재작업 감점을 그 일의 평가에 맞춰 고친다) */
  job: number
}

/** 끝낸 일 한 건(보고서·인사카드용) */
export type JobRecord = {
  nick: string
  dept: Dept
  /** 그 직원의 몇 번째 일이었는지(재작업을 이 기록에 맞춰 적는다) */
  job: number
  description: string
  startedAt: number
  endedAt: number
  outcome: 'done' | 'failed' | 'killed'
  /** 평가 점수(재작업이면 깎인 뒤) */
  score: number
  errors: number
  /** 테스트·빌드가 실패한 채 완료했는지 */
  isCheckFailed: boolean
  /** 끝낸 뒤 BOSS가 같은 파일을 다시 고쳤는지 */
  isReworked: boolean
  /** 그 일에서 받은 근태 알림 수 */
  alarms: number
  /** 그때 연봉(만원, 인건비 계산용). 예전 기록에는 없다 */
  salary?: number
  /** 결재 결과(결재 전이거나 보류면 없다) */
  approval?: Approval
}

/** 승인·반려·전결 */
export type Approval = 'approved' | 'rejected' | 'exempt'

export type HrBook = {
  version: 2
  employees: Employee[]
  lessons: Partial<Record<Dept, Lesson[]>>
  handoffs: Handoff[]
  /** 업무 지시에 인사 메모를 붙일지(/office hr on|off) */
  isCoaching: boolean
  /** 교육 효과 측정(비교군 두기)을 할지(/office hr ab on|off) */
  isTrialing: boolean
  /** 실험에 넣은 업무 순번(비교군을 고르는 데 쓴다) */
  trialSeq: number
  /** 교훈 열쇠(도구|문구) → 교육 효과 측정. 교훈 목록이 밀려나도 남도록 따로 둔다 */
  trials: Record<string, TrialStats>
  /** 끝낸 일 기록(최근 것부터) */
  log: JobRecord[]
  /** 끝낸 일의 보고·확정한 계획을 결재에 올릴지(/office approval on|off) */
  isApproving: boolean
  /** 결재를 처음 부를 때 비용 안내를 했는지 */
  isApprovalNoticed: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'agent-office': {
      agents: OfficeAgent[]
      /** 사내 메신저(최근 줄이 뒤) */
      feed: Utterance[]
    }
  }
}
