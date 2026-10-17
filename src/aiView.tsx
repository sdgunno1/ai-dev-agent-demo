// 실제 AI 연동 — 상태 · 사실 값 · 화면 조각
import { useEffect, useState } from 'react'
import { REGRESSION_APIS } from './data'
import type { Issue } from './data'
import { artifactsOf, buildScenario } from './engine'
import type { Run } from './engine'
import { MODEL_LABEL, checkNumbers, compareRisk, templateSummary } from './liveAi'
import type { AiFacts, AiFailure, AiIssue, AiResult, Check } from './liveAi'
import { Badge, Card } from './ui'

export interface AiState {
  status: 'calling' | 'waiting' | 'done'
  token: number
  startedAt: number
  seconds?: number
  feedback?: string
  note?: string
  result?: AiResult | AiFailure
}

export const aiPending = (a?: AiState) => !!a && a.status !== 'done'
export const aiOk = (a?: AiState): AiResult | null => (a?.status === 'done' && a.result?.ok ? a.result : null)

export const toAiIssue = (i: Issue): AiIssue => ({
  id: i.issue_id, type: i.type, title: i.title, description: i.description, ac: i.acceptance_criteria,
})

export function factsOf(issue: Issue, rollbacks: number): AiFacts {
  const files = artifactsOf(issue).files[0]
  const backend = files.filter(f => !f[0].startsWith('frontend')).length
  return { files: files.length, backend, screen: files.length - backend, acTotal: issue.acceptance_criteria.length, regression: REGRESSION_APIS.length, rollbacks }
}

/** 호출 시점에는 시나리오상 예정된 되돌림 횟수를 넘긴다 */
export const predictedFacts = (issue: Issue) => factsOf(issue, buildScenario(issue).filter(e => e.routeTo).length)

/** 마지막 설계 반려 사유 — 반려 후 다시 호출할 때 프롬프트에 넣는다 */
export const lastFeedback = (r: Run) =>
  r.approvals.filter(a => (a.gate === 'G1' || a.gate === 'G2') && a.decision === 'rejected').slice(-1)[0]?.text

/** 배포 준비(S13) 시점의 실제 값으로 AI 요약 속 숫자를 다시 대조 */
export function summaryView(issue: Issue, run: Run, res: AiResult) {
  const facts = factsOf(issue, run.rollbacks)
  const check = checkNumbers(toAiIssue(issue), facts, res.aiSummary)
  return { fromAi: check.pass, text: check.pass ? res.aiSummary : templateSummary(toAiIssue(issue), facts), check }
}

/** 실행 로그 · 방금 완료 상자에 AI 결과를 덧붙인 문구 */
export function noteWithAi(stage: string, note: string, issue: Issue, run: Run, res: AiResult | null) {
  if (!res) return note
  if (stage === 'S02') return `${note} · 실제 AI 요구사항 ${res.requirements.length}개`
  if (stage === 'S03') {
    const cmp = compareRisk(res.risk, run.risk)
    return cmp.tone === 'green' ? `${note} · AI 판정도 ${res.risk} (규칙과 일치)` : `${note} · ${cmp.text}`
  }
  if (stage === 'S13')
    return summaryView(issue, run, res).fromAi
      ? note.replace('배포 준비 요약 생성', '배포 준비 요약 생성(실제 AI)')
      : 'AI 요약 숫자 불일치 → 템플릿 요약으로 대체 → G4 요청'
  return note
}

function useTick(active: boolean) {
  const [, set] = useState(0)
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => set(x => x + 1), 1000)
    return () => clearInterval(t)
  }, [active])
}

const since = (t: number) => Math.max(0, Math.round((Date.now() - t) / 1000))
const pad = (n: number) => String(n).padStart(2, '0')
const stamp = (iso: string) => {
  const d = new Date(iso)
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const pretty = (raw: string) => {
  try {
    return JSON.stringify(JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)), null, 2)
  } catch {
    return raw
  }
}

export function AiBadge({ state }: { state?: AiState }) {
  useTick(aiPending(state))
  if (!state) return null
  if (state.status === 'calling') return <Badge tone="blue">AI 호출 중 · {since(state.startedAt)}초</Badge>
  if (state.status === 'waiting') return <Badge tone="orange">무료 한도 대기 · {state.seconds}초 후 호출</Badge>
  const r = state.result
  if (r?.ok)
    return (
      <Badge tone="green">
        <span className="dot" />
        실제 AI · {MODEL_LABEL} · {r.cached ? '저장된 결과' : `${(r.elapsedMs / 1000).toFixed(1)}초`}
      </Badge>
    )
  return <Badge tone="gray">시뮬레이션 · AI 응답 없음</Badge>
}

