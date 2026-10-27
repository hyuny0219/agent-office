// 위에서 내려다본 게임 속 사무실. 위층에 사장실·회의실·자료실·서버실·화장실, 가운데 복도(왼쪽 끝 입구와 안내 데스크),
// 아래층에 부서별 책상 섬이 있는 사무 공간과 탕비실(조리대·식탁·소파)이 있다.
// 일하는 모습은 실제 그대로 옮긴다: 작성·웹·생각 → 자기 부서 책상, 읽기 → 자료실, 터미널 → 서버실, 위임 → 회의실.
// 대화(지시·SendMessage·보고)는 회의실에 모여서 한다. 기다리는 동안(대기)만 탕비실·소파·화장실을 오간다. 완료하면 보고 뒤 퇴근.
// 셀 하나에 '▀'(위 픽셀=글자색, 아래 픽셀=배경색)로 픽셀 두 개를 그리고, 표지·명패·이름표만 ASCII 글자 셀로 덮는다.
import type { Dept, OfficeActivity, OfficeAgent } from '../types'
import { DEPT_INFO, DEPTS } from './hr'
import { isSpeaking } from './speech'

/** 평면도 높이(셀 줄): 제목 1줄 + 건물 26줄 */
export const PLAN_ROWS = 27
const MIN_W = 72
const MAX_W = 140

const HALF = 0x2580
const C = {
  wall: 0x3d405b, wallTop: 0x2f3247, window: 0x9fd3ff, frame: 0xdfe6ee, corridor: 0x8a7a66, corridor2: 0x7f7060,
  runner: 0x8c3b47, desk: 0x8b5a2b, deskLead: 0x6d4224, mon: 0x222831, skin: 0xf1c27d, plant: 0x2e7d32, leaf: 0x66bb6a,
  pot: 0xa0522d, sofa: 0x9c4a4a, wood: 0x6b4220, table: 0xb08968, white: 0xf5f5f5, porcelain: 0xe8eef2, steel: 0x9e9e9e,
  water: 0x4fc3f7, rack: 0x2b2b33, label: 0x1b1c28, text: 0xd8d8e0, dim: 0x8a8aa0, green: 0x4caf50, red: 0xe53935,
  yellow: 0xffd54f, black: 0x0d0d0d, pants: 0x2f3e66, mat: 0x5d4037, tv: 0x1a237e, lamp: 0xfff59d,
}
const FLOOR: Record<RoomId, [number, number]> = {
  ceo: [0x6b4f3a, 0x634935], meet: [0x50606b, 0x4a5963], library: [0x5c5240, 0x564c3b], server: [0x3a3f48, 0x353a42],
  wc: [0xcfd8dc, 0xb0bec5], office: [0x4b5068, 0x474b62], pantry: [0x8d7b68, 0x857360], corridor: [C.corridor, C.corridor2],
}
const HAIRS = [0x3b2416, 0x111111, 0xa0522d, 0xdaa520, 0x6b4f3a]
const BOOKS = [0xe76f51, 0x2a9d8f, 0xe9c46a, 0x8ecae6, 0xb5838d, 0x90be6d, 0x6d6875]

/** 별칭: 이름표(ASCII)와 목록(한글)에 쓴다. color는 셔츠·이름표 색 */
export const NICKS = [
  { en: 'OWL', ko: '부엉이', color: 0xe0c050 },
  { en: 'BEAR', ko: '곰', color: 0xc07a4a },
  { en: 'HAWK', ko: '매', color: 0xe76f51 },
  { en: 'FOX', ko: '여우', color: 0xf4a261 },
  { en: 'CAT', ko: '고양이', color: 0xcdb4db },
  { en: 'CRANE', ko: '두루미', color: 0x8ecae6 },
  { en: 'OTTER', ko: '수달', color: 0x90be6d },
  { en: 'WHALE', ko: '고래', color: 0x48cae4 },
  { en: 'PANDA', ko: '판다', color: 0xdddddd },
  { en: 'TIGER', ko: '호랑이', color: 0xff9f1c },
  { en: 'KOALA', ko: '코알라', color: 0xd4a5b5 },
  { en: 'WOLF', ko: '늑대', color: 0xaab4c0 },
  { en: 'DEER', ko: '사슴', color: 0xd4a373 },
  { en: 'SEAL', ko: '물범', color: 0x7da7d9 },
  { en: 'MOLE', ko: '두더지', color: 0xb07d5a },
  { en: 'LYNX', ko: '스라소니', color: 0xe9c46a },
] as const
const BOSS = { en: 'BOSS', ko: '보스', color: 0xd97757 }

// 종류마다 먼저 주는 별칭(이미 쓰고 있으면 다음 빈 별칭)
const PREFERRED: Record<string, string> = {
  explore: 'OWL', builder: 'BEAR', executor: 'BEAR', reviewer: 'HAWK', 'code-reviewer': 'HAWK',
  planner: 'FOX', plan: 'FOX', verifier: 'CAT', writer: 'CRANE', debugger: 'OTTER',
  'document-specialist': 'WHALE', 'general-purpose': 'PANDA', architect: 'TIGER', critic: 'WOLF',
}

/** 보이는 이름: 'oh-my-claudecode:executor' → 'executor' */
export const shortType = (type: string): string => type.split(':').pop() ?? type

