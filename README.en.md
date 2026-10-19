# agent-office

[한국어](README.md) | **English**

A Claude Code mod that shows your subagents at work as a **top-down office in a pixel game**.
It comes with an HR system of departments, ranks, salaries and performance reviews, and it reminds each department of the mistakes it keeps repeating in the next task brief.

![The office with agents at work (animated)](docs/office.gif)

The main conversation (BOSS) talks with FOX from Planning in the meeting room. OWL runs Grep in the library, HAWK runs tests in the server room and then walks back to the QA desk to fix things, and OTTER, who came in late, walks in from the entrance and takes a seat in the Dev team. CRANE waits for work on the pantry sofa.

![Floor plan and the list under the pane](docs/office.png)

> The mod's own text (the pane list, `/office hr`, toasts and the task-brief memo) is in Korean. The floor plan's signs, desk name plates and name tags are in English.

## Install

At the prompt of a terminal session:

```
/plugin install agent-office --marketplace hyuny0219/agent-office
```

Answer `y` to `Add marketplace?` and pick the **user** scope (every session): it works from that session on, and in every session you start after.

From a shell:

```
claude plugin install agent-office --marketplace hyuny0219/agent-office
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `hyuny0219/agent-office`, then Add plugin.

## Usage

| Command | What it does |
| --- | --- |
| `/office` | Open the office floor plan pane |
| `/office hr` | HR records: staff, rank, salary, latest review, done/failed, tool errors, reworks and attendance alerts by department, plus each department's repeated mistakes |
| `/office hr <nick>` | One employee's personnel card: rank and experience to the next rank, salary breakdown, record, token total, last 5 jobs, the department's repeated mistakes (`bear` or the Korean name both work, former employees too) |
| `/office approval on` / `off` | Turn approvals on or off (on by default): team leads sign off finished jobs' reports, and the planning lead reviews confirmed plans |
| `/office reorg on` / `off` | Turn reorganization on or off (on by default): employees with persistently poor reviews are asked to resign, and long-idle ones see their contracts end |
| `/office budget [<dept> <dollars>\|off]` | Show, set or remove a department's daily (last 24 hours) spending limit (e.g. `/office budget dev 5`) |
| `/office report [today\|week]` | Daily (last 24 hours, the default) or weekly (last 7 days) report: totals and per-department results, hours worked and labor cost, token usage (per department and top spenders), approval counts and each approver's accuracy, MVP, and jobs to look at (failed, finished with failing tests, reworked, attendance alerts, rejected) |
| `/office hr on` / `off` | Turn the HR memo in task briefs and the attendance notices on or off (on by default) |
| `/office hr ab on` / `off` | Turn training-effect measurement (a control group that gets no mistake list) on or off (on by default) |

The floor plan is drawn in pixels in the terminal (72 to 140 columns wide, 27 rows tall). The desktop app and VS Code show the list only.

Press a menu item above the pane (`1` roster · `2` daily report · `3` weekly report · `4` budget), or an employee's row (their personnel card), and the same text is left in the main chat as dim notice lines (split up when long). Notices are for you; the model doesn't read them. Open `5` settings to turn approvals, reorganization, the HR memo and training-effect measurement on or off right in the pane. The hotkeys work while the pane has focus.

## The office

- Upstairs: CEO office, meeting room, library, server room, restrooms. In the middle: a corridor with the entrance, reception desk, water cooler and vending machine. Downstairs: desk islands per department, and a pantry.
- What you see is what the agents are actually doing:
  - Writing, web and thinking → their own department desk (the monitor flickers with the kind of work)
  - Reads such as Read and Grep → library; Bash → server room
  - Talking to each other (being briefed at spawn, `SendMessage`, reporting back when done) → they gather in the meeting room with speech bubbles
  - Waiting (idle) → pantry, sofa or restroom
  - Done → report, then leave through the entrance
- New agents walk in from the entrance and walk the corridor when they change rooms. The main conversation is `BOSS`; subagents get animal nicknames (OWL, BEAR, HAWK, …).

### Office chatter

- **Speech bubbles**: a short line pops up above a head for about 3.5 seconds. The floor plan can only draw ASCII, so bubbles are in English.
  - Muttering (gray): `edit hr.ts`, `$ npm test`, `grep foo`
  - Talk (black): a briefing `BEAR, go!` → `yes!`, a message `-> OWL`, receiving a report `thanks!`
  - Reports (green) `done!`, mistakes (red) `oops!`
- **Office messenger**: the last 5 lines appear below the floor plan, in Korean: briefings (지시), reports (보고), messages (메시지), muttering from a Bash command's description (혼잣말), failed tools, and approvals (결재).
- Control characters are stripped from the messenger and bubbles, and values that look like tokens, keys or passwords are masked as `***`. Bash bubbles carry only the command name. The messenger is session state (`agent-office.feed`), so other mods in the same session can read it.
- The full task and report text used for approvals is kept inside the mod, not in pane state. After the mod reloads, jobs that started before the reload look like they ended without a report, and their approval is held.

## HR system

- **Departments** come from the agent type: Dev, Research, QA, Planning, Docs and Ops.
- **Employees**: one nickname is one person. Records persist across sessions.
- **Assignment**: when work comes in, the **best fit** among the department's free employees takes it; if nobody is free, the department hires. Fit is the average review, plus 3 per similar job done well (up to 3; similar means at least half the words of the task description overlap), minus 4 per similar job rejected, reworked or failed (up to 2), plus experience (up to 2). When there was a choice, the reason ("did 2 similar jobs well") is added to the HR memo and the order line in the messenger.
- **Reviews** use real records only: done +10, failed −5 (killed −3), −1 per tool error or denial (at most −5), +3 for finishing with no errors after actually using tools → grades S, A, B, C, D.
  - **Failed check**: finishing while the last test or build command (`npm test`, `tsc`, `pytest`, …; other commands such as `grep` are ignored) failed costs −4.
  - **Rework**: if BOSS edits a file the employee changed within 10 minutes of them finishing, that job loses 4 points (once per job).
  - The average review leans on recent work (the latest job weighs 30%).
- **Ranks** follow experience points: 사원 (staff) → 대리 (assistant manager, 20) → 과장 (manager, 60) → 차장 (deputy general manager, 120) → 부장 (general manager, 200). Penalties take experience away too, so employees can be demoted. The most experienced member of a department is its team lead.
- **Salary**: base pay by rank + a bonus from the average review + a team-lead allowance.

### Attendance

The office watches for warning signs, shows a toast and counts each attendance alert in the HR records (no points are taken off).

- **Repeating a mistake**: the same tool fails with the same error (ignoring paths and numbers) 3 times in a row. Each tool is counted separately, so other tools in between don't break the streak; a success of that tool does. Bash failures are told apart by command name (a `grep` with no match is not the same mistake as a failing `npm test`), and user or permission denials are not counted.
- **Running in place**: the same tool is called with the same input 4 times in a row (tools that poll for status, such as `TaskGet` or `Monitor`, are excluded).
- **Overtime**: one job held for more than 20 minutes is announced once and marked `overtime` in the list.

With `/office hr on`, repeating a mistake or running in place also adds **a short notice the employee reads after the tool result**: stop repeating the same approach, find another way, or report what's blocking and finish.

### The HR memo in task briefs

With `/office hr on` (the default), a short memo is appended to the end of each subagent's task brief when it spawns.
**The memo goes into the real prompt, so it affects how the agent behaves.**

The memo is written in Korean. In English it reads:

```
[In-house HR memo · agent-office]
Assignee: Dev team, BEAR, assistant manager (team lead: OWL, manager). Past record: 5 done · 1 failed · 6 tool errors, latest review A.
Mistakes the Dev team repeated recently. Avoid them this time:
- Edit "String to replace not found in file." 3 times → Before Edit, Read the part you are changing again and copy the original text exactly
Review criteria: finish the task, keep tool errors down, don't finish with a failing test or build. When you finish, briefly report what you did, what you checked and the risks that remain.
```

The repeated mistakes are subagents' tool error messages, grouped and counted by department (paths and numbers removed). Only those seen at least twice are added, most recent first, three at most. Mistakes not seen again for two weeks are left out.
Turn it off with `/office hr off`. Reviews and salaries keep being recorded either way.


### Approvals

No tool call is ever blocked. What goes up for approval is **the report of a finished job** and **a confirmed plan**.

- **Report approval**: when a subagent finishes, its department's team lead reads the task, the report and the record (tool errors, failing tests or builds, attendance alerts) and approves or rejects it. If the employee is the lead, or there is no lead, the boss (BOSS) signs off.
- **Delegated sign-off**: reports from 과장 (manager) rank and above, and short jobs with fewer than 3 tool calls, go through without review.
- **Rejection**: what to fix shows as a toast, and the main loop reads it along with the report (for a background job, after its next tool result). The main loop decides whether to hand the job back. A rejection costs that job -3 and shows on the personnel card and in reports.
- **Plan review**: when the main loop confirms a plan (ExitPlanMode), the planning lead checks for verification steps, scope, risks and guards against the departments' repeated mistakes. If something is missing it only adds a note; it never blocks.
- The approver is a cheap model (haiku), called once per approval (8-second limit, with a one-time notice the first time). It can be wrong; if the job ended without a report or the approver gives no usable answer, the approval is left pending and scores are untouched. To skip the cost, run `/office approval off`.
- **Approval accuracy**: whether an approval was right is judged by whether **someone else (BOSS or another employee) edits the same files within 10 minutes** of the job ending. Approved but then fixed is a missed approval; rejected but nobody fixes anything is a doubtful rejection. Jobs that changed no files (research, reading) can't be judged and are left out. Each approver's accuracy appears in `/office report`. Once an approver has 3 or more judged rejections and fewer than a third were right, their rejections **no longer cost points** and don't count against the employee when picking the best fit (the notes still reach the main loop). An employee editing their own files again in a later job doesn't count as a follow-up. A follow-up edit may just be the next step of the work, so this is a rough yardstick.

### Reorganization

With `/office reorg on` (the default), the roster is checked after each job is fully settled (review and approval) and when a session starts. Employees who are working, who were just assigned and are on their way in, or whose review and approval aren't finished are never touched. The first departure comes with a one-time notice.

- **Asked to resign**: 5 or more jobs and a recent average review below 0 (D).
- **Contract ends**: 2 jobs or fewer and no work for over 30 days.

Departures are announced with a toast and in the messenger (from HR), and stay in `/office hr`'s list of former employees and on their personnel card (`/office hr <nick>`). A former employee's nickname is never reused, so records don't mix; if a job of theirs finishes after they left, they are reinstated rather than hired anew. Departments come from the agent type and employees only take their own department's work, so there is no evidence that someone would do better elsewhere; there are no transfers.

### Reports

`/office report` is built from the log of finished jobs (the latest 300). The mod doesn't know your time zone, so "today" means the last 24 hours and "week" the last 7 days. Labor cost is a playful number: each employee's current salary turned into an hourly rate (40 hours × 52 weeks) times the time the job took.

### Token usage and cost

Every time an agent calls the model, the usage the engine reports (input, output, cache reads, cache writes) and an estimated cost in dollars at that model's Anthropic API list price are added to that agent. Cache writes are priced at 1.25× input (5-minute cache); Haiku 5.5's long-prompt surcharge and batch or regional pricing are not modeled. Tokens from models not in the price table are left out of the cost and shown as "price unknown" (tokens counted by v0.10 land here too, since their model wasn't recorded). On a subscription plan this is not what you pay, but what the same work would cost on the API. The pane row shows the current job's tokens (BOSS shows this session's), and when a job ends its tokens go into the job record and the employee's running total, shown in `/office hr` (total), `/office hr <nick>` (the four parts, average per job, per recent job) and `/office report` (overall, per department, top three spenders). Tokens an approver spends reviewing a job are counted separately as "approval". The number shown adds all four parts, so cache reads make up much of it (they are cheap; for cost, see the dollars in parentheses). BOSS's tokens appear only in the pane, not in HR records. The pane row also shows each agent's model in short form (the model that answered last, e.g. `Opus 5.5`). When a row is wider than the terminal, less important parts are shortened or dropped first: the quoted speech bubble → tool count → elapsed time → tokens (keeping only the cost) → Korean nickname → error count → cost → model. Who, where, attendance warnings and the task always stay. Plan reviews belong to no job and aren't counted, neither are steps of an agent that continues after it ended, and jobs finished before this feature have no tokens.

### Department budgets

Set a daily spending limit in dollars per department, e.g. `/office budget dev 5`. The department's cost over the last 24 hours (finished jobs plus their approvals, plus what employees at work right now have spent) is checked, and going over is announced with a toast and in the messenger (from HR). Each department is announced at most once per 24 hours; setting a new limit allows a new notice. It only warns and never stops work. The status is in `/office budget` and the daily report (`/office report`), and the limits are listed in `/office hr`. Departments can be named `개발팀`, `개발` or `dev`. BOSS has no department, so its cost counts toward no budget.

### Measuring the training effect

The office checks whether the mistake list in the memo actually prevents repeats.

- Of the jobs that would get a mistake list, **one in five gets the memo without the list** (the control group). The rest of the memo is the same.
- If a listed mistake happens again during the job it counts as a repeat. When the job ends, repeat rates are added per mistake for the memo group and the control group. `/office hr` shows lines like `measuring: memo 1 repeat in 8 jobs (13%) / control 2 in 3 (67%)` (in Korean).
- A verdict needs 10 memo jobs, 5 control jobs and at least 2 repeats in the control group, so rare mistakes are not dropped on no evidence. If the memo-group repeat rate is then not lower, the mistake is marked **no effect**, left out of the memo **for two weeks**, and measured again from scratch after that.
- To stop holding back the list, run `/office hr ab off`. Mistakes that were left out come back, and the collected numbers are kept.
## Settings

The agent-office entry in `/config`:

| Setting | Description |
| --- | --- |
| `attachTo` | The id of a side pane another mod opens. When set, the floor plan is also drawn under that pane (the side panel shows one tab at a time, so this lets you see the other pane and the office together, one above the other). Leave it empty to draw only in the `/office` pane. |

## Development

```
claude plugin validate .
claude plugin test .
claude --plugin-dir .
```

`hooks/register.tsx` only wires engine events; the work is split up: `store.ts` (state and persistence), `flow.ts` (sync, reviews, approvals, attendance, reorganization), `view.ts` (pane rows, painting the floor plan), `commands.ts` (`/office` text answers), `menu.ts` (the pane menu: a press leaves a notice in the chat). Decisions live in pure modules: `hr.ts` (HR), `org.ts` (assignment, approval accuracy, reorganization), `approval.ts` (approvals), `speech.ts` (chatter), `report.ts` (reports, roster, personnel cards), `tokens.ts` (token usage and cost), `budget.ts` (department budgets), `trial.ts` (training effect), `watch.ts` (attendance), `scene.ts` (floor plan).

The README screenshots (`docs/office.png`, `docs/office.gif`) are made by running `hooks/scene.ts` itself (needs Pillow):

```
npx tsx scripts/screenshot-frames.mts > /tmp/frames.json
python3 scripts/render-screenshot.py /tmp/frames.json docs
```

## License

[MIT](LICENSE)
