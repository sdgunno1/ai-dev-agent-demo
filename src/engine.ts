// 공정 시뮬레이션 엔진 — 실제 AI 대신 단계 이벤트를 순서대로 재생한다.
import { R1042, REGRESSION_APIS, STAGE_INFO } from './data'
import type { Issue, StageId } from './data'

export type Result = 'pass' | 'fail' | 'findings' | 'skip' | 'approved' | 'rejected' | 'resolved'
export type Risk = '낮음' | '보통' | '높음'

export interface Ev {
  kind: 'stage' | 'gate'
  stage: StageId
  result?: Result
  note: string
  details?: string[]
  duration_s: number
  routeTo?: StageId
  /** 게이트: 기본 코멘트 / 반려 예시 / G5 재개 이벤트 */
  comment?: string
  suggestReject?: string
  resume?: Ev[]
}

export interface ExecEv extends Ev {
  attempt: number
  start: number // 하루 기준 초
  end: number
}

export interface Approval {
  gate: StageId
  attempt: number
  decision: 'approved' | 'rejected' | 'resolved'
  by: string
  text: string
  at: number
}

export type RunStatus = 'running' | 'paused' | 'gate' | 'done'

export interface Run {
  issueId: string
  queue: Ev[]
  history: ExecEv[]
  current?: { ev: Ev; attempt: number; start: number }
  status: RunStatus
  gate?: { ev: Ev; attempt: number; since: number; simStart: number }
  rollbacks: number
  approvals: Approval[]
  clock: number
  risk: Risk
  dateLabel: string
}

// ── 시각 유틸 ─────────────────────────────────────────────
export const hms = (t: number) => {
  const h = Math.floor(t / 3600) % 24, m = Math.floor((t % 3600) / 60), s = Math.floor(t % 60)
  return [h, m, s].map(v => String(v).padStart(2, '0')).join(':')
}
export const hm = (t: number) => hms(t).slice(0, 5)

const hash = (s: string) => {
  let h = 7
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return h
}

// ── 위험 등급 규칙 ────────────────────────────────────────
const HIGH_WORDS = ['보안', '권한', '결제', '정산', '삭제', '개인정보']
export function riskOf(issue: Issue): { risk: Risk; reason: string } {
  if (issue.issue_id === 'ISSUE-1042') return { risk: '낮음', reason: '기존 목록 API 확장 + 화면 버튼 1개, 권한·결제·삭제 변경 없음' }
  const text = issue.title + ' ' + issue.description
  const hit = HIGH_WORDS.find(w => text.includes(w))
  if (issue.type === 'bug' || hit)
    return { risk: '높음', reason: issue.type === 'bug' ? `버그 수정${hit ? ` · '${hit}' 관련` : ''} → 기존 동작 영향 검토 필요` : `'${hit}' 관련 변경 → 보안·구조 검토 필요` }
  if (issue.acceptance_criteria.length >= 4) return { risk: '보통', reason: `수용 기준 ${issue.acceptance_criteria.length}개 · 새 화면/API 추가` }
  return { risk: '낮음', reason: `수용 기준 ${issue.acceptance_criteria.length}개 · 변경 범위 작음` }
}

// ── 이슈별 산출물(설계·변경 파일·API·리뷰·검증) ─────────────
const SLUG_RULES: [string, string, string][] = [
  ['CSV', 'TripListExport', '/api/trips/export'],
  ['통계', 'TripStat', '/api/trips/stats'],
  ['메일', 'TripApprovalMail', '/api/trips/{id}/approve'],
  ['반올림', 'ExpenseCalc', '/api/expenses/convert'],
  ['정산', 'ExpenseCalc', '/api/expenses/convert'],
  ['자동완성', 'DestAutocomplete', '/api/trips/destinations'],
  ['검색', 'TripSearch', '/api/trips/search'],
  ['알림', 'TripNotify', '/api/notifications'],
]