/** 새 별칭. 한 번이라도 쓴 별칭(all)은 피하고, 다 쓰면 번호를 붙인다. */
export const nickFor = (type: string, agents: readonly Pick<OfficeAgent, 'nick' | 'endedAt'>[]): string => {
  if (type === 'main') return BOSS.en
  const all = new Set(agents.map(a => a.nick))
  const want = PREFERRED[shortType(type).toLowerCase()]
  if (want !== undefined && !all.has(want)) return want
  const free = NICKS.find(n => !all.has(n.en))
  if (free !== undefined) return free.en
  for (let i = 2; ; i++) for (const n of NICKS) if (!all.has(`${n.en}${i}`)) return `${n.en}${i}`
}

const nickInfo = (nick: string) => {
  if (nick === BOSS.en) return BOSS
  const base = NICKS.find(n => nick.startsWith(n.en)) ?? NICKS[0]
  return { en: nick, ko: `${base.ko}${nick.slice(base.en.length)}`, color: base.color }
}

/** 목록에 쓸 한글 별칭 */
export const koNick = (nick: string): string => nickInfo(nick).ko

const hash = (s: string): number => {
  let h = 7
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h
}

const shade = (c: number, k: number): number =>
  (Math.min(255, Math.round(((c >> 16) & 255) * k)) << 16) | (Math.min(255, Math.round(((c >> 8) & 255) * k)) << 8) | Math.min(255, Math.round((c & 255) * k))

/** 도구 이름 → 하는 일 */
export const activityOf = (tool: string): OfficeActivity => {
  if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(tool)) return 'type'
  if (/^(Read|Grep|Glob|LS|ToolSearch|TaskGet|TaskList)$/.test(tool) || /lsp|ast_grep/i.test(tool)) return 'read'
  if (/^(Bash|Monitor|PowerShell|TaskStop)$/.test(tool)) return 'bash'
  if (/^(WebFetch|WebSearch)$/.test(tool) || tool.startsWith('mcp__')) return 'web'
  if (/^(Agent|Task|SendMessage|Workflow|Skill)$/.test(tool)) return 'spawn'
  return 'think'
}

/** 목록 순서: 메인, 일하는 중, 최근 끝난 순 */
export const seated = (agents: readonly OfficeAgent[]): OfficeAgent[] => {
  const isLive = (a: OfficeAgent) => a.endedAt === null
  return [...agents].sort((a, b) => (a.id === 'main' ? -1 : b.id === 'main' ? 1 : isLive(a) !== isLive(b) ? (isLive(a) ? -1 : 1) : b.startedAt - a.startedAt))
}

/** 지금 회의실에서 대화 중인가 */
export const isMeeting = (a: OfficeAgent, now: number): boolean => (a.meetUntil ?? 0) > now

export type Layout = { columns: number; rows: number }

/** 패널 폭에 맞춘 평면도 크기(좁으면 최소 폭으로 그려 패널이 자른다) */
export const layoutOf = (columns: number): Layout => ({ columns: Math.min(MAX_W, Math.max(MIN_W, columns)), rows: PLAN_ROWS })

// ── 평면도 ────────────────────────────────────────────────────────────

export type RoomId = 'ceo' | 'meet' | 'library' | 'server' | 'wc' | 'office' | 'pantry' | 'corridor'

type Room = { id: RoomId; name: string; x: number; x2: number; isTop: boolean; doorX: number }
type Pt = { x: number; y: number }
/** 사람이 설 자리(머리 왼쪽 위, 사람은 4×4 픽셀). up이면 위를 보고, hidden이면 칸 안이라 안 보인다 */
type Spot = Pt & { room: RoomId; up: boolean; hidden?: boolean }
type Cluster = { x: number; y: number; dept?: Dept }

const TOP_Y = 2
const TOP_B = 19
const WALK_Y = 22
const BOT_Y = 27
const BOT_B = 53
const TOP_LANE = 14
const BOT_LANE = 28
const CLUSTER_W = 20
const CLUSTER_ROWS = [34, 46]

type Plan = {
  w: number
  rooms: Room[]
  bossSeat: Spot
  clusters: Cluster[]
  spots: Record<'meet' | 'library' | 'server' | 'wc' | 'coffee' | 'table' | 'sofa', Spot[]>
  entrance: Spot
  decor: { cooler: number; vending: number; plants: number[] }
}