/** 설계 단계에서 AI 응답을 기다리는 동안 "지금 하는 일"에 붙는 줄 */
export function AiWaitNote({ state }: { state?: AiState }) {
  useTick(aiPending(state))
  if (!state || !aiPending(state)) return null
  return (
    <p className="ai-wait">
      {state.status === 'waiting'
        ? `무료 AI 한도(접속자당 30초에 1회) — ${state.seconds}초 후 자동 호출${state.feedback ? ' · PL 반려 사유 반영' : ''}`
        : `실제 AI 호출 중 · ${since(state.startedAt)}초 경과${state.feedback ? ' · PL 반려 사유 반영해 다시 작성' : ''}`}
    </p>
  )
}

export function CheckLine({ c }: { c: Check }) {
  return (
    <span className={`check-line ${c.pass ? 'ok' : 'warn'}`}>
      {c.pass ? '✓' : '!'} 실행기 검사 · {c.detail}
    </span>
  )
}

/** G1 설계 승인 패널의 요구사항 목록 */
export function AiRequirements({ res, state }: { res: AiResult; state?: AiState }) {
  return (
    <>
      <ol className="plain num">
        {res.requirements.map((r, k) => (
          <li key={k}>
            <span className="req-t">{r.text}</span>
            <span className="ac-chips">
              {r.ac.map(a => (
                <span key={a} className="ac-chip">
                  {a}
                </span>
              ))}
            </span>
          </li>
        ))}
      </ol>
      <CheckLine c={res.checks.coverage} />
      {state?.feedback && <span className="ai-sub">PL 반려 사유를 반영해 다시 작성한 설계입니다</span>}
      {state?.note && <span className="ai-sub warn">{state.note}</span>}
    </>
  )
}

/** 위험 등급 단계가 끝났을 때 "방금 완료" 상자에 붙는 내용 */
export function AiRiskDetail({ res }: { res: AiResult }) {
  return (
    <>
      <span>
        AI 판정 <b className="inline">{res.risk}</b> — {res.riskReason}
      </span>
      {res.evidence.length > 0 && (
        <span className="quotes">
          {res.evidence.map(e => (
            <span key={e}>“{e}”</span>
          ))}
        </span>
      )}
      <CheckLine c={res.checks.evidence} />
    </>
  )
}

/** 결과 화면 맨 아래 카드 */
export function AiResultCard({ issue, run, state }: { issue: Issue; run: Run; state?: AiState }) {
  const [open, setOpen] = useState(false)
  const r = state?.result
  const raw = r?.raw
  let body
  if (!r) body = <p className="muted">이 실행에는 AI 호출 기록이 없습니다.</p>
  else if (!r.ok) body = <p className="muted">AI 응답이 없어 시뮬레이션 데이터로 진행했습니다 · 사유: {r.reason}</p>
  else {
    const sv = summaryView(issue, run, r)
    const cmp = compareRisk(r.risk, run.risk)
    const rows: [string, boolean, string][] = [
      ['설계 요구사항', r.checks.coverage.pass, r.checks.coverage.detail],
      ['위험 근거 인용', r.checks.evidence.pass, r.checks.evidence.detail],
      ['위험 등급 비교', cmp.tone === 'green', `AI ${r.risk} · 규칙 ${run.risk} → ${cmp.text}`],
      ['요약 숫자 대조', sv.check.pass, sv.check.detail],
    ]
    body = (
      <>
        <p className="ai-meta">
          {MODEL_LABEL} · Pollinations 무료 공개 API(키 없음) · {r.cached ? '저장된 결과' : `응답 ${(r.elapsedMs / 1000).toFixed(1)}초`} · {stamp(r.createdAt)}
          {state?.feedback ? ' · PL 반려 사유 반영 재작성' : ''}
        </p>
        <ul className="ai-checks">
          {rows.map(([k, pass, d]) => (
            <li key={k}>
              <span className={`mk ${pass ? 'ok' : 'warn'}`}>{pass ? '✓' : '!'}</span>
              <span className="k">{k}</span>
              <span className="d">{d}</span>
            </li>
          ))}
        </ul>
        {!sv.fromAi && <p className="ai-sub">AI 요약 원문: {r.aiSummary}</p>}
      </>
    )
  }
  return (
    <Card title="실제 AI 처리 내역" extra={<AiBadge state={state} />}>
      {body}
      {raw && (
        <div className="ai-raw-wrap">
          <button className="btn sm" onClick={() => setOpen(o => !o)}>
            {open ? 'AI 응답 원문 닫기' : 'AI 응답 원문 보기'}
          </button>
          {open && <pre className="ai-raw">{pretty(raw)}</pre>}
        </div>
      )}
    </Card>
  )
}
