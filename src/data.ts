// 가상 '출장관리 시스템' 더미 데이터 — 3차 기획안 입력 데이터 샘플(input_data_sample) 기준

export type IssueType = 'feature' | 'bug'
export type Priority = 'high' | 'medium' | 'low'

export interface Issue {
  issue_id: string
  type: IssueType
  title: string
  requester: string
  priority: Priority
  created_at: string
  description: string
  acceptance_criteria: string[]
  custom?: boolean
}

export const SAMPLE_ISSUES: Issue[] = [
  {
    issue_id: 'ISSUE-1041',
    type: 'feature',
    title: '부서별 월간 출장비 통계 화면 추가',
    requester: '재무팀 / user_0117',
    priority: 'medium',
    created_at: '2026-10-02T16:20:00+09:00',
    description: '부서별·월별 출장비 합계를 한 화면에서 보고 싶다. 지금은 엑셀로 손으로 집계한다.',
    acceptance_criteria: [
      "AC-1 출장관리 > 통계 메뉴에 '부서별 월간 출장비' 화면 추가",
      'AC-2 조회 조건은 연도(필수)와 부서(선택)',
      'AC-3 부서 × 1~12월 출장비 합계와 연간 합계를 표로 표시',
      'AC-4 승인 완료(STATUS=APPROVED) 건만 집계',
      'AC-5 금액은 원 단위, 천 단위 구분 기호로 표시',
    ],
  },
  {
    issue_id: 'ISSUE-1042',
    type: 'feature',
    title: '출장 목록 CSV 내려받기',
    requester: '총무팀 / user_0231',
    priority: 'high',
    created_at: '2026-10-05T09:00:00+09:00',
    description: '조회한 출장 목록을 CSV로 받고 싶다',
    acceptance_criteria: [
      'AC-1 목록 화면 상단에 [CSV 내려받기] 버튼 표시',
      'AC-2 현재 검색 조건(기간·부서·상태)이 적용된 목록만',
      'AC-3 값이 없는 칸(null)은 빈 문자열로 출력',
      'AC-4 파일명은 trip_list_YYYYMMDD.csv',
    ],
  },
  {
    issue_id: 'ISSUE-1043',
    type: 'feature',
    title: '출장 승인 시 신청자에게 메일 알림',
    requester: '인사팀 / user_0342',
    priority: 'medium',
    created_at: '2026-10-03T11:05:00+09:00',
    description: '출장이 승인되면 신청자가 바로 알 수 있도록 메일을 보내 달라.',
    acceptance_criteria: [
      'AC-1 승인권자가 [승인]을 누르면 신청자에게 메일 1통 발송',
      'AC-2 메일에 출장지·기간·승인자·승인 일시 포함',
      'AC-3 메일 발송에 실패해도 승인은 정상 처리되고 실패 내역 기록',
    ],
  },
  {
    issue_id: 'ISSUE-1044',
    type: 'bug',
    title: '정산 금액 소수점 반올림 오류',
    requester: '재무팀 / user_0118',
    priority: 'high',
    created_at: '2026-10-03T15:40:00+09:00',
    description: '외화 출장비를 원화로 환산할 때 소수점 이하를 버려서 정산 금액이 1원씩 차이 난다.',
    acceptance_criteria: [
      'AC-1 환산 금액은 소수점 첫째 자리에서 반올림 (예: 152,340.6원 → 152,341원)',
      'AC-2 이미 정산 완료된 건의 금액은 바뀌지 않음',
    ],
  },
  {
    issue_id: 'ISSUE-1045',
    type: 'feature',
    title: '출장지 검색 자동완성',
    requester: '영업팀 / user_0455',
    priority: 'low',
    created_at: '2026-10-04T10:15:00+09:00',
    description: '출장 신청 때 출장지를 입력하면 자주 쓰는 출장지를 자동으로 보여 달라.',
    acceptance_criteria: [
      'AC-1 출장지 입력란에 2글자 이상 입력하면 후보를 최대 10개 표시',
      'AC-2 후보는 최근 1년 사용 빈도순 정렬',
      'AC-3 키보드 위/아래와 Enter로 후보 선택 가능',
    ],
  },
]