function planOf(w: number): Plan {
  const isNarrow = w < 90
  const b1 = isNarrow ? 15 : 18
  const b2 = b1 + Math.min(26, Math.max(17, Math.round(w * 0.25)))
  const b4 = w - 1 - (isNarrow ? 13 : 16)
  const b3 = b4 - (isNarrow ? 11 : 13)
  const b5 = w - 1 - (isNarrow ? 24 : 28)
  const room = (id: RoomId, name: string, x: number, x2: number, isTop: boolean, doorX?: number): Room =>
    ({ id, name, x, x2, isTop, doorX: doorX ?? x + Math.floor((x2 - x) / 2) })
  const rooms = [
    room('ceo', 'CEO', 0, b1, true),
    room('meet', 'MEETING', b1, b2, true),
    room('library', 'LIBRARY', b2, b3, true),
    room('server', 'SERVER', b3, b4, true),
    room('wc', 'WC', b4, w - 1, true, b4 + 3),
    room('office', 'OFFICE', 0, b5, false, Math.floor(b5 * 0.55)),
    room('pantry', 'PANTRY', b5, w - 1, false, b5 + 4),
  ]
  const perRow = Math.max(1, Math.floor((b5 - 3) / CLUSTER_W))
  const pad = Math.floor((b5 - 1 - perRow * CLUSTER_W) / 2) + 1
  const clusters: Cluster[] = []
  for (const y of CLUSTER_ROWS) for (let k = 0; k < perRow; k++) clusters.push({ x: pad + k * CLUSTER_W, y })
  const up = (r: RoomId, x: number, y: number): Spot => ({ room: r, x, y, up: true })
  const down = (r: RoomId, x: number, y: number): Spot => ({ room: r, x, y, up: false })
  const stalls = Math.max(1, Math.floor((w - 1 - b4 - 2) / 4))
  const meetXs = [5, 11, 17, 23].filter(dx => b1 + dx + 2 < b2 - 2)
  return {
    w,
    rooms,
    bossSeat: up('ceo', Math.floor(b1 / 2) - 1, 11),
    clusters,
    spots: {
      // 탁자 아래(위를 봄), 위(아래를 봄)
      meet: [...meetXs.map(dx => up('meet', b1 + dx, 12)), ...meetXs.map(dx => down('meet', b1 + dx + 1, 5))],
      library: Array.from({ length: Math.max(1, Math.floor((b3 - b2 - 3) / 6)) }, (_, i) => up('library', b2 + 3 + i * 6, 8)),
      server: Array.from({ length: Math.max(1, Math.floor((b4 - b3 - 2) / 4)) }, (_, i) => up('server', b3 + 2 + i * 4, 13)),
      wc: [
        ...Array.from({ length: stalls }, (_, i) => ({ ...up('wc', b4 + 2 + i * 4, 4), hidden: true })),
        up('wc', b4 + 3, 13),
      ],
      coffee: [up('pantry', b5 + 4, 31), up('pantry', b5 + 9, 31)],
      table: [down('pantry', b5 + 6, 33), down('pantry', b5 + 11, 33), up('pantry', b5 + 6, 40), up('pantry', b5 + 11, 40)],
      sofa: [down('pantry', b5 + 4, 45), down('pantry', b5 + 8, 45), down('pantry', b5 + 12, 45)],
    },
    entrance: down('corridor', 1, WALK_Y),
    decor: {
      cooler: Math.floor(w * 0.42),
      vending: b5 - 6,
      plants: [b1 - 4, b2 + 4, Math.floor((b3 + b4) / 2)].filter(x => rooms.every(r => Math.abs(r.doorX - x) > 2)),
    },
  }
}

const roomAt = (plan: Plan, p: Pt): RoomId => {
  if (p.y > TOP_B - 3 && p.y < BOT_Y) return 'corridor'
  const isTop = p.y <= TOP_B - 3
  const row = plan.rooms.filter(r => r.isTop === isTop)
  return [...row].reverse().find(r => p.x >= r.x)?.id ?? row[0]?.id ?? 'corridor'
}

const roomById = (plan: Plan, id: RoomId) => plan.rooms.find(r => r.id === id)

/** p에서 to까지 걷는 길(방 안 통로 → 문 → 복도 → 문 → 통로 → 자리). 벽을 뚫지 않는다. */
function routeOf(plan: Plan, p: Pt, to: Spot): Pt[] {
  const from = roomAt(plan, p)
  const laneOf = (r: Room) => (r.isTop ? TOP_LANE : BOT_LANE)
  if (from === to.room && from !== 'corridor') {
    const r = roomById(plan, from)
    if (r === undefined) return [to]
    return [{ x: p.x, y: laneOf(r) }, { x: to.x, y: laneOf(r) }, to]
  }
  const pts: Pt[] = []
  const a = roomById(plan, from)
  if (a !== undefined) pts.push({ x: p.x, y: laneOf(a) }, { x: a.doorX, y: laneOf(a) }, { x: a.doorX, y: WALK_Y })
  else pts.push({ x: p.x, y: WALK_Y })
  const b = roomById(plan, to.room)
  if (b !== undefined) pts.push({ x: b.doorX, y: WALK_Y }, { x: b.doorX, y: laneOf(b) }, { x: to.x, y: laneOf(b) })
  else pts.push({ x: to.x, y: WALK_Y })
  pts.push(to)
  return pts
}

// ── 그리기 ────────────────────────────────────────────────────────────

const ascii = (s: string): string => s.replace(/[^\x20-\x7e]/g, '?')

class Canvas {
  readonly px: Uint32Array
  readonly text = new Map<number, { ch: number; fg: number; bg: number }>()
  constructor(readonly w: number, readonly h: number) {
    this.px = new Uint32Array(w * h)
  }
  get(x: number, y: number): number {
    return this.px[y * this.w + x] ?? 0
  }
  set(x: number, y: number, c: number) {
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.px[y * this.w + x] = c
  }
  rect(x: number, y: number, w: number, h: number, c: number) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c)
  }
  /** 글자 셀. bg를 비우면 그 셀 아래 픽셀 색을 쓴다 */
  write(cx: number, cy: number, s: string, fg: number, bg?: number) {
    const t = ascii(s)
    for (let i = 0; i < t.length; i++) {
      const x = cx + i
      if (x < 0 || x >= this.w || cy < 0 || cy >= this.h / 2) continue
      this.text.set(cy * this.w + x, { ch: t.charCodeAt(i), fg, bg: bg ?? this.get(x, cy * 2 + 1) })
    }
  }
  /** columns * rows 셀의 [글자, 글자색, 배경색] */
  cells(): Uint32Array {
    const cols = this.w
    const rows = this.h / 2
    const out = new Uint32Array(cols * rows * 3)
    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        const o = (cy * cols + cx) * 3
        const t = this.text.get(cy * cols + cx)
        out[o] = t?.ch ?? HALF
        out[o + 1] = t?.fg ?? this.px[cy * 2 * cols + cx] ?? 0
        out[o + 2] = t?.bg ?? this.px[(cy * 2 + 1) * cols + cx] ?? 0
      }
    }
    return out
  }
}

