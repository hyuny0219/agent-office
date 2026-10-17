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
| `/office hr <nick>` | One employee's personnel card: rank and experience to the next rank, salary breakdown, record, last 5 jobs, the department's repeated mistakes (`bear` or the Korean name both work) |
| `/office report [today\|week]` | Daily (last 24 hours, the default) or weekly (last 7 days) report: totals and per-department results, hours worked and labor cost, MVP, and jobs to look at (failed, finished with failing tests, reworked, attendance alerts) |
| `/office hr on` / `off` | Turn the HR memo in task briefs and the attendance notices on or off (on by default) |
| `/office hr ab on` / `off` | Turn training-effect measurement (a control group that gets no mistake list) on or off (on by default) |

The floor plan is drawn in pixels in the terminal (72 to 140 columns wide, 27 rows tall). The desktop app and VS Code show the list only.

## The office

- Upstairs: CEO office, meeting room, library, server room, restrooms. In the middle: a corridor with the entrance, reception desk, water cooler and vending machine. Downstairs: desk islands per department, and a pantry.
- What you see is what the agents are actually doing:
  - Writing, web and thinking → their own department desk (the monitor flickers with the kind of work)
  - Reads such as Read and Grep → library; Bash → server room
  - Talking to each other (being briefed at spawn, `SendMessage`, reporting back when done) → they gather in the meeting room with speech bubbles
  - Waiting (idle) → pantry, sofa or restroom
  - Done → report, then leave through the entrance
- New agents walk in from the entrance and walk the corridor when they change rooms. The main conversation is `BOSS`; subagents get animal nicknames (OWL, BEAR, HAWK, …).

## HR system

- **Departments** come from the agent type: Dev, Research, QA, Planning, Docs and Ops.
- **Employees**: one nickname is one person. When work comes in, the most experienced employee of that department who is free takes it; if nobody is free, the department hires. Records persist across sessions.
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


### Reports

`/office report` is built from the log of finished jobs (the latest 300). The mod doesn't know your time zone, so "today" means the last 24 hours and "week" the last 7 days. Labor cost is a playful number: each employee's current salary turned into an hourly rate (40 hours × 52 weeks) times the time the job took.

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

The README screenshots (`docs/office.png`, `docs/office.gif`) are made by running `hooks/scene.ts` itself (needs Pillow):

```
npx tsx scripts/screenshot-frames.mts > /tmp/frames.json
python3 scripts/render-screenshot.py /tmp/frames.json docs
```

## License

[MIT](LICENSE)