/** 시나리오 안내 — 이슈 선택 화면에 표시 */
export const SCENARIO_HINT: Record<string, string> = {
  'ISSUE-1042': '대표 시나리오 · AC-3 실패 → S07 되돌림 1회 후 통과 → 배포 승인',
  'ISSUE-1041': 'G1 반려 시나리오 · PL이 수용 기준 AC-4 수정을 요구',
  'ISSUE-1044': 'G5 사람 개입 시나리오 · S09 3회 실패(테스트 데이터 부족)',
  'ISSUE-1043': '일반 기능 · 규칙 기반 시뮬레이션',
  'ISSUE-1045': '일반 기능 · 규칙 기반 시뮬레이션',
}

export const DEPTS = ['총무팀', '재무팀', '영업팀', '인사팀']
export const DEPT_CODES: Record<string, string> = { D100: '총무팀', D200: '재무팀', D300: '영업팀', D400: '인사팀' }

export const TB_TRIP_COLUMNS = [
  ['TRIP_ID', 'VARCHAR(12)', '출장 ID'],
  ['EMP_NO', 'VARCHAR(8)', '신청자 사번'],
  ['DEPT_CD', 'VARCHAR(6)', '부서 코드'],
  ['DEST', 'VARCHAR(100)', '출장지'],
  ['START_DT', 'DATE', '시작일'],
  ['END_DT', 'DATE', '종료일'],
  ['STATUS', 'VARCHAR(10)', 'REQUESTED / APPROVED / REJECTED / CANCELED'],
  ['MEMO', 'VARCHAR(500) NULL', '비고 (없을 수 있음)'],
]

export const REGRESSION_APIS: [string, string, string, string][] = [
  ['GET', '/api/trips', '조회', '출장 목록'],
  ['GET', '/api/trips/{id}', '조회', '출장 상세'],
  ['GET', '/api/trips/summary', '조회', '출장 요약'],
  ['GET', '/api/trips/my', '조회', '내 출장'],
  ['GET', '/api/codes/trip-status', '조회', '상태 코드'],
  ['POST', '/api/trips', '수정', '출장 신청'],
  ['PUT', '/api/trips/{id}', '수정', '출장 수정'],
  ['DELETE', '/api/trips/{id}', '수정', '출장 취소'],
  ['POST', '/api/trips/{id}/attachments', '수정', '첨부 등록'],
  ['POST', '/api/trips/{id}/approve', '승인', '출장 승인'],
  ['POST', '/api/trips/{id}/reject', '승인', '출장 반려'],
  ['GET', '/api/approvals/pending', '승인', '승인 대기 목록'],
]

// ── 단계 정의 ──────────────────────────────────────────────
export type StageId =
  | 'S01' | 'S02' | 'G1' | 'S03' | 'S04-S06' | 'G2' | 'S07' | 'S07b' | 'S07c'
  | 'S08' | 'S09' | 'S10' | 'S11' | 'S13' | 'G4' | 'G5'

export const PIPELINE: StageId[] = [
  'S01', 'S02', 'G1', 'S03', 'S04-S06', 'G2', 'S07', 'S07b', 'S07c', 'S08', 'S09', 'S10', 'S11', 'S13', 'G4',
]