/** 모니터 두 픽셀의 색(하는 일마다 깜빡임이 다르다) */
const screenColors = (act: OfficeActivity, f: number): [number, number] => {
  switch (act) {
    case 'type': return f % 2 === 0 ? [0x82aaff, 0xc792ea] : [0xc3e88d, 0x82aaff]
    case 'read': return [0xf0f0f0, f % 3 === 0 ? 0x9e9e9e : 0xf0f0f0]
    case 'bash': return [0x33ff66, f % 2 === 0 ? 0x33ff66 : C.black]
    case 'web': return f % 2 === 0 ? [0x1e88e5, 0x43a047] : [0x43a047, 0x1e88e5]
    case 'spawn': {
      const r = [0xff595e, 0xffca3a, 0x8ac926, 0x1982c4, 0x6a4c93]
      return [r[f % 5] ?? C.white, r[(f + 2) % 5] ?? C.white]
    }
    case 'think': return [0x203a5a, f % 4 < 2 ? 0x42a5f5 : 0x203a5a]
    case 'failed': return f % 2 === 0 ? [C.red, C.red] : [C.black, C.black]
    default: return [0x111111, 0x111111]
  }
}

function plant(cv: Canvas, x: number, y: number) {
  cv.set(x, y, C.leaf)
  cv.set(x + 1, y, C.plant)
  cv.set(x, y + 1, C.plant)
  cv.set(x + 1, y + 1, C.leaf)
  cv.rect(x, y + 2, 2, 1, C.pot)
}

/** 바깥 벽의 창문(창살 사이로 하늘) */
function windows(cv: Canvas, x: number, x2: number, y: number) {
  for (let i = x; i <= x2; i++) cv.set(i, y, (i - x) % 5 === 4 ? C.frame : C.window)
}

