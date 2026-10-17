// 실제 AI 연동 — 상태 · 사실 값 · 화면 조각
import { useEffect, useRef, useState } from 'react'
import { REGRESSION_APIS } from './data'
import type { Issue } from './data'
import { artifactsOf, buildScenario } from './engine'
import type { Run } from './engine'
import { MODEL_LABEL, checkNumbers, compareRisk, templateSummary } from './liveAi'
import type { AiFacts, AiFailure, AiIssue, AiProgress, AiResult, AskContext, AskResult, Check, ImplResult } from './liveAi'
import { Badge, Card } from './ui'

export type Phase = 'waiting' | 'calling' | 'thinking' | 'streaming' | 'done'

export interface AiSlot<T> {
  status: Phase
  token: number
  startedAt: number
  doneAt?: number
  seconds?: number
  stream?: string
  feedback?: string
  note?: string
  result?: T | AiFailure
}
export type AiState = AiSlot<AiResult>
export type ImplState = AiSlot<ImplResult>

export interface QaItem {
  id: number
  q: string
  status: Phase
  startedAt: number
  seconds?: number
  stream?: string
  result?: AskResult | AiFailure
}

export interface LogItem {
  kind: string
  ok: boolean
  ms: number
  at: string
  cached: boolean
  reason?: string
}

export const aiPending = (a?: { status: Phase }) => !!a && a.status !== 'done'

/** AI 작업창은 답변이 끝난 뒤에도 잠깐(2초) 열어 두어 결과를 읽을 수 있게 한다 */
export const AFTER_MS = 2000
export const recentlyDone = (a?: { status: Phase; doneAt?: number }) => !!a && a.status === 'done' && !!a.doneAt && Date.now() - a.doneAt < AFTER_MS
export const showConsole = (a?: { status: Phase; doneAt?: number }) => aiPending(a) || recentlyDone(a)
const okOf = <T extends { ok: true }>(a?: AiSlot<T>): T | null => (a?.status === 'done' && a.result?.ok ? (a.result as T) : null)
export const aiOk = (a?: AiState) => okOf(a)
export const implOk = (a?: ImplState) => okOf(a)

/** 실시간 조각이 초당 수십 번 오므로 화면 갱신은 80ms에 한 번으로 묶는다 */
export function throttleProgress(f: (p: AiProgress) => void) {
  let last = 0
  let timer = 0
  let pending: AiProgress | null = null
  return (p: AiProgress) => {
    if (p.phase !== 'streaming') {
      clearTimeout(timer)
      timer = 0
      pending = null
      return f(p)
    }
    pending = p
    if (Date.now() - last > 80) {
      last = Date.now()
      pending = null
      return f(p)
    }
    if (!timer)
      timer = window.setTimeout(() => {
        timer = 0
        last = Date.now()
        if (pending) f(pending)
        pending = null
      }, 80)
  }
}

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

const fileName = (p: string) => p.split('/').pop() ?? p

/** 구현 호출 대상: 핵심 파일 · 새 API · 함께 바뀌는 파일 */
export function implTarget(issue: Issue) {
  const art = artifactsOf(issue)
  const file = fileName(art.files[1]?.[0]?.[0] ?? art.files[0][0][0])
  return { file, api: `${art.apiTable[0][0]} ${art.apiTable[0][1]}`, others: art.files[0].map(f => fileName(f[0])).filter(f => f !== file) }
}

/** 구현 · 질문에 넘길 설계 요구사항: AI 결과가 있으면 그것, 없으면 시뮬레이션 설계 */
export const reqTexts = (issue: Issue, d: AiResult | null) => (d ? d.requirements.map(r => r.text) : artifactsOf(issue).requirements.slice(0, 4))

export function askContext(issue: Issue, d: AiResult | null): AskContext {
  const art = artifactsOf(issue)
  return {
    issue: toAiIssue(issue),
    requirements: reqTexts(issue, d),
    files: art.files[0].map(f => fileName(f[0])),
    newApi: `${art.apiTable[0][0]} ${art.apiTable[0][1]}`,
    regression: REGRESSION_APIS.map(r => `${r[0]} ${r[1]} ${r[3]}`),
  }
}

