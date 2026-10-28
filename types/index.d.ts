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
  /** 이번 일에서 돌린 테스트·빌드 명령(최근 3개, 결재 근거) */
  checks?: CheckRun[]
  /** 이번 일에서 난 도구 오류의 첫 줄(최근 3개, 결재 근거) */
  errLines?: string[]
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
  /** 이번 일(메인은 이 세션)에서 모델을 부르며 쓴 토큰 */
  tokens?: TokenUse
}

/**
 * 모델 호출이 쓴 토큰: 입력(캐시 안 된 것)·출력·캐시 읽기·캐시 쓰기, 그 모델의 API 정가로 어림한 달러,
 * 가격을 모르는 모델이 쓴 토큰 수(달러에 들지 않은 몫)
 */
export type TokenUse = { input: number; output: number; cacheRead: number; cacheWrite: number; usd: number; unpriced: number }

/**
 * 테스트·빌드 명령 한 번: 명령 이름(앞 낱말 몇 개뿐, 인자·비밀은 남기지 않는다), 결과(통과·실패·알 수 없음: 백그라운드나
 * 종료 코드를 덮는 ||·|·; 가 든 명령), 출력 마지막 줄(한 줄, 비밀은 가림)
 */
export type CheckRun = { cmd: string; result: 'pass' | 'fail' | 'unsure'; tail: string }

/** 평면도 머리 위 말풍선: 영문 짧은 말, 그 말을 한 때, 말투(혼잣말·대화·실수·좋은 소식) */
export type Bubble = { text: string; at: number; tone: 'self' | 'talk' | 'bad' | 'good' }

export type UtteranceKind = 'order' | 'report' | 'message' | 'self' | 'error' | 'approval' | 'hr'

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
  /** 지금까지 일하며 쓴 토큰(예전 기록에는 없다) */
  tokens?: TokenUse
  /** 토큰을 센 업무 수(한 건 평균을 낼 때: 토큰을 세기 전에 끝낸 일은 빼고) */
  tokenJobs?: number
  /** 개인 업무 노트(최근 것이 앞): 다시 일을 맡길 때 비슷한 일의 노트를 업무 지시에 붙인다 */
  notes?: WorkNote[]
}

/**
 * 끝낸 일 한 건의 노트: 그 직원의 몇 번째 일, 업무 설명(기록이 잘려도 남도록), 보고 요약, 고친 파일 이름, 난 오류, 반려 의견(한 줄씩, 비밀은 가림).
 * 업무 지시에는 구조화된 칸(설명·흠·파일 이름·오류 난 도구)만 붙이고, 자유 글(요약·오류 문구·반려 의견)은 인사카드에만 보인다
 */
export type WorkNote = { job: number; description?: string; summary: string; files: string[]; errors: string[]; rejectNotes?: string[] }

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
  /** 승인·반려한 결재자의 별칭(대표는 BOSS, 전결이면 없다) */
  approver?: string
  /** 그 일에서 고친 파일 수(후속 수정으로 결재 정확도를 잴 수 있는지) */
  files?: number
  /** 끝낸 뒤 곧 다른 사람(BOSS나 다른 직원)이 같은 파일을 고쳤는지: 결재 정확도에 쓴다 */
  isFollowedUp?: boolean
  /** 반려됐지만 그 결재자의 반려가 자주 빗나가 감점하지 않았는지 */
  isWaived?: boolean
  /** 그 일을 하며 쓴 토큰 */
  tokens?: TokenUse
  /** 결재자가 그 일을 결재하며 쓴 토큰 */
  reviewTokens?: TokenUse
  /** 대표(사용자)가 준 평가: 좋음·아쉬움(평가 점수와 결재 정확도에 반영) */
  bossRating?: BossRating
  /** 대표 평가로 실제로 바뀐 경력(0 아래로는 잘리므로 점수와 다를 수 있다): 거둘 때 이만큼 되돌린다 */
  bossXp?: number
}

/** 대표 평가 */
export type BossRating = 'good' | 'bad'

