// 에이전트 사무실 mod의 훅. 엔진의 사건(세션 시작·명령·에이전트 띄우기·턴·도구 호출·그리기)을
// 업무 흐름(flow)·상태(store)·화면(view)·명령(commands)으로 잇는다. 도구 호출은 관찰만 하고 막지 않는다.
import type { Register } from 'claude-code'

import type { Bubble, Dept, OfficeAgent, TrialTicket, Utterance } from '../types'
import { briefOf, learn, lessonKey, lessonsFor } from '../core/hr'
import { checkRunOf, errLineOf, messageOf, oopsOf, orderOf, replyOf, selfTalkOf } from '../core/speech'
import { enroll, errorLessonKey, markHit } from '../core/trial'
import { activityOf, layoutOf } from '../core/scene'
import { answer, COMMAND } from './commands'
import { awaitApproval, checkBudget, checkFollowUp, checkRework, EDIT_TOOLS, fileOf, isCheckCommand, papers, reorganize, reviewPlan, syncStatus, takeNotes, watch } from './flow'
import { usageOf } from '../core/tokens'
import { playbookLines } from '../core/playbook'
import { briefNotes } from '../core/notes'
import { cardView, flip, MENU, MENU_PANE, MENU_TITLE, nickOfView, playbookButtons, pressPlaybook, ratableOf, rateJob, TOGGLES, viewBlocks } from './menu'
import { mdOf } from '../core/table'
import { isShell } from '../core/watch'
import { admit, agentsOf, chargeAgent, readMenuView, setMenuView, ensure, fresh, hold, hrOf, MEET_MS, meet, nickOfId, patch, readFeed, release, save, saveHr, speak, staff, watchAgents } from './store'
import { cellsOf, dropOffice, feedRowsOf, FRAME_MS, markPaneShown, officeAt, RASTER, rowsOf, tick } from './view'

const PANE = 'agent-office'

/** 지금 도는 도구(에이전트 id → 도구 이름들): 하나가 끝나면 남은 것의 활동으로 돌아간다 */
const inflight = new Map<string, string[]>()
/** 다른 패널(설정 attachTo) 아래에 붙은 적이 있는지(/office 안내용) */
let isAttached = false