function drawPlan(cv: Canvas, plan: Plan, f: number, occupied: ReadonlySet<string>, busyRooms: ReadonlySet<RoomId>) {
  const w = plan.w
  cv.rect(0, TOP_Y, w, cv.h - TOP_Y, C.wall)
  // 방 바닥(사장실·자료실·탕비실은 마루, 화장실은 타일)
  for (const r of plan.rooms) {
    const [a, b] = FLOOR[r.id]
    const y1 = r.isTop ? TOP_Y + 1 : BOT_Y + 1
    const y2 = r.isTop ? TOP_B - 1 : BOT_B - 1
    const isPlank = r.id === 'ceo' || r.id === 'library' || r.id === 'pantry'
    for (let y = y1; y <= y2; y++) for (let x = r.x + 1; x < r.x2; x++) cv.set(x, y, isPlank ? (y % 3 === 0 ? b : a) : (x + y) % 2 === 0 ? a : b)
    // 문(3픽셀, 문턱은 바닥색)
    cv.rect(r.doorX - 1, r.isTop ? TOP_B : BOT_Y, 3, 1, FLOOR[r.id][0])
  }
  // 복도: 마루, 가운데 카펫, 왼쪽 끝 입구와 매트
  for (let y = TOP_B + 1; y < BOT_Y; y++) for (let x = 1; x < w - 1; x++) cv.set(x, y, (x + Math.floor(y / 2)) % 4 === 0 ? C.corridor2 : C.corridor)
  cv.rect(2, WALK_Y + 2, w - 4, 1, C.runner)
  cv.rect(0, TOP_B + 2, 1, 5, C.mat)
  // 안내 데스크와 화분, 정수기, 자판기, 복도 화분
  cv.rect(2, TOP_B + 1, 6, 1, C.wood)
  cv.set(8, TOP_B + 1, C.leaf)
  cv.rect(plan.decor.cooler, TOP_B + 1, 2, 1, C.white)
  cv.set(plan.decor.cooler, TOP_B + 2, C.water)
  cv.set(plan.decor.cooler + 1, TOP_B + 2, C.water)
  cv.rect(plan.decor.vending, BOT_Y - 2, 3, 1, 0xc62828)
  cv.set(plan.decor.vending + 1 + (f % 2), BOT_Y - 2, C.yellow)
  for (const x of plan.decor.plants) {
    cv.set(x, TOP_B + 1, C.leaf)
    cv.set(x + 1, TOP_B + 1, C.plant)
  }
  // 바깥 벽 창문
  for (const r of plan.rooms) if (r.isTop && r.id !== 'wc' && r.id !== 'server') windows(cv, r.x + 3, r.x2 - 3, TOP_Y)
  const office = roomById(plan, 'office')
  if (office !== undefined) windows(cv, 3, office.x2 - 3, BOT_B)

  const room = (id: RoomId) => roomById(plan, id)!
  // 사장실: 책장, 큰 책상, 러그, 화분
  const ceo = room('ceo')
  for (let y = TOP_Y + 2; y <= TOP_Y + 8; y++) cv.set(ceo.x + 1, y, BOOKS[y % BOOKS.length] ?? C.wood)
  cv.rect(plan.bossSeat.x - 3, plan.bossSeat.y - 3, 8, 2, C.wood)
  cv.rect(ceo.x + 3, TOP_B - 3, ceo.x2 - ceo.x - 5, 2, C.runner)
  plant(cv, ceo.x2 - 3, TOP_Y + 2)
  // 회의실: 화면(회의 중이면 켜짐), 긴 탁자, 의자
  const meet = room('meet')
  cv.rect(meet.x + 3, TOP_Y + 2, meet.x2 - meet.x - 5, 1, busyRooms.has('meet') ? (f % 4 < 2 ? 0x3949ab : 0x5c6bc0) : C.tv)
  cv.rect(meet.x + 4, TOP_Y + 7, meet.x2 - meet.x - 7, 3, C.table)
  for (const s of plan.spots.meet) cv.set(s.x + (s.up ? 0 : 1), s.up ? s.y : s.y + 2, 0x546e7a)
  plant(cv, meet.x2 - 3, TOP_B - 4)
  // 자료실: 벽면 책장, 읽는 자리 스탠드
  const lib = room('library')
  for (let x = lib.x + 2; x < lib.x2 - 1; x++) {
    cv.set(x, TOP_Y + 2, BOOKS[(x * 7) % BOOKS.length] ?? C.wood)
    cv.set(x, TOP_Y + 3, BOOKS[(x * 5 + 2) % BOOKS.length] ?? C.wood)
    cv.set(x, TOP_Y + 4, C.wood)
  }
  for (const s of plan.spots.library) cv.set(s.x + 2, s.y - 1, C.lamp)
  plant(cv, lib.x2 - 3, TOP_B - 4)
  // 서버실: 에어컨, 랙과 깜빡이는 불빛
  const srv = room('server')
  cv.rect(srv.x + 2, TOP_Y + 1, srv.x2 - srv.x - 3, 1, C.white)
  for (let x = srv.x + 2; x < srv.x2 - 1; x += 4) {
    cv.rect(x, TOP_Y + 3, 3, 7, C.rack)
    for (let k = 0; k < 3; k++) cv.set(x + 1, TOP_Y + 4 + k * 2, hash(`${x}${k}${Math.floor(f / 2)}`) % 3 === 0 ? C.yellow : C.green)
  }
  // 화장실: 칸막이와 변기(사람이 들어가면 문에 빨간 불), 거울과 세면대
  const wc = room('wc')
  plan.spots.wc.filter(s => s.hidden).forEach((s, i) => {
    const x = wc.x + 1 + i * 4
    cv.rect(x, TOP_Y + 1, 1, 7, C.steel)
    cv.rect(s.x, TOP_Y + 2, 2, 2, C.porcelain)
    const isTaken = occupied.has(`wc:${s.x}:${s.y}`)
    cv.rect(x + 1, TOP_Y + 8, 3, 1, isTaken ? 0x8d6e63 : 0xbcaaa4)
    if (isTaken) cv.set(x + 2, TOP_Y + 8, C.red)
  })
  cv.rect(wc.x + 2, TOP_B - 8, wc.x2 - wc.x - 3, 1, C.window)
  cv.rect(wc.x + 2, TOP_B - 7, wc.x2 - wc.x - 3, 1, C.porcelain)
  cv.set(wc.x + 4, TOP_B - 7, C.water)
  cv.set(wc.x + 8, TOP_B - 7, C.water)
  // 탕비실: 조리대(싱크·커피 머신), 냉장고, 식탁, 소파, TV, 화분
  const pan = room('pantry')
  cv.rect(pan.x + 2, BOT_Y + 2, pan.x2 - pan.x - 8, 2, C.steel)
  cv.set(pan.x + 9, BOT_Y + 2, C.water)
  cv.rect(pan.x + 3, BOT_Y + 2, 2, 2, 0x3e2723)
  cv.set(pan.x + 4, BOT_Y + 3, f % 4 < 2 ? C.red : 0x5d0000)
  cv.rect(pan.x2 - 5, BOT_Y + 2, 3, 6, C.white)
  cv.set(pan.x2 - 3, BOT_Y + 4, C.steel)
  cv.rect(pan.x + 5, 37, 10, 2, C.table)
  cv.rect(pan.x + 3, 49, 13, 3, C.sofa)
  cv.rect(pan.x + 3, 48, 13, 1, shade(C.sofa, 1.2))
  cv.rect(pan.x2 - 2, 40, 1, 6, C.tv)
  cv.set(pan.x2 - 2, 42, f % 6 < 3 ? 0x64b5f6 : C.tv)
  plant(cv, pan.x2 - 4, BOT_B - 4)

  // 표지(벽에 붙은 방 이름)
  for (const r of plan.rooms) cv.write(r.x + 2, Math.floor((r.isTop ? TOP_Y : BOT_Y) / 2), r.name, C.dim, C.wallTop)
}

/** 위에서 본 사람: 머리 2×2, 어깨 4×1, 다리 2×1. up이면 뒤통수(위를 봄) */
function person(cv: Canvas, p: Pt, shirt: number, hair: number, up: boolean, step: number | null) {
  cv.rect(p.x, p.y, 2, 1, hair)
  cv.rect(p.x, p.y + 1, 2, 1, up ? hair : C.skin)
  cv.rect(p.x - 1, p.y + 2, 4, 1, shirt)
  if (step === null) cv.rect(p.x, p.y + 3, 2, 1, C.pants)
  else cv.set(p.x + (step % 2), p.y + 3, C.pants)
}

// ── 걷는 사람들(상태) ────────────────────────────────────────────────

type Walker = { x: number; y: number; route: Pt[]; goal: Spot | null; goalKey: string; isGone: boolean }