/** 회사를 떠난 직원: 그때의 인사 기록과 떠난 때·까닭 */
export type Retiree = Employee & { retiredAt: number; reason: string }

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
  /** 조직 개편(권고사직·계약 종료)을 할지(/office reorg on|off) */
  isReorganizing: boolean
  /** 조직 개편으로 처음 직원을 내보낼 때 안내를 했는지 */
  isReorgNoticed: boolean
  /** 떠난 직원(최근 떠난 것부터). 별칭을 다시 쓰지 않고, 인사카드를 남긴다 */
  retired: Retiree[]
  /** 부서별 하루(최근 24시간) 비용 한도, 달러(/office budget) */
  budgets: Partial<Record<Dept, number>>
  /** 부서별로 예산 초과를 마지막으로 알린 때(24시간에 한 번만 알린다) */
  budgetNotices: Partial<Record<Dept, number>>
  /** 부서 지침(대표가 승인한 개선안): 그 부서 업무 지시에 붙는다 */
  playbooks?: Partial<Record<Dept, Playbook>>
  /** 부서별 하루(최근 24시간) 토큰 수 한도(/office budget <부서> 2M): 가격을 모르는 모델(사내 모델 등)도 잴 수 있다 */
  tokenBudgets?: Partial<Record<Dept, number>>
  /** 부서별로 예산 초과를 "계속"으로 넘긴 때(24시간 동안 새 일을 맡길 때 다시 묻지 않는다) */
  budgetWaivers?: Partial<Record<Dept, number>>
  /** 에이전트 종류(소문자, 접두어 뺀 이름) → 부서: 대표가 바꾼 배치(/office dept). 없는 종류는 기본 배치 */
  deptMap?: Record<string, Dept>
  /** 끝낸 일 기록에서 밀려난 오래된 일의 월별 요약(최근 달이 앞) */
  archive?: MonthSummary[]
  /** 부서별로 이미 알린 지침 후보의 열쇠(새 후보만 토스트·메신저로 한 번 알린다) */
  proposalsTold?: Partial<Record<Dept, string[]>>
  /** 부서별로 대표가 지침 화면에서 본 후보의 열쇠(못 본 후보가 있으면 사무실 화면에 알림 줄) */
  proposalsSeen?: Partial<Record<Dept, string[]>>
}

/** 한 달 동안 끝낸 일의 요약: 건수·결과·점수 합·비용(일한 것+결재)·재작업·반려·대표 평가, 부서별 건수·점수 합·비용 */
export type MonthSummary = {
  /** 'YYYY-MM'(끝낸 때의 현지 시각) */
  month: string
  jobs: number
  done: number
  failed: number
  scoreSum: number
  usd: number
  reworks: number
  rejected: number
  good: number
  bad: number
  depts: Partial<Record<Dept, { jobs: number; scoreSum: number; usd: number }>>
}

/** 부서 지침: 채택한 지침, 마지막으로 적용한 때, 그때의 부서 성적(전후 비교용) */
export type Playbook = { rules: PlaybookRule[]; appliedAt: number | null; before: DeptStats | null }
/** 지침 하나: 같은 흠을 가리는 열쇠, 지침 글, 채택할 때의 근거, 채택한 때 */
export type PlaybookRule = { key: string; text: string; why: string; at: number }
/** 부서 성적(최근 업무): 건수, 평균 평가, 테스트 실패 완료·재작업·반려·대표 아쉬움·실패 비율 */
export type DeptStats = { jobs: number; avgScore: number; checkFailRate: number; reworkRate: number; rejectRate: number; badRate: number; failRate: number }

declare module 'claude-code' {
  interface PluginState {
    'agent-office': {
      agents: OfficeAgent[]
      /** 사내 메신저(최근 줄이 뒤) */
      feed: Utterance[]
      /** 메뉴 화면에서 보고 있는 것: hr·today·week·budget·settings·playbook·archive·card:<별칭> */
      menuView: string
    }
  }
}