export const register: Register = (on, options) => {
  // 설정 attachTo: 다른 mod가 여는 패널의 id. 비어 있지 않으면 그 패널 아래에도 평면도를 붙인다.
  const attachTo = typeof options.attachTo === 'string' ? options.attachTo.trim() : ''

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register(COMMAND)
    $.clock.every(FRAME_MS, () => void tick($).catch(() => undefined))
    // 오래 일이 없는 직원은 세션을 열 때 정리한다
    await reorganize($).catch(() => undefined)
    return started
  })

  on('command.run', { command: 'office' }, async ($, e) => {
    if (e.args.trim().toLowerCase() === 'menu') {
      const opened = await $.ui.open({ id: MENU_PANE, title: MENU_TITLE, focus: true, closeOnEscape: true })
      return { text: opened.isPlaced ? '사무실 메뉴를 열었습니다. 1 인사 명부 · 2 일간 보고 · 3 주간 보고 · 4 예산 · 5 설정' : '사무실 메뉴가 아직 그려지지 않았습니다(창이 좁으면 넓혀 주세요).' }
    }
    const text = await answer($, e.args)
    // 설정을 바꾼 명령이면 패널의 켜짐·꺼짐 표시를 다시 그린다(설정은 상태가 아니라 저장소에 있다)
    if (text !== null) $.ui.invalidate('ui.render')
    if (text !== null) return { text }
    await ensure($, 'main')
    const opened = await $.ui.open({ id: PANE, title: '에이전트 사무실' })
    const lab = isAttached ? ` 설정한 패널(${attachTo}) 아래에도 붙어 있습니다.` : ''
    return { text: `${opened.isPlaced ? '에이전트 사무실을 열었습니다.' : '에이전트 사무실이 아직 그려지지 않았습니다(창이 좁으면 넓혀 주세요).'}${lab} 인사 기록은 /office hr, 보고서는 /office report.` }
  })

  // 새 에이전트: 부서 적임자에게 맡기고(업무 지시 끝에 인사 메모), 띄운 쪽과 회의실에서 지시를 주고받은 뒤 일하러 간다
  on('agent.spawn', async ($, e, next) => {
    const { employee, why } = await staff($, e.subagentType, e.description)
    // 사무실에 들어올 때까지 붙잡아 둔다(그 사이 조직 개편이 고른 직원을 내보내지 않도록)
    hold(employee.nick)
    try {
      const at = await $.clock.now()
      let brief: string | null = null
      let trial: TrialTicket | undefined
      if (e.workflow === undefined && (await hrOf($)).isCoaching) {
        const lessons = lessonsFor(await hrOf($), employee.dept, at)
        const keys = lessons.map(lessonKey)
        let enrolled: ReturnType<typeof enroll> = null
        await saveHr($, b => {
          enrolled = enroll(b, keys)
          return enrolled?.book ?? b
        })
        const arm = (enrolled as ReturnType<typeof enroll>)?.arm
        if (arm !== undefined) trial = { arm, keys, hits: [] }
        // 비교군은 실수 목록만 뺀다(나머지 메모는 같게 두어 실수 목록의 효과만 본다)
        // 개인 업무 노트: 비교군에는 흠·오류를 빼고 붙인다(실수 목록 역할을 하지 않도록, 실수 목록의 효과만 잰다)
        const book = await hrOf($)
        // 부서 지침도 비교군에는 실수에서 온 지침을 뺀다
        brief = briefOf(book, employee, at, arm === 'control' ? [] : lessons, why, briefNotes(book, book.employees.find(x => x.nick === employee.nick) ?? employee, e.description, arm === 'control'), playbookLines(book, employee.dept, arm === 'control'))
      }
      const spawned = await next(brief === null ? e : { ...e, prompt: `${e.prompt}\n\n${brief}` })
      if (spawned.deny !== undefined || spawned.agentId === undefined) return spawned
      const id = spawned.agentId
      const parentId = e.parentAgentId ?? 'main'
      const now = await $.clock.now()
      await ensure($, parentId)
      papers.set(id, { task: e.prompt.slice(0, 4000) })
      // 회의실에서 지시하고("BEAR, go!") 받는다("yes!")
      const order = orderOf(await nickOfId($, parentId), employee.nick, e.description, e.prompt, now, why)
      await admit($, { ...fresh(id, e.subagentType, e.description, now), model: spawned.model, parentId, trial, say: replyOf('yes!', now) }, employee.nick,
        list => patch(parentId, a => ({ ...a, say: order.bubble }))(meet([parentId, id], now + MEET_MS)(list)))
      await speak($, null, null, order.line)
      return spawned
    } finally {
      release(employee.nick)
    }
  })

  on('turn.start', async ($, e, next) => {
    const id = e.agentId ?? 'main'
    await ensure($, id)
    await save($, patch(id, a => ({ ...a, activity: 'think', endedAt: id === 'main' ? null : a.endedAt })))
    return next(e)
  })

  // 모델을 부를 때마다 그 에이전트가 쓴 토큰을 더한다(기록이 실패해도 응답은 그대로 넘긴다)
  on('turn.step', async function* ($, e, next) {
    const step = yield* next(e)
    if (step.usage != null) await chargeAgent($, e.agentId ?? 'main', usageOf(step.usage, step.usage.model), step.usage.model).catch(() => undefined)
    // 직원이 쓴 만큼 부서 예산을 본다(BOSS는 부서가 없다)
    if (step.usage != null && e.agentId !== undefined) await checkBudget($).catch(() => undefined)
    return step
  })

  on('turn.complete', async ($, e, next) => {
    // 서브에이전트의 마지막 답이 올린 보고다(결재에 쓴다). 끝남이 먼저 보여 평가가 시작돼도 보고가 있도록 먼저 적는다
    const agentId = e.agentId
    // 이미 평가를 마친 사람의 늦은 답은 적지 않는다(결재가 끝난 뒤 다시 쌓이지 않도록)
    const isOpen = agentId !== undefined && ((await agentsOf($)).find(a => a.id === agentId)?.endedAt ?? null) === null
    if (agentId !== undefined && isOpen && e.answer.trim() !== '') papers.set(agentId, { ...papers.get(agentId), report: e.answer.slice(0, 8000) })
    const done = await next(e)
    if (agentId === undefined) await save($, patch('main', a => ({ ...a, activity: 'idle', tool: null })))
    else await syncStatus($)
    return done
  })

  // 관찰만 한다: 기록이 실패해도 도구는 그대로 돈다.
  on('tool.call', async ($, e, next) => {
    const id = e.agentId ?? 'main'
    inflight.set(id, [...(inflight.get(id) ?? []), e.tool])
    await ensure($, id)
    const said = await $.clock.now()
    const me = await nickOfId($, id)
    // 말풍선은 지금, 메신저 줄은 실제로 돈 뒤에(거절되면 하지 않은 일이다). 지시(Agent)는 띄울 때 따로 말한다
    let talk: { bubble: Bubble; line: Utterance | null } | null = null
    let target: OfficeAgent | undefined
    if (e.tool === 'SendMessage') {
      // 메시지를 보내면 받는 쪽과 회의실에서 만난다(이름·id·별칭 어느 것으로 불러도 찾는다)
      const to = String(e.to ?? '').split('@')[0] ?? ''
      target = (await agentsOf($)).find(a => a.id !== id && (a.name === to || a.id === to || a.nick === to.toUpperCase() || (to === 'main' && a.id === 'main')))
      talk = messageOf(me, target?.nick ?? (to === '*' ? '전체' : to === '' ? '(알 수 없음)' : to), e, said)
    } else if (e.tool !== 'Agent') talk = selfTalkOf(me, e, said)
    // 한 번에 적는다(상태를 쓸 때마다 패널을 다시 그린다)
    const bubble = talk?.bubble
    await save($, list => {
      const moved = patch(id, a => ({ ...a, activity: activityOf(e.tool), tool: e.tool, tools: a.tools + 1, ...(bubble === undefined ? {} : { say: bubble }) }))(list)
      return target === undefined ? moved : meet([id, target.id], said + MEET_MS)(moved)
    })
    let ran: Awaited<ReturnType<typeof next>> | undefined
    /** 그 직원이 도구 결과 뒤에 읽을 근태 알림 */
    let nudge: string | null = null
    try {
      ran = await next(e)
    } finally {
      if (ran !== undefined && ran.deny === undefined && talk?.line != null) await speak($, null, null, talk.line)
      const left = [...(inflight.get(id) ?? [])]
      left.splice(left.indexOf(e.tool), 1)
      inflight.set(id, left)
      const last = left[left.length - 1]
      const isError = ran !== undefined && (ran.deny !== undefined || ran.isError === true)
      // 실제로 고친 파일만 센다(거절·실패한 수정은 고친 게 아니다)
      const file = ran !== undefined && !isError && EDIT_TOOLS.has(e.tool) ? fileOf(e) : null
      // 테스트·빌드 명령의 결과만 본다(grep의 일치 없음 같은 건 검증 실패가 아니다). 거절은 결과가 아니니 넘긴다
      const isCheck = isShell(e.tool) && ran !== undefined && ran.deny === undefined && isCheckCommand(e)
      // 실험 중인 실수가 다시 났으면 오류를 세는 바로 이 저장에서 적는다(곧 끝나 집계돼도 빠지지 않도록)
      const hitKey = isError && ran !== undefined ? errorLessonKey(e.tool, ran.deny ?? ran.text ?? '') : null
      // 실험 재발 표시와 활동·오류 수를 한 번에 적는다(상태를 쓸 때마다 패널을 다시 그린다)
      await save($, patch(id, x => {
        const a = x.trial !== undefined && hitKey !== null ? { ...x, trial: markHit(x.trial, hitKey) } : x
        return a.activity === 'done' || a.activity === 'failed' ? a : {
        ...a, activity: last === undefined ? 'think' : activityOf(last), tool: last ?? a.tool, errors: (a.errors ?? 0) + (isError ? 1 : 0),
        isCheckFailed: isCheck ? ran?.isError === true : a.isCheckFailed,
        // 결재 근거: 돌린 확인 명령과 그 결과, 난 오류(비밀은 가려 둔다)
        // (BOSS는 결재받지 않으니 쌓지 않는다)
        checks: isCheck && ran !== undefined && id !== 'main' ? [...(a.checks ?? []), checkRunOf(e, ran.isError === true, ran.text ?? '')].slice(-3) : a.checks,
        errLines: isError && ran !== undefined && id !== 'main' ? [...(a.errLines ?? []), errLineOf(e.tool, ran.deny ?? ran.text ?? '')].slice(-3) : a.errLines,
        files: file === null || id === 'main' || (a.files ?? []).includes(file) ? a.files : [...(a.files ?? []), file].slice(-50),
        }
      }))
      if (file !== null) await checkFollowUp($, file, me)
      if (file !== null && id === 'main') await checkRework($, file)
      // 서브에이전트의 오류는 부서의 교훈으로 남긴다
      const who = (await agentsOf($)).find(a => a.id === id)
      // 실패하면 "oops!"(거절은 그 사람 실수가 아니니 말하지 않는다)
      if (ran !== undefined && ran.deny === undefined && ran.isError === true && who !== undefined) {
        const o = oopsOf(who.nick, e.tool, ran.text ?? '', await $.clock.now())
        await speak($, id, o.bubble, o.line)
      }
      if (isError && who?.dept !== undefined && ran !== undefined) {
        const text = ran.deny ?? ran.text ?? ''
        const dept: Dept = who.dept
        const at = await $.clock.now()
        await saveHr($, b => learn(b, dept, e.tool, text, at))
      }
      if (ran !== undefined && id !== 'main') nudge = await watch($, id, e, ran)
    }
    // 여기 오면 next가 답했다(던졌으면 finally 뒤로 나간다)
    const out = ran as NonNullable<typeof ran>
    if (out.deny !== undefined) return out
    const extra: string[] = nudge === null ? [] : [nudge]
    const rec = (out as { result?: unknown }).result
    const status = typeof rec === 'object' && rec !== null ? (rec as { status?: unknown; agentId?: unknown }) : {}
    // 기다려서 받은 서브에이전트의 보고는 결재를 마치고 돌려준다(반려면 그 의견을 붙여)
    if (e.tool === 'Agent' && out.isError !== true && status.status === 'completed' && typeof status.agentId === 'string') {
      await awaitApproval($, status.agentId, next.budget.remainingMs)
    }
    if (e.tool === 'ExitPlanMode' && id === 'main' && out.isError !== true) {
      const plan = (status as { plan?: unknown }).plan
      const note = typeof plan === 'string' ? await reviewPlan($, plan).catch(() => null) : null
      if (note !== null) extra.push(note)
    }
    extra.push(...takeNotes(id, await agentsOf($)))
    if (extra.length === 0) return out
    return { ...out, context: [...(out.context ?? []), ...extra] }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    await watchAgents($)
    markPaneShown()
    const feed = await readFeed($)
    const agents = await agentsOf($)
    const b = await hrOf($)
    const now = await $.clock.now()
    const lines = rowsOf(agents, b, now, e.surface === 'terminal' ? (e.viewport?.columns ?? 80) - 2 : Infinity)
    const feedLines = feedRowsOf(feed, now)

    const { Box, Text, Button } = $.ui.resolve(e)
    // 메뉴 화면은 따로 연다. 직원 줄을 누르면 메뉴 화면에 그 직원의 인사카드를 띄운다
    const openMenu = async (view?: string) => {
      if (view !== undefined) await setMenuView($, view)
      await $.ui.open({ id: MENU_PANE, title: MENU_TITLE, focus: true, closeOnEscape: true })
    }
    const menu = (
      <Box>
        <Button key="open-menu" hotkey="m" plain onPress={() => openMenu().catch(() => undefined)}>메뉴(인사 명부·보고서·예산·설정)</Button>
      </Box>
    )
    const isTerminal = e.surface === 'terminal'
    const rowEls = lines.map(l => (
      <Box key={l.nick === null ? l.key : `${l.key}-line`}>
        {l.nick === null
          ? <Text dimColor={l.isOff} color={l.isBad ? 'red' : undefined} wrap={isTerminal ? 'truncate-end' : undefined}>{l.text}</Text>
          : <Button key={l.key} plain onPress={() => openMenu(cardView(l.nick ?? '')).catch(() => undefined)}>
              <Text dimColor={l.isOff} color={l.isBad ? 'red' : undefined} wrap={isTerminal ? 'truncate-end' : undefined}>{l.text}</Text>
            </Button>}
      </Box>
    ))

    if (!isTerminal) {
      dropOffice(PANE)
      return (
        <Box flexDirection="column">
          {menu}
          <Text dimColor>사무실 평면도는 터미널에서만 그려집니다. 직원 줄을 누르면 메뉴 화면에 인사카드가 나옵니다.</Text>
          {rowEls}
          {feedLines.length > 0 && <Text bold>사내 메신저</Text>}
          {feedLines.map(l => <Box key={l.key}><Text color={l.color} wrap="truncate-end">{l.text}</Text></Box>)}
        </Box>
      )
    }

    const { Raster } = $.ui.resolve(e)
    const office = officeAt(PANE, layoutOf(e.viewport?.columns ?? 80))
    const cells = cellsOf(office, agents, now, b)
    return (
      <Box flexDirection="column">
        {menu}
        <Raster key={RASTER} columns={office.layout.columns} rows={office.layout.rows} cells={cells} />
        {lines.length === 0 && <Text dimColor>아직 일하는 에이전트가 없습니다.</Text>}
        {rowEls}
        {feedLines.length > 0 && <Box marginTop={1}><Text bold>사내 메신저</Text></Box>}
        {feedLines.map(l => <Box key={l.key}><Text color={l.color} wrap="truncate-end">{l.text}</Text></Box>)}
      </Box>
    )
  })

  // 사무실 메뉴 화면: 위에 1~5 메뉴, 아래에 고른 것을 표(마크다운)로. 설정은 켜고 끄는 버튼으로
  on('ui.render', { component: 'Pane', requestId: MENU_PANE }, async ($, e) => {
    // 사람이 바뀌면 다시 그리고(구독), 저장소(인사 기록)는 구독할 수 없어 사무실 패널처럼 5초마다 다시 그린다
    await watchAgents($)
    markPaneShown()
    const view = await readMenuView($)
    const b = await hrOf($)
    const blocks = await viewBlocks($, b, view)
    const buttons = view === 'playbook' ? playbookButtons(b, await $.clock.now()) : []
    const { Box, Text, Button, Markdown } = $.ui.resolve(e)
    const go = (v: string) => () => setMenuView($, v).catch(() => undefined)
    const card = nickOfView(view)
    return (
      <Box flexDirection="column">
        <Box columnGap={2} flexWrap="wrap">
          {MENU.map(m => <Button key={m.key} hotkey={m.hotkey} plain dimColor={view !== m.view} onPress={go(m.view)}>{m.label}</Button>)}
          <Button key="menu-close" hotkey="q" plain dimColor role="dismiss" onPress={() => $.ui.close({ id: MENU_PANE }).catch(() => undefined)}>닫기</Button>
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Markdown key="menu-body" text={mdOf(blocks)} />
        </Box>
        {view === 'settings' && (
          <Box flexDirection="column">
            {TOGGLES.map(t => (
              <Box key={`${t.key}-line`} columnGap={2}>
                <Button key={t.key} plain onPress={() => flip($, t.key).catch(() => undefined)}>{`${t.isOn(b) ? '[켜짐]' : '[꺼짐]'} ${t.label}`}</Button>
                <Text dimColor>{t.note}</Text>
              </Box>
            ))}
          </Box>
        )}
        {view === 'playbook' && buttons.length > 0 && (
          <Box marginTop={1} flexDirection="column">
            {buttons.map(x => (
              <Box key={`${x.key}-line`}>
                <Button key={x.key} plain dimColor={x.kind === 'drop'} onPress={() => pressPlaybook($, x.key).catch(() => undefined)}>{x.label}</Button>
              </Box>
            ))}
          </Box>
        )}
        {view === 'hr' && b.employees.length + b.retired.length > 0 && (
          <Box marginTop={1} columnGap={2} flexWrap="wrap">
            <Text dimColor>인사카드:</Text>
            {b.employees.map(x => <Button key={`card-${x.nick}`} plain onPress={go(cardView(x.nick))}>{x.nick}</Button>)}
            {b.retired.slice(0, 5).map(x => <Button key={`card-${x.nick}`} plain dimColor onPress={go(cardView(x.nick))}>{`${x.nick}(퇴사)`}</Button>)}
          </Box>
        )}
        {card !== null && ratableOf(b, card).length > 0 && (
          <Box marginTop={1} flexDirection="column">
            <Text dimColor>대표 평가(같은 것을 다시 누르면 거둠):</Text>
            {ratableOf(b, card).map(r => (
              <Box key={`rate-${r.job}`} columnGap={2}>
                <Button key={`rate-good-${r.job}`} plain dimColor={r.bossRating !== 'good'} onPress={() => rateJob($, card, r.job, 'good').catch(() => undefined)}>{r.bossRating === 'good' ? '[좋음]' : '좋음'}</Button>
                <Button key={`rate-bad-${r.job}`} plain dimColor={r.bossRating !== 'bad'} onPress={() => rateJob($, card, r.job, 'bad').catch(() => undefined)}>{r.bossRating === 'bad' ? '[아쉬움]' : '아쉬움'}</Button>
                <Text wrap="truncate-end">{r.description || '(설명 없음)'}</Text>
              </Box>
            ))}
          </Box>
        )}
        {card !== null && (
          <Box marginTop={1}>
            <Button key="card-back" hotkey="0" plain onPress={go('hr')}>← 인사 명부</Button>
          </Box>
        )}
      </Box>
    )
  })

  // 설정한 패널 아래에 사무실 평면도를 붙인다. 그 패널의 화면은 그 mod가 그린 그대로 둔다.
  if (attachTo === '' || attachTo === PANE) return
  on('ui.render', { component: 'Pane', requestId: attachTo }, async ($, e, next) => {
    const host = await next(e)
    if (e.surface !== 'terminal') return host
    isAttached = true
    const { Box, Raster } = $.ui.resolve(e)
    // 상태를 read하지 않는다: 도구 호출마다 랩 화면까지 다시 그리지 않도록 사본만 본다
    const office = officeAt(attachTo, layoutOf(e.viewport?.columns ?? 80))
    const cells = cellsOf(office, await agentsOf($), await $.clock.now(), await hrOf($))
    return (
      <Box flexDirection="column">
        {host}
        <Box marginTop={1}>
          <Raster key={RASTER} columns={office.layout.columns} rows={office.layout.rows} cells={cells} />
        </Box>
      </Box>
    )
  })
}