export function slugOf(issue: Issue) {
  const r = SLUG_RULES.find(([k]) => (issue.title + issue.description).includes(k))
  if (r) return { name: r[1], api: r[2] }
  const n = issue.issue_id.replace(/\D/g, '')
  return { name: `Feature${n}`, api: `/api/feature-${n}` }
}

export interface Artifacts {
  menu: string
  similar: string
  files: [string, number, number][][] // 시도별
  ladders: string[][][]
  api: { id: string; cond: string; path: string; expected: number | string; actual: number | string }[]
  csv?: { before: string[]; after: string[] }
  findings: typeof R1042.findings
  ac: string[][][] // 시도별 [AC, result, evidence]
  requirements: string[]
  apiTable: [string, string, string, string][]
}

function evidenceFor(ac: string): string {
  if (/화면|버튼|메뉴|표시|키보드|입력란/.test(ac)) return '화면 시험: 요소 확인, 콘솔 오류 0건'
  if (/메일/.test(ac)) return '모의 메일 서버 수신 1건, 본문 항목 확인'
  if (/정렬|빈도/.test(ac)) return 'API 재생: 응답 순서가 기대값과 일치'
  if (/금액|합계|반올림/.test(ac)) return 'API 재생: 계산 결과가 기대 금액과 일치'
  return 'API 재생: 기대 응답과 일치'
}