export const STAGE_INFO: Record<StageId, { name: string; ai: string; judge: string; gate?: boolean }> = {
  S01: { name: '접수', ai: '이슈 JSON 수신, 레포에서 관련 파일·비슷한 코드·DB 칼럼·회귀 대상 API 수집', judge: '수집 항목이 비어 있지 않은지 확인' },
  S02: { name: '요구사항·설계', ai: '요구사항 정리, 화면 그림·API 표 작성, 바꿀 화면·칼럼 판단', judge: '설계 속 경로·메뉴·칼럼이 레포에 실제로 있는지 대조' },
  G1: { name: '설계 승인', ai: '—', judge: 'PL이 설계 패키지를 보고 승인 / 반려', gate: true },
  S03: { name: '위험 등급', ai: '변경 범위를 낮음 / 보통 / 높음으로 분류', judge: '열 검토 단계는 계약 파일이 결정 (G1 확인 시 G2 생략)' },
  'S04-S06': { name: '구조·위협·작업', ai: '구조 검토, 위협 분석, 작업 나누기', judge: '계약 파일의 확인 항목 충족 여부' },
  G2: { name: '구조 승인', ai: '—', judge: '위험 등급 높음일 때만 PL 승인', gate: true },
  S07: { name: '구현', ai: '유사 코드를 참고해 구현, 실패 로그를 보고 자가 수정', judge: '확인 사다리: 컴파일 → 화면 빌드 → 기존 API 회귀 → 화면 시험, 실패 시 원상 복구' },
  S07b: { name: '목 테스트', ai: '기존 동작을 고정하는 특성 테스트 작성', judge: '버그 이슈에서만 실행 (기능 이슈는 API 요청 목록으로 대체)' },
  S07c: { name: 'API 요청 목록', ai: '확인할 API 요청과 기대 응답 생성', judge: '테스트 서버에 실제 재생 (목 테스트보다 버그 3배 이상 검출)' },
  S08: { name: 'AI 리뷰', ai: '바뀐 부분만 읽고 결함 지적 + 근거 코드 인용', judge: '인용 코드가 파일에 없거나 이미 통과한 코드를 "오류"라 하면 보류' },
  S09: { name: '수용 기준 대조', ai: '수용 기준별 충족 여부와 근거 작성', judge: '실행 결과와 대조, 실패 시 그 파일을 만든 단계로 되돌림' },
  S10: { name: '보안 검사', ai: '변경분 보안 점검 항목 정리', judge: '정적 분석·의존성 검사 실행 결과' },
  S11: { name: '통합 검사', ai: '—', judge: '통합 테스트 서버에서 전체 시나리오 실행' },
  S13: { name: '배포 준비 요약', ai: '변경·검증 결과를 PL용 문장으로 요약', judge: '요약 속 숫자(파일 수·통과 건수)를 실제 값과 대조' },
  G4: { name: '배포 승인', ai: '—', judge: 'PL이 배포 준비 요약을 보고 승인 / 반려', gate: true },
  G5: { name: '사람 개입', ai: '—', judge: '3회 실패 또는 45분 초과 시 개발자가 원인 판단', gate: true },
}

export const FUTURE_STAGES = ['S14 카나리 배포', 'S15 단계 확대', 'S16 지표 관측', 'S17 회귀 감지', 'S18 롤백·환류']

// ── ISSUE-1042 실행 결과 (04_run_results) ─────────────────────
export const CSV_HEADER = 'TRIP_ID,EMP_NO,DEPT_CD,DEST,START_DT,END_DT,STATUS,MEMO'