const SPEED = 2
/** 기다리는 동안 자리를 바꾸는 간격(ms) */
const IDLE_SLOT_MS = 25_000

export type Leads = Partial<Record<Dept, string>>

/**
 * 한 자리(패널)의 사무실. 프레임마다 draw를 부르면 사람들이 한 걸음씩 움직인 장면을 돌려준다.
 * 패널 폭이 바뀌면 평면도를 새로 짓고 모두 제자리에 세운다.
 */
export class Office {
  private readonly plan: Plan
  private readonly walkers = new Map<string, Walker>()
  /** 부서 섬 안 자리: id → 0(팀장 책상)·1·2, 자리가 없으면 -1 */
  private readonly seats = new Map<string, number>()
  private clusterOf = new Map<Dept, number>()
  private isFresh = true

  constructor(readonly layout: Layout) {
    this.plan = planOf(layout.columns)
  }

  /** 지금 사무실에 있는 부서를 정해진 순서로 섬에 앉힌다(섬이 모자라면 남는 부서는 탕비실 식탁) */
  private arrange(agents: readonly OfficeAgent[]) {
    const present = new Set(agents.filter(a => a.id !== 'main' && a.dept !== undefined && a.activity !== 'done' && !this.walkers.get(a.id)?.isGone).map(a => a.dept!))
    const next = new Map<Dept, number>()
    // 이미 앉은 부서는 섬을 그대로 쓴다
    for (const [d, i] of this.clusterOf) if (present.has(d)) next.set(d, i)
    for (const d of DEPTS) {
      if (!present.has(d) || next.has(d)) continue
      const used = new Set(next.values())
      const free = this.plan.clusters.findIndex((_, i) => !used.has(i))
      if (free >= 0) next.set(d, free)
    }
    this.clusterOf = next
    this.plan.clusters.forEach((c, i) => {
      c.dept = [...next].find(([, k]) => k === i)?.[0]
    })
  }

  /** 부서 섬 자리: 팀장은 팀장 책상(0), 팀원은 1·2. 섬이 없거나 꽉 차면 null */
  private deskOf(a: OfficeAgent, agents: readonly OfficeAgent[], leads: Leads): Spot | null {
    const d = a.dept
    const k = d === undefined ? undefined : this.clusterOf.get(d)
    const c = k === undefined ? undefined : this.plan.clusters[k]
    if (d === undefined || c === undefined) return null
    let seat = this.seats.get(a.id)
    if (seat === undefined) {
      const mates = agents.filter(m => m.id !== a.id && m.dept === d && m.endedAt === null)
      const used = new Set(mates.map(m => this.seats.get(m.id)).filter((s): s is number => s !== undefined))
      const want = leads[d] === a.nick ? [0, 1, 2] : [1, 2]
      seat = want.find(s => !used.has(s)) ?? -1
      this.seats.set(a.id, seat)
    }
    if (seat < 0) return null
    const dx = seat === 0 ? 0 : 7 + (seat - 1) * 6
    return { room: 'office', x: c.x + dx + 2, y: c.y + 2, up: true }
  }

  /** 하는 일 → 갈 자리. 대화 중(meetUntil)이면 무엇보다 회의실이 먼저다 */
  private goals(agents: readonly OfficeAgent[], now: number, leads: Leads): Map<string, Spot> {
    const plan = this.plan
    const out = new Map<string, Spot>()
    type Shared = keyof Plan['spots']
    const shared: Record<Shared, OfficeAgent[]> = { meet: [], library: [], server: [], wc: [], coffee: [], table: [], sofa: [] }
    for (const a of agents) {
      const act = a.activity
      if (isMeeting(a, now) && !this.walkers.get(a.id)?.isGone) {
        shared.meet.push(a)
        continue
      }
      // 기다리는 동안만 쉰다: 25초마다 소파·커피·화장실 중 하나(메인은 사장실이 기본)
      const breakRoll = hash(`${a.id}:${Math.floor(now / IDLE_SLOT_MS)}`) % 6
      if (a.id === 'main') {
        if (act === 'spawn') shared.meet.push(a)
        else if (act === 'idle' && breakRoll === 0) shared.wc.push(a)
        else if (act === 'idle' && breakRoll === 1) shared.coffee.push(a)
        else out.set(a.id, plan.bossSeat)
        continue
      }
      if (act === 'done') {
        out.set(a.id, { ...plan.entrance, x: 0 })
        continue
      }
      if (act === 'idle') {
        shared[breakRoll === 0 ? 'wc' : breakRoll <= 2 ? 'coffee' : 'sofa'].push(a)
        continue
      }
      const room = act === 'read' ? 'library' : act === 'bash' ? 'server' : act === 'spawn' ? 'meet' : null
      if (room !== null) {
        shared[room].push(a)
        continue
      }
      const desk = this.deskOf(a, agents, leads)
      if (desk === null) shared.table.push(a)
      else out.set(a.id, desk)
    }
    for (const k of Object.keys(shared) as Shared[]) {
      const spots = plan.spots[k]
      shared[k].forEach((a, i) => out.set(a.id, spots[i % spots.length] ?? plan.entrance))
    }
    return out
  }