export function artifactsOf(issue: Issue): Artifacts {
  const acIds = issue.acceptance_criteria.map((a, i) => a.match(/^AC-\d+/)?.[0] ?? `AC-${i + 1}`)
  if (issue.issue_id === 'ISSUE-1042') {
    return {
      menu: R1042.menu,
      similar: R1042.similar,
      files: [R1042.files1, R1042.files2],
      ladders: [R1042.ladder1, R1042.ladder2],
      api: R1042.api,
      csv: { before: R1042.csv1, after: R1042.csv2 },
      findings: R1042.findings,
      ac: [R1042.ac1, R1042.ac2],
      requirements: [
        '출장 목록 화면 상단에 [CSV 내려받기] 버튼을 추가한다',
        '현재 검색 조건(기간·부서·상태)을 그대로 넘겨 같은 목록을 CSV로 만든다',
        'NULL 칸은 빈 문자열, 첫 줄은 칼럼명(TB_TRIP 8개)',
        '파일명 trip_list_YYYYMMDD.csv, UTF-8',
      ],
      apiTable: [['GET', '/api/trips/export', 'from, to, dept?, status?', 'text/csv (trip_list_YYYYMMDD.csv)']],
    }
  }
  const { name, api } = slugOf(issue)
  const h = hash(issue.issue_id + issue.title)
  const n = (k: number, base: number) => base + ((h >>> k) % 30)
  const isBug = issue.type === 'bug'
  const files: [string, number, number][] = isBug
    ? [[`backend/.../expense/${name}.java`, n(1, 6), n(2, 2) % 6 + 1], [`backend/.../expense/${name}Test.java`, n(3, 20), 0]]
    : [
        [`backend/.../trip/${name}Controller.java`, n(1, 12), 0],
        [`backend/.../trip/${name}Service.java`, n(2, 25), n(3, 1) % 4],
        [`backend/.../mapper/${name}Mapper.xml`, n(4, 5), 0],
        [`frontend/src/views/trip/${name}.vue`, n(5, 18), n(6, 1) % 3],
      ]
  const fixFile = files[isBug ? 0 : 1]
  const ladderPass = [
    ['compile', 'pass', `${(9 + (h % 4)).toFixed(1)}s`, 'TODO/FIXME 0건'],
    ['ui_build', isBug ? 'skip' : 'pass', isBug ? '—' : '13.2s', isBug ? '화면 파일 변경 없음' : '화면 빌드 성공'],
    ['api_regression', 'pass', '44.1s', '기존 API 12/12'],
    ['ui_test', 'pass', '22.8s', '콘솔 오류 0 · 실패 API 0'],
  ]
  const ladder2 = ladderPass.map(r => (r[0] === 'ui_build' ? ['ui_build', 'skip', '—', '화면 파일 변경 없음'] : r))
  const apiReqs = isBug
    ? [
        { id: 'REQ-01', cond: '외화 환산 (소수점 .6)', path: `POST ${api}`, expected: '152,341원', actual: '152,341원' },
        { id: 'REQ-02', cond: '외화 환산 (소수점 .4)', path: `POST ${api}?case=2`, expected: '152,340원', actual: '152,340원' },
        { id: 'REQ-03', cond: '원화 거래 (환산 없음)', path: `POST ${api}?case=3`, expected: '88,000원', actual: '88,000원' },
      ]
    : ['기본 조회', '조건 1개 적용', '조건 2개 적용'].map((c, i) => {
        const e = 1 + ((h >>> (i * 3)) % 9)
        return { id: `REQ-0${i + 1}`, cond: c, path: `GET ${api}${i ? `?case=${i + 1}` : ''}`, expected: e, actual: e }
      })
  const findings = isBug
    ? []
    : [
        {
          id: 'F-01', file: fixFile[0].split('/').pop()!, line: 40 + (h % 50), severity: '중간',
          message: '입력값 길이 검증이 없어 긴 값이 들어오면 DB 오류가 날 수 있음',
          quoted: 'String keyword = request.getParameter("q");',
          found: true, decision: '반영', note: '인용 코드가 파일에 있음 → S07로 전달',
        },
      ]
  let ac: string[][][]
  if (issue.issue_id === 'ISSUE-1044') {
    const fail = ['AC-2', 'fail', '판정 불가: 정산 완료 건 테스트 데이터가 없음 (실패 SQL: SELECT … WHERE SETTLE_STATUS=\'DONE\' → 0건)']
    const a1 = ['AC-1', 'pass', 'API 재생: 152,340.6원 → 152,341원, 152,340.4원 → 152,340원']
    ac = [[a1, fail], [a1, fail], [a1, fail], [a1, ['AC-2', 'pass', '정산 완료 건 2건 재조회: 금액 변동 없음']]]
  } else {
    const last = acIds.length - 1
    ac = [
      acIds.map((id, i) =>
        i === last
          ? [id, 'fail', `${evidenceFor(issue.acceptance_criteria[i])} → 실패: 기대값과 1건 불일치 → S07로 되돌림 · 원인 파일 ${fixFile[0].split('/').pop()}`]
          : [id, 'pass', evidenceFor(issue.acceptance_criteria[i])],
      ),
      acIds.map((id, i) => [id, 'pass', evidenceFor(issue.acceptance_criteria[i])]),
    ]
  }
  return {
    menu: isBug ? '정산관리 > 정산 내역' : `출장관리 > ${issue.title.replace(/ ?(추가|기능)$/, '')}`,
    similar: isBug ? 'ExchangeRateUtil.java — 환율 환산 공통 로직' : `${name.replace(/[A-Z][a-z]+$/, '')}Base 계열 기존 코드`,
    files: [files, [[fixFile[0], 3 + (h % 4), 1]]],
    ladders: [ladderPass, ladder2],
    api: apiReqs,
    findings,
    ac,
    requirements: [issue.description, ...issue.acceptance_criteria.map(a => a.replace(/^AC-\d+\s*/, ''))].slice(0, 5),
    apiTable: [[apiReqs[0].path.split(' ')[0], api, isBug ? 'amount, currency, rate' : '검색 조건', 'application/json']],
  }
}

// ── 시나리오(이벤트 목록) 만들기 ───────────────────────────
export const unit = (v: number | string) => (typeof v === 'number' ? `${v}건` : v)
const ladderLines = (rows: string[][]) => rows.map(r => `${r[0]} → ${r[1] === 'pass' ? '통과' : r[1] === 'skip' ? '생략' : '실패'} (${r[2]}, ${r[3]})`)