/** 배포 준비(S13) 시점의 실제 값으로 AI 요약 속 숫자를 다시 대조 */
export function summaryView(issue: Issue, run: Run, res: AiResult) {
  const facts = factsOf(issue, run.rollbacks)
  const check = checkNumbers(toAiIssue(issue), facts, res.aiSummary)
  return { fromAi: check.pass, text: check.pass ? res.aiSummary : templateSummary(toAiIssue(issue), facts), check }
}

const held = (im: ImplResult) => im.review.filter(f => !f.kept).length

/** 실행 로그 · 방금 완료 상자에 AI 결과를 덧붙인 문구 */
export function noteWithAi(h: { stage: string; note: string; attempt: number }, issue: Issue, run: Run, d: AiResult | null, im: ImplResult | null) {
  const { stage, note, attempt } = h
  if (d && stage === 'S02') return `${note} · 실제 AI 요구사항 ${d.requirements.length}개`
  if (d && stage === 'S03') {
    const cmp = compareRisk(d.risk, run.risk)
    return cmp.tone === 'green' ? `${note} · AI 판정도 ${d.risk} (규칙과 일치)` : `${note} · ${cmp.text}`
  }
  if (im && stage === 'S07' && attempt === 1) return `${note} · 실제 AI 코드 ${im.code.split('\n').length}줄`
  if (im && stage === 'S07c' && im.apiRequests.length) return `AI가 만든 API 테스트 요청 ${im.apiRequests.length}건 재생 통과`
  if (im && stage === 'S08' && attempt === 1) return `AI 자기 리뷰 지적 ${im.review.length}건: 반영 ${im.review.length - held(im)} · 보류 ${held(im)}`
  if (d && stage === 'S13')
    return summaryView(issue, run, d).fromAi ? note.replace('배포 준비 요약 생성', '배포 준비 요약 생성(실제 AI)') : 'AI 요약 숫자 불일치 → 템플릿 요약으로 대체 → G4 요청'
  return note
}

/** 로그 점 색: AI 검사 결과가 주의면 주황 */
export function logTone(h: { stage: string; result?: string; attempt: number }, issue: Issue, run: Run, d: AiResult | null, im: ImplResult | null) {
  if (d && h.stage === 'S13' && !summaryView(issue, run, d).fromAi) return 'findings'
  if (im && h.stage === 'S08' && h.attempt === 1) return held(im) ? 'findings' : 'pass'
  return h.result ?? 'pass'
}

export interface CheckRow {
  label: string
  pass: boolean
  detail: string
}

/** 이 이슈에서 실제 AI 결과에 대해 실행기가 한 검사 목록 */
export function aiChecks(issue: Issue, run: Run | undefined, d: AiResult | null, im: ImplResult | null): CheckRow[] {
  const rows: CheckRow[] = []
  if (issue.aiDraft) issue.aiDraft.checks.forEach((c, i) => rows.push({ label: i ? '이슈 초안 · 모호한 표현' : '이슈 초안 · 기준 개수', ...c }))
  if (d) {
    rows.push({ label: '설계 요구사항', ...d.checks.coverage }, { label: '위험 근거 인용', ...d.checks.evidence })
    if (run) {
      const c = compareRisk(d.risk, run.risk)
      rows.push({ label: '위험 등급 비교', pass: c.tone === 'green', detail: `AI ${d.risk} · 규칙 ${run.risk} → ${c.text}` })
    }
  }
  if (im) rows.push({ label: '코드 추적 주석', ...im.checks.tags }, { label: 'API 요청 범위', ...im.checks.api }, { label: '리뷰 인용 확인', ...im.checks.review })
  if (d && run?.history.some(h => h.stage === 'S13')) rows.push({ label: '요약 숫자 대조', ...summaryView(issue, run, d).check })
  return rows
}