export const R1042 = {
  menu: '출장관리 > 출장 목록',
  similar: 'ExpenseCsvExport.java — 정산 내역 CSV 내려받기 (검색 조건 → CSV 응답, 같은 패턴)',
  files1: [
    ['backend/.../trip/TripListController.java', 18, 0],
    ['backend/.../trip/TripListService.java', 41, 2],
    ['backend/.../mapper/TripMapper.xml', 6, 0],
    ['frontend/src/views/trip/TripList.vue', 22, 1],
  ] as [string, number, number][],
  files2: [['backend/.../trip/TripListService.java', 4, 1]] as [string, number, number][],
  ladder1: [
    ['compile', 'pass', '10.4s', 'TODO/FIXME 0건'],
    ['ui_build', 'pass', '13.7s', '화면 빌드 성공'],
    ['api_regression', 'pass', '44.5s', '기존 API 12/12'],
    ['ui_test', 'pass', '23.1s', '콘솔 오류 0 · 실패 API 0'],
  ],
  ladder2: [
    ['compile', 'pass', '9.8s', 'TODO/FIXME 0건'],
    ['ui_build', 'skip', '—', '화면 파일 변경 없음'],
    ['api_regression', 'pass', '43.9s', '기존 API 12/12'],
    ['ui_test', 'pass', '22.6s', '콘솔 오류 0 · 실패 API 0'],
  ],
  api: [
    { id: 'REQ-01', cond: '기간', path: 'GET /api/trips/export?from=2026-09-01&to=2026-09-30', expected: 7, actual: 7 },
    { id: 'REQ-02', cond: '기간+부서', path: 'GET /api/trips/export?from=2026-09-01&to=2026-09-30&dept=D100', expected: 3, actual: 3 },
    { id: 'REQ-03', cond: '기간+상태', path: 'GET /api/trips/export?from=2026-09-01&to=2026-09-30&status=APPROVED', expected: 5, actual: 5 },
  ],
  csv1: [
    'T2609-0001,E1001,D100,부산 해운대구,2026-09-03,2026-09-04,APPROVED,거래처 미팅',
    'T2609-0002,E1014,D200,대전 유성구,2026-09-08,2026-09-08,APPROVED,null',
    'T2609-0003,E1002,D100,광주 북구,2026-09-10,2026-09-11,APPROVED,현장 점검',
    'T2609-0004,E1031,D300,울산 남구,2026-09-15,2026-09-17,REJECTED,일정 중복',
    'T2609-0005,E1003,D100,제주 제주시,2026-09-18,2026-09-19,APPROVED,null',
    'T2609-0006,E1042,D400,수원 영통구,2026-09-22,2026-09-22,REQUESTED,null',
    'T2609-0007,E1015,D200,창원 성산구,2026-09-24,2026-09-25,APPROVED,협력사 감사',
  ],
  csv2: [
    'T2609-0001,E1001,D100,부산 해운대구,2026-09-03,2026-09-04,APPROVED,거래처 미팅',
    'T2609-0002,E1014,D200,대전 유성구,2026-09-08,2026-09-08,APPROVED,',
    'T2609-0003,E1002,D100,광주 북구,2026-09-10,2026-09-11,APPROVED,현장 점검',
    'T2609-0004,E1031,D300,울산 남구,2026-09-15,2026-09-17,REJECTED,일정 중복',
    'T2609-0005,E1003,D100,제주 제주시,2026-09-18,2026-09-19,APPROVED,',
    'T2609-0006,E1042,D400,수원 영통구,2026-09-22,2026-09-22,REQUESTED,',
    'T2609-0007,E1015,D200,창원 성산구,2026-09-24,2026-09-25,APPROVED,협력사 감사',
  ],
  findings: [
    {
      id: 'F-01', file: 'TripListService.java', line: 88, severity: '중간',
      message: 'CSV에 UTF-8 BOM이 없어 엑셀에서 열면 한글이 깨질 수 있음',
      quoted: 'response.setContentType("text/csv; charset=UTF-8");',
      found: true, decision: '반영', note: '인용 코드가 파일에 있음 → S07로 전달',
    },
    {
      id: 'F-02', file: 'TripMapper.xml', line: 42, severity: '높음',
      message: '검색어를 ${}로 직접 붙여 SQL 인젝션 위험',
      quoted: "WHERE DEST LIKE '%${keyword}%'",
      found: false, decision: '보류', note: '인용 코드가 파일에 없음 (실제는 #{keyword} 바인딩) → 규칙 Q4b',
    },
  ],
  ac1: [
    ['AC-1', 'pass', '화면 시험: 버튼 1개 확인, 콘솔 오류 0건'],
    ['AC-2', 'pass', 'API 재생: 검색 조건 3종 응답 건수가 DB와 일치 (7·3·5건)'],
    ['AC-3', 'fail', 'REQ-01: T2609-0002, T2609-0005, T2609-0006 행 MEMO 칸에 문자열 "null" 출력 (기대: 빈 문자열) → S07로 되돌림 · 원인 파일 TripListService.java'],
    ['AC-4', 'pass', '응답 헤더 파일명 trip_list_20261005.csv'],
  ],
  ac2: [
    ['AC-1', 'pass', '화면 시험: 버튼 1개 확인, 콘솔 오류 0건'],
    ['AC-2', 'pass', 'API 재생: 검색 조건 3종 응답 건수 일치 (7·3·5건)'],
    ['AC-3', 'pass', 'REQ-01: T2609-0002, T2609-0005, T2609-0006 행 MEMO 칸 빈 문자열'],
    ['AC-4', 'pass', '응답 헤더 파일명 trip_list_20261005.csv'],
  ],
}

// 개선 전후 시범 실험 수치 (기획안 1쪽)
export const METRICS = {
  before: { minutes: 95.6, label: '사람에게 넘김 (재시도 한도 초과)' },
  after: { minutes: 20.9, label: '승인 도달' },
  mockRate: '20~24%',
  apiRate: '77~82%',
}
