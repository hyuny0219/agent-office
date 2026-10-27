# omp-agent-office

oh-my-pi(omp) 확장입니다. 서브에이전트(`task` 도구)를 부서 직원으로 받아 평가·결재·인사 기록·업무 노트·토큰 비용을 남기고, 입력창 위에 사무실 목록과 (켜면) 걸어 다니는 사무실 평면도를 보입니다.

Claude Code판(agent-office 플러그인)과 판단 코드(`core/`)는 같지만, 이 패키지는 따로 배포되고 인사 기록도 따로 남습니다(`~/.omp/agent-office/hr.json`, 환경 변수 `AGENT_OFFICE_HOME`으로 바꿀 수 있음).

## 설치

사내 레지스트리에 올린 패키지를 설치한 뒤 omp 설정의 `extensions`에 그 폴더를 넣거나, 한 번만 써 보려면 `-e`로 불러옵니다.

```sh
npm install -g omp-agent-office --registry <사내 레지스트리>
omp -e "$(npm root -g)/omp-agent-office/omp/index.ts"
```

계속 쓰려면 `~/.omp/agent/settings.json`의 `extensions`에 `"<설치 경로>/omp-agent-office"`를 넣습니다(패키지의 `omp.extensions`가 `omp/index.ts`를 가리킵니다).

## 쓰는 법

| 명령 | 하는 일 |
| --- | --- |
| `/office` | 입력창 위에 사무실 평면도 켜고 끄기(목록은 늘 보임) |
| `/office menu` | 메뉴 화면: `1` 인사 명부 · `2` 일간 보고 · `3` 주간 보고 · `4` 예산 · `5` 설정 · `6` 지침(`5`에서 `a` 결재 · `r` 조직 개편 · `m` 인사 메모 · `t` 교육 효과 측정), `q`·Esc 닫기 |
| `/office hr [<별칭>]` | 인사 명부, 인사카드 |
| `/office report [today\|week]` | 일간·주간 보고 |
| `/office playbook [<부서> adopt <n\|all>\|<부서> drop <n>]` | 부서 지침(에이전트 개선): 반복되는 흠으로 만든 후보 채택·빼기, 전후 비교(메뉴 `6`에서 보기) |
| `/office rate <별칭> good\|bad\|clear` | 가장 최근 일에 대표 평가 |
| `/office budget [<부서> <달러>\|<부서> off]` | 부서 하루 비용 한도 |
| `/office approval\|reorg\|hr on\|off` | 결재·조직 개편·인사 메모 켜고 끄기 |

- 인사 메모(담당·지난 기록·부서가 반복한 실수·업무 노트)는 그 서브에이전트의 시스템 프롬프트에만 붙고, 메인이 보낸 지시는 건드리지 않습니다.
- 결재는 결재자 모델(Haiku)을 한 번 부르며, 반려 의견은 메인이 `wait`(또는 `task`)로 결과를 받을 때 그 뒤에 붙습니다.
- 토큰 비용은 omp가 알려 주는 사용량을 모델별 API 정가로 어림한 값입니다.

## 아직 없는 것(Claude Code판에는 있음)

근태 알림(같은 실수 연발·제자리걸음 때 도구 결과 뒤에 붙는 알림), 교육 효과 측정의 비교군 배정, 계획 검토(ExitPlanMode), 평면도 캐릭터 클릭.