  private step(agents: readonly OfficeAgent[], now: number, leads: Leads) {
    this.arrange(agents)
    const goals = this.goals(agents, now, leads)
    for (const a of agents) {
      const goal = goals.get(a.id)
      if (goal === undefined) continue
      const key = `${goal.room}:${goal.x}:${goal.y}`
      let wk = this.walkers.get(a.id)
      if (wk === undefined) {
        // 이미 퇴근한 에이전트는 들이지 않는다
        if (a.activity === 'done' && !isMeeting(a, now)) continue
        // 처음 지을 때는 제자리에, 그 뒤 새로 온 사람은 입구에서 걸어 들어온다
        const at = this.isFresh ? goal : this.plan.entrance
        wk = { x: at.x, y: at.y, route: [], goal: null, goalKey: '', isGone: false }
        this.walkers.set(a.id, wk)
      }
      if (wk.isGone) continue
      if (wk.goalKey !== key) {
        wk.goalKey = key
        wk.goal = goal
        wk.route = routeOf(this.plan, wk, goal)
      }
      let budget = SPEED
      while (budget > 0 && wk.route.length > 0) {
        const t = wk.route[0]!
        const dx = t.x - wk.x
        const dy = t.y - wk.y
        if (dx === 0 && dy === 0) {
          wk.route.shift()
          continue
        }
        // 가로 먼저, 다음 세로
        if (dx !== 0) wk.x += Math.sign(dx)
        else wk.y += Math.sign(dy)
        budget--
      }
      if (wk.route.length === 0 && a.activity === 'done' && !isMeeting(a, now)) wk.isGone = true
    }
    // 목록에서 빠지거나 퇴근했거나 부서 섬이 없어진 사람의 자리를 비운다
    for (const id of [...this.seats.keys()]) {
      const a = agents.find(x => x.id === id)
      if (a === undefined || (a.endedAt !== null && a.activity !== 'failed') || a.dept === undefined || !this.clusterOf.has(a.dept)) this.seats.delete(id)
    }
    this.isFresh = false
  }