export function buildScenario(issue: Issue): Ev[] {
  const art = artifactsOf(issue)
  const { risk, reason } = riskOf(issue)
  const acN = issue.acceptance_criteria.length
  const is1042 = issue.issue_id === 'ISSUE-1042'
  const isBug = issue.type === 'bug'
  const fileCount = art.files[0].length
  const tail: Ev[] = [
    { kind: 'stage', stage: 'S10', result: 'pass', note: '보안 검사 이상 없음', details: ['정적 분석 경고 0건', '의존성 취약점 0건'], duration_s: 68 },
    { kind: 'stage', stage: 'S11', result: 'pass', note: '통합 검사 통과', details: ['통합 시나리오 실행: 기존 기능 포함 전체 통과'], duration_s: 65 },
    {
      kind: 'stage', stage: 'S13', result: 'pass', note: '배포 준비 요약 생성, 숫자 대조 통과 → G4 요청',
      details: [`요약 속 숫자 대조: 변경 파일 ${fileCount} · 수용 기준 ${acN}/${acN} · 회귀 12/12 → 실제 값과 일치`, 'G4 배포 승인 요청 알림 발송 (메신저·메일)'],
      duration_s: 45,
    },
    { kind: 'gate', stage: 'G4', note: '배포 승인 대기', duration_s: is1042 ? 870 : 900, comment: is1042 ? '10-06 정기 배포에 포함' : '다음 정기 배포에 포함' },
  ]

  const head: Ev[] = [
    {
      kind: 'stage', stage: 'S01', result: 'pass', note: '이슈 수신·레포 정보 수집',
      details: [`이슈 JSON 수신: ${issue.issue_id} (수용 기준 ${acN}개)`, `레포 정보 수집: 관련 파일 ${fileCount} · 비슷한 코드 1 · 회귀 API ${REGRESSION_APIS.length}`, `기능 브랜치 생성: feature/${issue.issue_id}`],
      duration_s: 67,
    },
    {
      kind: 'stage', stage: 'S02', result: 'pass', note: is1042 ? '설계-레포 대조 통과 (경로 4·메뉴 1·칼럼 8)' : `설계-레포 대조 통과 (경로 ${fileCount}·메뉴 1)`,
      details: [`설계 패키지 작성: 요구사항 ${art.requirements.length} · 화면 그림 1 · API 표 ${art.apiTable.length}`, '대조: 설계 속 파일 경로·메뉴·칼럼이 레포에 모두 존재', 'G1 설계 승인 요청 알림 발송'],
      duration_s: 396,
    },
    {
      kind: 'gate', stage: 'G1', note: '설계 승인 대기', duration_s: is1042 ? 1946 : 1500,
      comment: is1042 ? '설계 확인. 칼럼 순서는 화면 표와 같게 유지' : '설계 확인',
      suggestReject: issue.issue_id === 'ISSUE-1041' ? 'AC-4 수정 필요: 승인 완료가 아니라 정산 완료 건 기준으로 집계해야 함' : undefined,
    },
    { kind: 'stage', stage: 'S03', result: 'pass', note: `위험 등급 ${risk}`, details: [reason, risk === '높음' ? '계약 파일: 구조·위협 검토 + G2 구조 승인 단계 열림' : '계약 파일: 구조·보안 검토 간소화'], duration_s: 45 },
    { kind: 'stage', stage: 'S04-S06', result: 'pass', note: risk === '높음' ? '구조·위협 분석·작업 나누기 완료' : '구조·위협·작업 나누기, G2 생략(G1 설계 확인)', details: ['구조 검토: 기존 계층 구조 유지', '위협 분석: 입력값·권한 경계 확인', `작업 나누기: 파일 ${fileCount}개 단위`], duration_s: 293 },
    risk === '높음'
      ? { kind: 'gate', stage: 'G2', note: '구조 승인 대기', duration_s: 600, comment: '구조 확인' }
      : { kind: 'stage', stage: 'G2', result: 'skip', note: 'G1에서 설계 확인 → 생략', duration_s: 0 },
    { kind: 'stage', stage: 'S07', result: 'pass', note: '확인 사다리 4/4', details: [...art.files[0].map(f => `변경: ${f[0]} (+${f[1]} −${f[2]})`), ...ladderLines(art.ladders[0])], duration_s: is1042 ? 458 : 430 },
    isBug
      ? { kind: 'stage', stage: 'S07b', result: 'pass', note: '목 테스트: 기존 동작 고정 테스트 6건 통과', duration_s: 120 }
      : { kind: 'stage', stage: 'S07b', result: 'skip', note: '기능 이슈 → 목 테스트 생략 (API 요청 목록으로 대체)', duration_s: 0 },
    { kind: 'stage', stage: 'S07c', result: 'pass', note: `신규 API 요청 ${art.api.length}건 생성·재생 통과`, details: art.api.map(a => `${a.id} ${a.cond}: 기대 ${unit(a.expected)} · 실제 ${unit(a.actual)} → 통과`), duration_s: 111 },
  ]

  if (issue.issue_id === 'ISSUE-1044') {
    const s09fail = (k: number): Ev => ({
      kind: 'stage', stage: 'S09', result: 'fail', note: `AC-2 판정 불가: 정산 완료 건 테스트 데이터 없음 (재시도 ${k}/3)`,
      details: ['AC-1 통과: 152,340.6원 → 152,341원', 'AC-2 판정 불가: 실패 SQL — 정산 완료(SETTLE_STATUS=DONE) 건 0건'], duration_s: 60,
    })
    return [
      ...head,
      { kind: 'stage', stage: 'S08', result: 'pass', note: '변경분 리뷰, 지적 0건', duration_s: 95 },
      s09fail(1), s09fail(2), s09fail(3),
      {
        kind: 'gate', stage: 'G5', note: 'S09 3회 실패 → 사람 개입 요청', duration_s: 2014,
        comment: '정산 완료 건 테스트 데이터 2건 추가 후 S09부터 재개',
        details: ['실패 로그 첨부: S09 시도 1~3', '실패 SQL: SELECT … FROM TB_SETTLE WHERE SETTLE_STATUS=\'DONE\' → 0건'],
        resume: [{ kind: 'stage', stage: 'S09', result: 'pass', note: `수용 기준 ${acN}/${acN}`, details: ['AC-1 통과', 'AC-2 통과: 정산 완료 건 2건 금액 변동 없음'], duration_s: 50 }, ...tail],
      },
    ]
  }

  const f = art.findings
  const failAc = art.ac[0].find(r => r[1] === 'fail')!
  return [
    ...head,
    {
      kind: 'stage', stage: 'S08', result: 'findings',
      note: f.length > 1 ? `지적 ${f.length}건: 반영 1(F-01), 보류 1(F-02, Q4b)` : `지적 ${f.length}건: 반영 1(F-01)`,
      details: f.map(x => `${x.id} ${x.file}:${x.line} — ${x.message} → ${x.decision}${x.found ? '' : ' (인용 코드 없음)'}`), duration_s: 141,
    },
    { kind: 'stage', stage: 'S09', result: 'fail', routeTo: 'S07', note: `${failAc[0]} 실패 → S07로 되돌림`, details: art.ac[0].map(r => `${r[0]} ${r[1] === 'pass' ? '통과' : '실패'}: ${r[2]}`), duration_s: 78 },
    { kind: 'stage', stage: 'S07', result: 'pass', note: `F-01·${failAc[0]} 반영, 사다리 통과(화면 빌드 생략)`, details: [...art.files[1].map(x => `변경: ${x[0]} (+${x[1]} −${x[2]})`), ...ladderLines(art.ladders[1])], duration_s: 199 },
    { kind: 'stage', stage: 'S08', result: 'pass', note: '변경분 리뷰, 새 지적 0', duration_s: 49 },
    { kind: 'stage', stage: 'S09', result: 'pass', note: `수용 기준 ${acN}/${acN}`, details: art.ac[1].map(r => `${r[0]} 통과: ${r[2]}`), duration_s: 42 },
    ...tail,
  ]
}

