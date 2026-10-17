import { Card, PageHead } from '../ui'

const STAGE_ROWS = [
  ['S02 설계', '화면 그림 · API 표 작성, 바꿀 화면 · 칼럼 판단', '설계 속 경로 · 메뉴 · 칼럼이 레포에 실제 있는지 대조 → G1'],
  ['S03 위험 등급', '변경 범위를 낮음 / 보통 / 높음으로 분류', '열 검토 단계는 계약 파일이 결정 (G1 확인 시 G2 생략)'],
  ['S07 구현', '유사 코드를 참고해 구현, 실패 로그로 자가 수정', '컴파일 → 화면 빌드 → 기존 API 회귀 → 화면 시험, 실패 시 원상 복구'],
  ['S07c API 목록', '확인할 API 요청과 기대 응답 생성', '테스트 서버에 실제 재생 (목 테스트보다 버그 3배 이상 검출)'],
  ['S08 AI 리뷰', '바뀐 부분만 읽고 결함 지적 + 근거 제시', '인용 코드가 없거나 이미 통과한 코드를 “오류”라 하면 보류'],
  ['S09 기준 대조', '수용 기준별 충족 여부와 근거 작성', '실행 결과와 대조, 실패 시 그 파일을 만든 단계로 되돌림'],
  ['S13 요약', '변경 · 검증 결과를 PL용 문장으로 요약', '요약 속 숫자(파일 수 · 통과 건수)를 실제 값과 대조'],
]

const CANDIDATES = [
  {
    name: 'Qwen3.8-27B (사내 GPU 서버)', tag: '1순위 · 채택', tone: 'green',
    pros: ['코드 · 데이터 외부 반출 없음', '호출 과금 없음 → 실패 시 반복 검증에 유리', '오픈 모델이라 다른 모델로 교체 가능', 'Qwen Code CLI로 파일 읽기 · 수정 · 명령 실행'],
    cons: ['GPU 서버 운영 부담', '대형 상용 모델보다 긴 설계 추론이 약할 수 있음 → 실행기 판정으로 보완'],
  },
  {
    name: '사내 구동 소형 오픈 모델 (7B~14B급)', tag: '보조 후보', tone: 'blue',
    pros: ['S03 위험 등급 분류 · S13 요약처럼 짧은 작업을 빠르게 처리', 'GPU 자원 적게 사용'],
    cons: ['구현(S07) · 설계(S02) 품질 부족 → 주 모델로는 부적합'],
  },
  {
    name: '클라우드 상용 LLM API', tag: '제외', tone: 'gray',
    pros: ['코드 생성 · 추론 성능이 높음', '서버 운영 불필요'],
    cons: ['사내 코드가 외부로 나감 (보안 정책 위반 소지)', '반복 검증할수록 호출 비용 증가'],
  },
]

export default function ModelInfo() {
  return (
    <div className="page">
      <PageHead title="AI 모델 안내" sub="실제 서비스에서 AI가 맡을 역할과 적용할 모델 후보, AI 결과를 믿을 수 있게 만드는 장치입니다." />

      <div className="roles3">
        <div className="r3 g">
          <b>AI(모델)는 만든다</b>
          <span>설계 · 코드 · API 요청 목록 · 리뷰 근거</span>
        </div>
        <div className="r3 b">
          <b>실행기는 판정한다</b>
          <span>빌드 · API 재생 · 화면 시험 · 사실 대조</span>
        </div>
        <div className="r3 r">
          <b>사람은 승인한다</b>
          <span>G1 설계 · G4 배포 승인 · G5 판단</span>
        </div>
      </div>

      <Card title="단계별 AI 역할과 믿는 근거">
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>단계</th>
                <th>AI가 하는 처리 · 판단</th>
                <th>AI 결과를 믿는 근거 (기계 판정)</th>
              </tr>
            </thead>
            <tbody>
              {STAGE_ROWS.map(r => (
                <tr key={r[0]}>
                  <td className="strong">{r[0]}</td>
                  <td>{r[1]}</td>
                  <td>{r[2]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="적용 모델 후보 비교">
        <div className="cands">
          {CANDIDATES.map(c => (
            <div key={c.name} className={`cand c-${c.tone}`}>
              <div className="cand-h">
                <b>{c.name}</b>
                <span className={`chip c-${c.tone}`}>{c.tag}</span>
              </div>
              <ul className="pros">
                {c.pros.map(p => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
              <ul className="cons">
                {c.cons.map(p => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Card>

      <Card title="프로토타입 연동">
        <ul className="plain proto">
          <li>실제 AI(GPT-OSS 20B, Pollinations 무료 공개 API)가 만드는 것: 이슈 초안 · 설계 요구사항 · 위험 등급 · 코드 변경안 · API 테스트 요청 · 코드 리뷰(구현 코드를 별도 호출이 검토) · 배포 요약 · PL 질문 답변.</li>
          <li>AI가 쓰는 과정은 실시간으로 화면에 보여 주고, 결과는 실행기 검사(요구사항 반영 · 근거 인용 · 추적 주석 · 리뷰 인용 · 숫자 대조 · 언급한 파일 · API 대조)를 거친 뒤에만 씁니다. 위험 등급은 규칙 판정보다 낮아지지 않습니다.</li>
          <li>빌드 · 테스트 실행은 시뮬레이션입니다. 실제 도입 시에는 호출 주소만 사내 Qwen 서버로 바꾸면 됩니다.</li>
        </ul>
      </Card>

      <Card title="AI 결과를 믿을 수 있게 만드는 장치">
        <div className="guards">
          <div><b>실행으로 판정</b><span>AI의 말이 아니라 빌드 · API 재생 · 화면 시험 결과로 통과를 결정</span></div>
          <div><b>재시도 3회 · 45분 상한</b><span>넘으면 멈추고 G5로 사람에게 넘김 — 헛돌기 방지</span></div>
          <div><b>근거 없는 지적은 보류</b><span>인용한 코드가 파일에 없으면 리뷰 지적을 반영하지 않음</span></div>
          <div><b>정지 알림</b><span>10분 이상 멈추면 담당자에게 알림 — 멈춘 줄 모르고 시간이 새는 것 방지</span></div>
        </div>
      </Card>

      <p className="foot-note">※ 본 프로토타입은 이슈 초안 · 설계 · 위험 등급 · 코드 · API 테스트 요청 · 리뷰 · 배포 요약 · PL 답변을 실제 AI로 생성하고, 빌드 · 테스트 실행은 시범 실행 결과 데이터로 시뮬레이션합니다. 이슈 · 코드 · 인물 · 조직 정보는 모두 가상 데이터입니다.</p>
    </div>
  )
}