/** 흐름도에서 실제 AI가 일한 노드 · 지금 일하는 노드 */
export function aiNodeMarks(issue: Issue, run: Run | undefined, design: AiState | undefined, impl: ImplState | undefined, at: number) {
  const d = aiOk(design)
  const im = implOk(impl)
  const marks = new Set<number>()
  const add = (i: number, on: boolean) => on && i <= at && marks.add(i)
  add(0, !!issue.aiDraft)
  add(1, !!d)
  add(3, !!d || !!im)
  add(4, !!im?.apiRequests.length)
  add(5, !!im?.review.length)
  add(7, !!d)
  const s = run?.current?.ev.stage
  const working = s === 'S02' && aiPending(design) ? 1 : s === 'S07' && aiPending(impl) ? 3 : undefined
  return { marks, working }
}

function useTick(active: boolean, ms = 1000) {
  const [, set] = useState(0)
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => set(x => x + 1), ms)
    return () => clearInterval(t)
  }, [active, ms])
}

const since = (t: number) => Math.max(0, (Date.now() - t) / 1000)
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

export const phaseText = (p: { status: Phase; seconds?: number }) =>
  p.status === 'waiting'
    ? `무료 한도 대기 · ${p.seconds ?? ''}초 후 호출`
    : p.status === 'calling'
      ? 'AI 서버 연결 중'
      : p.status === 'thinking'
        ? 'AI가 내용을 검토하는 중'
        : p.status === 'streaming'
          ? `실제 AI 작성 중 · ${MODEL_LABEL}`
          : '작성 완료'

/** 화면 위 상태 배지: 일하는 중이면 그 단계, 끝났으면 실제 AI 응답 수 */
export function AiBadge({ slots, count }: { slots: ({ status: Phase; seconds?: number; startedAt: number; result?: { ok: boolean } } | undefined)[]; count: number }) {
  const busy = slots.find(s => aiPending(s))
  useTick(!!busy)
  if (busy) return <Badge tone={busy.status === 'waiting' ? 'orange' : 'blue'}>{busy.status === 'waiting' ? phaseText(busy) : `AI 작업 중 · ${Math.round(since(busy.startedAt))}초`}</Badge>
  if (count > 0)
    return (
      <Badge tone="green">
        <span className="dot" />
        실제 AI · {MODEL_LABEL} · 응답 {count}건
      </Badge>
    )
  if (slots.some(s => s?.result && !s.result.ok)) return <Badge tone="gray">시뮬레이션 · AI 응답 없음</Badge>
  return null
}