// ── 실행 상태 머신 ────────────────────────────────────────
export function newRun(issue: Issue): Run {
  const custom = issue.custom
  const d = new Date(issue.created_at)
  const startClock = issue.issue_id === 'ISSUE-1042' ? 9 * 3600 + 5 : d.getHours() * 3600 + d.getMinutes() * 60
  return {
    issueId: issue.issue_id,
    queue: buildScenario(issue),
    history: [],
    status: 'running',
    rollbacks: 0,
    approvals: [],
    clock: startClock,
    risk: riskOf(issue).risk,
    dateLabel: custom ? d.toISOString().slice(0, 10) : issue.issue_id === 'ISSUE-1042' ? '2026-10-05' : issue.created_at.slice(0, 10),
  }
}

const nextAttempt = (r: Run, stage: StageId) => r.history.filter(h => h.stage === stage).length + 1

/** 한 박자 진행: 대기 중인 이벤트 시작 → 다음 박자에 완료 */
export function step(r: Run): Run {
  if (r.status !== 'running') return r
  if (r.current) {
    const { ev, attempt, start } = r.current
    const ex: ExecEv = { ...ev, attempt, start, end: start + ev.duration_s }
    return {
      ...r,
      current: undefined,
      history: [...r.history, ex],
      clock: ex.end + 2,
      rollbacks: r.rollbacks + (ev.routeTo ? 1 : 0),
    }
  }
  const [ev, ...rest] = r.queue
  if (!ev) return { ...r, status: 'done' }
  const attempt = nextAttempt(r, ev.stage)
  if (ev.kind === 'gate') {
    return { ...r, queue: rest, status: 'gate', gate: { ev, attempt, since: Date.now(), simStart: r.clock } }
  }
  if (ev.result === 'skip') {
    const ex: ExecEv = { ...ev, attempt, start: r.clock, end: r.clock }
    return { ...r, queue: rest, history: [...r.history, ex] }
  }
  return { ...r, queue: rest, current: { ev, attempt, start: r.clock } }
}