  /** 한 걸음 움직이고 그린 장면의 셀. leads는 부서마다 팀장 별칭(빈 팀장 책상에 이름을 흐리게 단다) */
  draw(agents: readonly OfficeAgent[], frame: number, now: number, leads: Leads = {}): Uint32Array {
    this.step(agents, now, leads)
    const plan = this.plan
    const cv = new Canvas(this.layout.columns, this.layout.rows * 2)
    const here = agents.filter(a => {
      const wk = this.walkers.get(a.id)
      return wk !== undefined && !wk.isGone
    })
    const settled = (a: OfficeAgent) => {
      const wk = this.walkers.get(a.id)
      return wk !== undefined && wk.route.length === 0 ? wk : undefined
    }
    const occupied = new Set(here.map(a => settled(a)?.goalKey).filter((k): k is string => k !== undefined))
    const talkers = here.filter(t => isMeeting(t, now) && settled(t) !== undefined)
    drawPlan(cv, plan, frame, occupied, new Set<RoomId>(talkers.length > 0 ? ['meet'] : []))

    // 말풍선 자리: 줄마다 쓴 칸(이름표·말풍선). 겹치면 한 줄 위로, 머리 위가 없으면 발밑, 다 차면 이번 프레임은 쉰다
    const taken = new Map<number, [number, number][]>()
    const take = (x: number, row: number, len: number) => taken.set(row, [...(taken.get(row) ?? []), [x, x + len]])
    const place = (x: number, rows: readonly number[], len: number): number | null => {
      for (const r of rows) {
        // 0줄은 제목, 1줄은 방 이름
        if (r < 2 || r >= cv.h / 2) continue
        const used = taken.get(r) ?? []
        if (used.some(([a, b]) => x < b + 1 && a < x + len + 1)) continue
        taken.set(r, [...used, [x, x + len]])
        return r
      }
      return null
    }

    // 부서 섬: 부서색 카펫, 표지, 팀장 책상(스탠드), 팀원 책상, 모니터와 명패
    for (const c of plan.clusters) {
      const dept = c.dept
      const tint = dept === undefined ? FLOOR.office[1] : shade(DEPT_INFO[dept].color, 0.32)
      cv.rect(c.x - 1, c.y - 4, CLUSTER_W - 1, 10, tint)
      if (dept === undefined) {
        plant(cv, c.x + 8, c.y)
        continue
      }
      cv.write(c.x, (c.y - 4) / 2, DEPT_INFO[dept].en.slice(0, CLUSTER_W - 2), DEPT_INFO[dept].color, tint)
      take(c.x, (c.y - 4) / 2, DEPT_INFO[dept].en.slice(0, CLUSTER_W - 2).length)
      for (let seat = 0; seat < 3; seat++) {
        const x = seat === 0 ? c.x : c.x + 7 + (seat - 1) * 6
        const width = seat === 0 ? 6 : 5
        const owner = here.find(a => a.dept === dept && this.seats.get(a.id) === seat)
        const wk = owner === undefined ? undefined : settled(owner)
        const isAtDesk = wk !== undefined && wk.goal?.room === 'office'
        const [s1, s2] = isAtDesk && owner !== undefined ? screenColors(owner.activity, frame) : [C.mon, C.mon]
        cv.set(x + 2, c.y - 1, s1)
        cv.set(x + 3, c.y - 1, s2)
        if (seat === 0) cv.set(x + width - 1, c.y - 1, C.lamp)
        const nick = owner?.nick ?? (seat === 0 ? leads[dept] : undefined)
        const deskColor = seat === 0 ? C.deskLead : C.desk
        cv.rect(x, c.y, width, 2, deskColor)
        if (nick !== undefined) cv.write(x, c.y / 2, nick.slice(0, width).padEnd(width), owner === undefined ? shade(nickInfo(nick).color, 0.6) : nickInfo(nick).color, deskColor)
      }
    }
    // 사장 책상 모니터
    const boss = agents.find(a => a.id === 'main')
    const [b1, b2] = screenColors(boss?.activity ?? 'idle', frame)
    cv.set(plan.bossSeat.x, plan.bossSeat.y - 4, b1)
    cv.set(plan.bossSeat.x + 1, plan.bossSeat.y - 4, b2)

    // 사람과 이름표
    const speakers: { a: OfficeAgent; x: number; y: number }[] = []
    for (const a of here) {
      const wk = this.walkers.get(a.id)!
      const info = nickInfo(a.nick)
      const isMoving = wk.route.length > 0
      if (!isMoving && wk.goal?.hidden) continue
      const isUp = !isMoving && (wk.goal?.up ?? false)
      person(cv, wk, info.color, HAIRS[hash(a.id) % HAIRS.length] ?? C.black, isUp, isMoving ? frame : null)
      if (isSpeaking(a.say, now)) speakers.push({ a, x: wk.x, y: wk.y })
      else if (!isMoving) {
        if (isMeeting(a, now)) {
          // 회의실 대화: 말하는 사람이 돌아가며 말풍선을 띄운다
          if (talkers[Math.floor(frame / 4) % Math.max(1, talkers.length)]?.id === a.id) {
            cv.rect(wk.x + 3, wk.y - 2, 3, 2, C.white)
            cv.set(wk.x + 3, wk.y, C.white)
            cv.set(wk.x + 4, wk.y - 1, frame % 2 === 0 ? C.dim : C.white)
          }
        } else if (a.activity === 'idle') {
          if (plan.spots.coffee.some(s => s.x === wk.x && s.y === wk.y)) {
            // 커피 잔과 김
            cv.set(wk.x + 2, wk.y + 1, C.white)
            if (frame % 4 < 2) cv.set(wk.x + 2, wk.y, 0xcfd8dc)
          } else {
            const dy = frame % 6 < 3 ? 0 : 1
            cv.set(wk.x + 3, wk.y - 2 + dy, C.white)
            cv.set(wk.x + 4, wk.y - 2 + dy, C.white)
            cv.set(wk.x + 4, wk.y - 1 + dy, C.white)
          }
        } else if (a.activity === 'think') {
          cv.set(wk.x + 3 + (frame % 3), wk.y, C.white)
        } else if (a.activity === 'failed' && frame % 2 === 0) {
          cv.set(wk.x + 3, wk.y - 1, C.red)
          cv.set(wk.x + 3, wk.y + 1, C.red)
        } else if (a.activity !== 'done') {
          // 일하는 손
          cv.set(wk.x + (frame % 2 === 0 ? -1 : 2), wk.y + 1, C.skin)
        }
      }
      // 이름표: 자기 책상에 앉은 사람은 명패가 있으니 생략
      const isAtOwnDesk = !isMoving && wk.goal?.room === 'office'
      if (!isAtOwnDesk) {
        const tag = a.nick
        const tx = Math.max(0, Math.min(plan.w - tag.length, wk.x + 1 - Math.floor(tag.length / 2)))
        cv.write(tx, Math.floor(wk.y / 2) - 1, tag, a.activity === 'failed' ? C.red : info.color, C.label)
        take(tx, Math.floor(wk.y / 2) - 1, tag.length)
      }
    }
    // 말풍선은 이름표를 다 그린 뒤에 빈자리에(이름표를 덮지 않도록). 걷는 중에도 말한다
    for (const { a, x, y } of speakers) {
      const bubble = a.say as NonNullable<OfficeAgent['say']>
      const text = ` ${bubble.text} `
      const bx = Math.max(0, Math.min(plan.w - text.length, x + 1 - Math.floor(text.length / 2)))
      const head = Math.floor(y / 2)
      const row = place(bx, [head - 2, head - 3, head + 2], text.length)
      if (row === null) continue
      const fg = bubble.tone === 'bad' ? C.red : bubble.tone === 'good' ? C.green : bubble.tone === 'self' ? 0x555566 : C.black
      cv.write(bx, row, text, fg, C.white)
    }

    // 제목
    const live = agents.filter(a => a.id !== 'main' && a.endedAt === null).length
    const done = agents.filter(a => a.id !== 'main' && a.endedAt !== null).length
    const blink = frame % 4 < 2 ? '*' : ' '
    cv.write(0, 0, ` ${blink} AGENT OFFICE  working ${live}  meeting ${talkers.length}  done ${done}`.padEnd(plan.w), C.yellow, C.label)
    return cv.cells()
  }

  /** 그 사람이 지금 있는 방(걷는 중이면 isMoving). 들어오지 않았거나 퇴근했으면 null */
  whereIs(id: string): { room: RoomId; isMoving: boolean } | null {
    const wk = this.walkers.get(id)
    if (wk === undefined || wk.isGone) return null
    return { room: roomAt(this.plan, wk), isMoving: wk.route.length > 0 }
  }
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Raster cells 인코딩: u32 리틀 엔디언 바이트의 패딩 있는 base64 */
export function encodeCells(words: Uint32Array): string {
  const bytes = new Uint8Array(words.buffer, words.byteOffset, words.byteLength)
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0
    const b = bytes[i + 1] ?? 0
    const c = bytes[i + 2] ?? 0
    const n = (a << 16) | (b << 8) | c
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + (i + 1 < bytes.length ? B64[(n >> 6) & 63]! : '=') + (i + 2 < bytes.length ? B64[n & 63]! : '=')
  }
  return out
}