/** AI 작업창: AI가 쓰는 내용을 실시간으로 보여 준다 */
export function AiConsole({ slot, preview, label }: { slot: { status: Phase; seconds?: number; startedAt: number; doneAt?: number; result?: { ok: boolean } }; preview: string; label: string }) {
  useTick(aiPending(slot), 200)
  const ref = useRef<HTMLPreElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight
  }, [preview])
  const live = slot.status === 'streaming'
  const idle = slot.status === 'waiting' || slot.status === 'calling' || slot.status === 'thinking'
  const failed = slot.status === 'done' && slot.result?.ok === false
  const elapsed = ((slot.doneAt ?? Date.now()) - slot.startedAt) / 1000
  return (
    <div className="console">
      <div className="console-top">
        <span className={`live p-${failed ? 'failed' : slot.status}`}>
          {slot.status !== 'done' ? phaseText(slot) : failed ? 'AI 응답 없음 · 시뮬레이션으로 진행' : '작성 완료 · 실행기 검사로 넘어갑니다'}
        </span>
        <span className="mono">{label} · {Math.max(0, elapsed).toFixed(1)}초</span>
      </div>
      <pre ref={ref}>
        {preview}
        {idle && !preview && <span className="dim">{slot.status === 'waiting' ? '무료 AI는 접속자당 30초에 1번 부를 수 있어 차례를 기다립니다.' : slot.status === 'thinking' ? 'AI가 이슈와 수용 기준을 읽고 있습니다…' : 'AI 서버에 요청을 보냈습니다…'}</span>}
        {(live || idle) && <span className="caret" />}
      </pre>
    </div>
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

/** 구현 산출물이 각 단계를 마쳤을 때 "방금 완료" 상자에 붙는 내용 */
export function ImplDetail({ stage, im }: { stage: string; im: ImplResult }) {
  if (stage === 'S07')
    return (
      <>
        <CheckLine c={im.checks.tags} />
        <span className="sim-note">AI 작성 코드 · 빌드와 테스트 실행은 시뮬레이션</span>
      </>
    )
  if (stage === 'S07c')
    return (
      <>
        <span className="mini-list">
          {im.apiRequests.map(r => (
            <span key={r.id}>
              <b className="mono">{r.id}</b> {r.cond || r.request} → {r.expected}
            </span>
          ))}
        </span>
        <CheckLine c={im.checks.api} />
      </>
    )
  return (
    <>
      <span className="mini-list">
        {im.review.map(f => (
          <span key={f.id}>
            <b className="mono">{f.id}</b> {f.message} <em className={f.kept ? 'ok' : 'warn'}>{f.kept ? '반영' : '보류'}</em>
          </span>
        ))}
      </span>
      <CheckLine c={im.checks.review} />
    </>
  )
}

const QUICK_QS = ['기존 출장 승인 API에 영향이 있어?', '이 설계에서 가장 조심해야 할 부분은?']

/** G1 설계 승인 화면: PL이 AI에게 질문 */
export function AskBox({ items, onAsk }: { items: QaItem[]; onAsk: (q: string) => void }) {
  const [q, setQ] = useState('')
  const busy = items.some(i => aiPending(i))
  useTick(busy)
  const send = (text: string) => {
    if (!text.trim() || busy) return
    onAsk(text.trim())
    setQ('')
  }
  return (
    <div className="ask">
      <div className="ask-h">
        <b>AI에게 질문</b>
        <span className="muted small">이슈 · 설계 · 바꿀 파일 · API 목록만 근거로 답하고, 언급한 파일 · API는 실행기가 실제 목록과 대조합니다</span>
      </div>
      {items.map(it => (
        <div key={it.id} className="qa">
          <div className="bubble q">{it.q}</div>
          <div className="bubble a">
            {it.result?.ok ? it.result.answer : it.result ? <span className="muted">답변을 받지 못했습니다 · {it.result.reason}</span> : it.stream || <span className="muted">{phaseText(it)}</span>}
            {aiPending(it) && it.status === 'streaming' && <span className="caret dark" />}
            {it.result?.ok && <CheckLine c={it.result.check} />}
          </div>
        </div>
      ))}
      <div className="ask-f">
        <input value={q} disabled={busy} placeholder={busy ? 'AI가 답하는 중입니다' : '예: 이 변경이 기존 승인 API에 영향이 있어?'} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && send(q)} />
        <button className="btn" disabled={busy || !q.trim()} onClick={() => send(q)}>
          질문
        </button>
      </div>
      {!items.length && (
        <div className="chips">
          {QUICK_QS.map(s => (
            <button key={s} className="chip-btn" onClick={() => send(s)}>
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** 흐름도 아래 한 줄 요약 */
export function AiActivityBar({ calls, kinds, rows, working }: { calls: number; kinds: number; rows: CheckRow[]; working: boolean }) {
  if (!calls && !working) return null
  const pass = rows.filter(r => r.pass).length
  return (
    <div className="ai-bar">
      <b className="ai-bar-k">AI 활동</b>
      <span>
        실제 AI 응답 <b>{calls}</b>건
      </span>
      <span>
        산출물 <b>{kinds}</b>종
      </span>
      {rows.length > 0 && (
        <span>
          실행기 검사 <b>{rows.length}</b>건 중 <b>{pass}</b>건 통과{rows.length - pass ? ` · ${rows.length - pass}건 보류·주의` : ''}
        </span>
      )}
      {working && <span className="ai-bar-live">AI 작업 중</span>}
    </div>
  )
}

/** 결과 화면 맨 아래 카드 */
export function AiResultCard({ issue, run, design, impl, qa, log }: { issue: Issue; run: Run; design?: AiState; impl?: ImplState; qa: QaItem[]; log: LogItem[] }) {
  const [open, setOpen] = useState<'' | 'code' | 'd' | 'i'>('')
  const d = aiOk(design)
  const im = implOk(impl)
  const rows = aiChecks(issue, run, d, im)
  const answered = qa.filter(i => i.result?.ok)
  const fails = [design, impl].filter(s => s?.result && !s.result.ok) as AiSlot<unknown>[]
  const toggle = (k: typeof open) => setOpen(o => (o === k ? '' : k))
  return (
    <Card title="실제 AI 처리 내역" extra={<AiBadge slots={[design, impl]} count={log.filter(l => l.ok).length} />}>
      <p className="ai-meta">
        {MODEL_LABEL} · Pollinations 무료 공개 API(키 없음) · 응답 {log.filter(l => l.ok).length}건 · 실시간 생성
      </p>
      {fails.map((s, k) => (
        <p key={k} className="ai-sub warn">
          AI 응답 없음 → 시뮬레이션으로 진행 · {(s.result as AiFailure).reason}
        </p>
      ))}
      {rows.length > 0 && (
        <ul className="ai-checks">
          {rows.map(r => (
            <li key={r.label}>
              <span className={`mk ${r.pass ? 'ok' : 'warn'}`}>{r.pass ? '✓' : '!'}</span>
              <span className="k">{r.label}</span>
              <span className="d">{r.detail}</span>
            </li>
          ))}
        </ul>
      )}
      {d && !summaryView(issue, run, d).fromAi && <p className="ai-sub">AI 요약 원문: {d.aiSummary}</p>}
      {answered.length > 0 && (
        <div className="ai-qa">
          <h4>PL 질문과 AI 답변</h4>
          {answered.map(i => (
            <p key={i.id}>
              <b>Q.</b> {i.q}
              <br />
              <b>A.</b> {(i.result as AskResult).answer}
            </p>
          ))}
        </div>
      )}
      {log.length > 0 && (
        <div className="ai-log">
          <h4>AI 호출 기록</h4>
          <ul>
            {log.map((l, k) => (
              <li key={k}>
                <span className="mono">{stamp(l.at)}</span>
                <span>{l.kind}</span>
                <span className="mono">{l.cached ? '저장된 결과' : `${(l.ms / 1000).toFixed(1)}초`}</span>
                <span className={l.ok ? 'ok' : 'warn'}>{l.ok ? '성공' : `실패 · ${l.reason ?? ''}`}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="ai-raw-wrap">
        {im && (
          <button className="btn sm" onClick={() => toggle('code')}>
            {open === 'code' ? 'AI 작성 코드 닫기' : 'AI 작성 코드 보기'}
          </button>
        )}
        {design?.result?.raw && (
          <button className="btn sm" onClick={() => toggle('d')}>
            설계 응답 원문
          </button>
        )}
        {impl?.result?.raw && (
          <button className="btn sm" onClick={() => toggle('i')}>
            구현 응답 원문
          </button>
        )}
      </div>
      {open === 'code' && im && (
        <>
          <pre className="ai-raw code">{`// ${im.file} — AI 작성\n${im.code}`}</pre>
          <span className="sim-note">AI 작성 코드 · 빌드와 테스트 실행은 시뮬레이션</span>
        </>
      )}
      {open === 'd' && design?.result?.raw && <pre className="ai-raw">{pretty(design.result.raw)}</pre>}
      {open === 'i' && impl?.result?.raw && <pre className="ai-raw">{impl.result.raw}</pre>}
    </Card>
  )
}