export type GateAction = { type: 'approve'; text?: string } | { type: 'reject'; text: string; routeTo?: StageId }

export function act(r: Run, a: GateAction, by = 'PL_01'): Run {
  if (r.status !== 'gate' || !r.gate) return r
  const { ev, attempt, simStart } = r.gate
  const end = simStart + ev.duration_s
  const isG5 = ev.stage === 'G5'
  const decision: Approval['decision'] = a.type === 'reject' ? 'rejected' : isG5 ? 'resolved' : 'approved'
  const ex: ExecEv = {
    ...ev, attempt, start: simStart, end, result: decision,
    note: a.type === 'reject' ? `${by} 반려 — ${a.text}` : `${isG5 ? 'DEV_03 처리' : `${by} 승인`} — ${a.text || ev.comment || ''}`,
  }
  const approval: Approval = { gate: ev.stage, attempt, decision, by: isG5 ? 'DEV_03' : by, text: a.text || ev.comment || '', at: end }
  const base: Run = { ...r, history: [...r.history, ex], approvals: [...r.approvals, approval], gate: undefined, clock: end + 4 }

  if (a.type === 'approve') {
    if (ev.stage === 'G4') return { ...base, status: 'done' }
    if (isG5) return { ...base, status: 'running', queue: [...(ev.resume ?? []), ...base.queue] }
    return { ...base, status: 'running' }
  }
  // 반려 → 해당 단계로 되돌림
  if (ev.stage === 'G1' || ev.stage === 'G2') {
    const redo: Ev[] = [
      { kind: 'stage', stage: 'S02', result: 'pass', note: `반려 사유 반영해 설계 수정: ${a.text}`, details: ['수정된 설계 패키지 재작성', '설계-레포 대조 재실행 → 통과'], duration_s: 280 },
      { ...ev, suggestReject: undefined },
    ]
    return { ...base, status: 'running', rollbacks: base.rollbacks + 1, queue: [...redo, ...base.queue] }
  }
  // G4 반려 → 구현부터 다시
  const fromIdx = r.history.findIndex(h => h.stage === (a.routeTo ?? 'S07'))
  const redo: Ev[] = r.history
    .slice(fromIdx)
    .filter(h => h.kind === 'stage' && h.result !== 'skip' && h.result !== 'fail')
    .filter((h, i, arr) => arr.findIndex(x => x.stage === h.stage) === i)
    .map(h => ({
      kind: 'stage' as const, stage: h.stage, result: 'pass' as const,
      note: h.stage === (a.routeTo ?? 'S07') ? `G4 반려 사유 반영: ${a.text}` : h.stage === 'S08' ? '변경분 리뷰, 새 지적 0' : h.note,
      details: h.stage === 'S08' ? [] : h.details, duration_s: Math.round(h.duration_s * 0.6),
    }))
  return { ...base, status: 'running', rollbacks: base.rollbacks + 1, queue: [...redo, { ...ev }] }
}

/** 결과 바로 보기: 남은 단계를 즉시 진행하고 게이트는 기본 코멘트로 승인 */
export function fastForward(r: Run): Run {
  let cur = r.status === 'paused' ? { ...r, status: 'running' as RunStatus } : r
  for (let i = 0; i < 200 && cur.status !== 'done'; i++) {
    cur = cur.status === 'gate' ? act(cur, { type: 'approve' }) : step(cur)
  }
  return cur
}

// ── 화면용 파생 값 ─────────────────────────────────────────
export type StageView = 'pending' | 'running' | 'pass' | 'fail' | 'skip' | 'waiting' | 'rollback' | 'findings' | 'rejected'

export function stageView(r: Run | undefined, s: StageId): { view: StageView; attempts: number } {
  if (!r) return { view: 'pending', attempts: 0 }
  const hs = r.history.filter(h => h.stage === s)
  if (r.current?.ev.stage === s) return { view: 'running', attempts: hs.length + 1 }
  if (r.gate?.ev.stage === s) return { view: 'waiting', attempts: hs.length + 1 }
  const last = hs[hs.length - 1]
  if (!last) return { view: 'pending', attempts: 0 }
  const map: Record<Result, StageView> = { pass: 'pass', approved: 'pass', resolved: 'pass', fail: last.routeTo ? 'rollback' : 'fail', findings: 'findings', skip: 'skip', rejected: 'rejected' }
  return { view: map[last.result ?? 'pass'], attempts: hs.length }
}

export function currentStageLabel(r: Run | undefined) {
  if (!r) return '접수 대기'
  if (r.status === 'done') return '배포 대기'
  if (r.gate) return `${r.gate.ev.stage} ${STAGE_INFO[r.gate.ev.stage].name} 대기`
  const s = r.current?.ev.stage ?? r.history[r.history.length - 1]?.stage ?? 'S01'
  return `${s} ${STAGE_INFO[s].name}`
}

/** S07 첫 시작 ~ S13 마지막 완료 (분) */
export function implToReadyMinutes(r: Run) {
  const s07 = r.history.find(h => h.stage === 'S07')
  const s13 = [...r.history].reverse().find(h => h.stage === 'S13')
  if (!s07 || !s13) return null
  const stageSum = r.history.filter(h => h.kind === 'stage' && h.start >= s07.start && h.end <= s13.end).reduce((a, h) => a + h.duration_s, 0)
  return stageSum / 60
}

export function attemptsOf(r: Run | undefined, s: StageId) {
  return r ? r.history.filter(h => h.stage === s && h.kind === 'stage').length : 0
}
