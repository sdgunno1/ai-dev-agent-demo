import { useEffect, useMemo, useRef, useState } from 'react'
import { SAMPLE_ISSUES } from './data'
import type { Issue } from './data'
import { act, fastForward, newRun, step } from './engine'
import type { GateAction, Run } from './engine'
import Demo from './pages/Demo'
import type { Step } from './pages/Demo'
import Report from './pages/Report'
import ModelInfo from './pages/ModelInfo'
import { Icon } from './ui'
import { clearAiCache, getCachedDesign, getCachedImpl, runAsk, runDesign, runImpl } from './liveAi'
import type { AiFailure, AiProgress, AiResult } from './liveAi'
import { aiOk, aiPending, askContext, implTarget, lastFeedback, predictedFacts, reqTexts, showConsole, throttleProgress, toAiIssue } from './aiView'
import type { AiState, ImplState, LogItem, Phase, QaItem } from './aiView'

export type Page = 'input' | 'process' | 'result' | 'report' | 'model'
export type Speed = 'slow' | 'normal' | 'fast'

export interface Ctx {
  issues: Issue[]
  runs: Record<string, Run>
  ai: Record<string, AiState>
  impl: Record<string, ImplState>
  qa: Record<string, QaItem[]>
  aiLog: Record<string, LogItem[]>
  speed: Speed
  setSpeed: (s: Speed) => void
  go: (p: Page, id?: string) => void
  focusId: string
  select: (id: string) => void
  startRun: (issue: Issue) => void
  addIssue: (issue: Issue) => void
  gateAction: (id: string, a: GateAction) => void
  pause: (id: string, paused: boolean) => void
  finishNow: (id: string) => void
  ask: (id: string, q: string) => void
}

const NAV: { page: Page; label: string }[] = [
  { page: 'input', label: '서비스 시연' },
  { page: 'report', label: '검증 리포트' },
  { page: 'model', label: 'AI 모델' },
]

const DEMO: Page[] = ['input', 'process', 'result']
const DELAY: Record<Speed, number> = { slow: 1800, normal: 1000, fast: 420 }
const LS = 'ai-dev-agent-v4'

interface Saved {
  issues: Issue[]
  runs: Record<string, Run>
  speed: Speed
  aiLog: Record<string, LogItem[]>
  qa: Record<string, QaItem[]>
}

function load(): Saved {
  try {
    const raw = localStorage.getItem(LS)
    if (raw) {
      const d = JSON.parse(raw)
      return { issues: [...SAMPLE_ISSUES, ...(d.custom ?? [])], runs: d.runs ?? {}, speed: d.speed ?? 'normal', aiLog: d.aiLog ?? {}, qa: d.qa ?? {} }
    }
  } catch {
    /* 저장소를 못 쓰면 기본값으로 시작 */
  }
  return { issues: SAMPLE_ISSUES, runs: {}, speed: 'normal', aiLog: {}, qa: {} }
}

// 화면 이동은 메모리 상태로만 관리 (아티팩트 · 정적 호스팅 어디서든 동작)
const initialRoute = (): { page: Page; id?: string } => ({ page: 'input' })

type Outcome = { ok: true; elapsedMs: number; cached: boolean } | AiFailure

export default function App() {
  const init = useMemo(load, [])
  const [issues, setIssues] = useState<Issue[]>(init.issues)
  const [runs, setRuns] = useState<Record<string, Run>>(init.runs)
  const [speed, setSpeed] = useState<Speed>(init.speed)
  const [route, setRoute] = useState(initialRoute)
  const [focusId, setFocusId] = useState(route.id ?? 'ISSUE-1042')
  const [ai, setAi] = useState<Record<string, AiState>>({})
  const [impl, setImpl] = useState<Record<string, ImplState>>({})
  const [qa, setQa] = useState<Record<string, QaItem[]>>(init.qa)
  const [aiLog, setAiLog] = useState<Record<string, LogItem[]>>(init.aiLog)
  const aiRef = useRef(ai)
  const implRef = useRef(impl)
  const gen = useRef(0)
  aiRef.current = ai
  implRef.current = impl

  const logAi = (id: string, kind: string, res: Outcome, startedAt: number) =>
    setAiLog(s => ({
      ...s,
      [id]: [
        ...(s[id] ?? []),
        res.ok
          ? { kind, ok: true, ms: res.elapsedMs, at: new Date().toISOString(), cached: res.cached }
          : { kind, ok: false, ms: Date.now() - startedAt, at: new Date().toISOString(), cached: false, reason: res.reason },
      ],
    }))

  // 실시간 진행 상황을 상태에 반영 (끝난 뒤 늦게 도착한 조각은 버린다)
  const progress = (apply: (u: { status: Phase; seconds?: number; stream?: string }) => void) =>
    throttleProgress((p: AiProgress) => apply(p.text !== undefined ? { status: p.phase, seconds: p.seconds, stream: p.text } : { status: p.phase, seconds: p.seconds }))

  // ① 설계 호출 — 공정 1회에 1번 (설계 반려 시에는 반려 사유를 넣어 1번 더)
  const callDesign = (issue: Issue, feedback?: string) => {
    const id = issue.issue_id
    const token = Date.now() + Math.random()
    const startedAt = Date.now()
    const my = gen.current
    const patch = (f: (a: AiState) => AiState) => setAi(s => (s[id]?.token === token ? { ...s, [id]: f(s[id]) } : s))
    setAi(s => ({ ...s, [id]: { status: 'calling', token, startedAt, feedback, result: s[id]?.result } }))
    runDesign(toAiIssue(issue), predictedFacts(issue), progress(u => patch(a => (a.status === 'done' ? a : { ...a, ...u }))), feedback).then(res => {
      if (gen.current !== my || aiRef.current[id]?.token !== token) return
      logAi(id, feedback ? '설계 재작성 (반려 사유 반영)' : '설계 · 위험 등급 · 배포 요약', res, startedAt)
      patch(a =>
        !res.ok && feedback && a.result?.ok
          ? { ...a, status: 'done', doneAt: Date.now(), feedback: undefined, note: '반려 사유 반영 재호출 실패 → 이전 AI 설계 유지' }
          : { ...a, status: 'done', doneAt: Date.now(), result: res, note: undefined },
      )
    })
  }

  // ② 구현 호출 — 설계 승인 직후 1번: 코드 변경안 · API 테스트 요청 · 자기 리뷰
  const callImpl = (issue: Issue, design?: AiResult | null) => {
    const id = issue.issue_id
    const token = Date.now() + Math.random()
    const startedAt = Date.now()
    const my = gen.current
    const t = implTarget(issue)
    const reqs = reqTexts(issue, design === undefined ? aiOk(aiRef.current[id]) : design)
    const patch = (f: (a: ImplState) => ImplState) => setImpl(s => (s[id]?.token === token ? { ...s, [id]: f(s[id]) } : s))
    setImpl(s => ({ ...s, [id]: { status: 'calling', token, startedAt } }))
    runImpl(toAiIssue(issue), reqs, t.file, t.api, t.others, progress(u => patch(a => (a.status === 'done' ? a : { ...a, ...u })))).then(res => {
      if (gen.current !== my || implRef.current[id]?.token !== token) return
      logAi(id, '코드 · API 테스트 요청 · 자기 리뷰', res, startedAt)
      patch(a => ({ ...a, status: 'done', doneAt: Date.now(), result: res }))
    })
  }

  // ⑤ PL 질문
  const ask = (id: string, q: string) => {
    const issue = issues.find(i => i.issue_id === id)
    if (!issue) return
    const my = gen.current
    const item: QaItem = { id: Date.now(), q, status: 'calling', startedAt: Date.now() }
    const patch = (f: (x: QaItem) => QaItem) => setQa(s => ({ ...s, [id]: (s[id] ?? []).map(x => (x.id === item.id ? f(x) : x)) }))
    setQa(s => ({ ...s, [id]: [...(s[id] ?? []), item] }))
    runAsk(askContext(issue, aiOk(aiRef.current[id])), q, progress(u => patch(x => (x.status === 'done' ? x : { ...x, ...u })))).then(res => {
      if (gen.current !== my) return
      logAi(id, 'PL 질문 답변', res, item.startedAt)
      patch(x => ({ ...x, status: 'done', result: res }))
    })
  }

  // 새로고침 후: 저장된 AI 결과를 다시 붙이고, 진행 중인 공정인데 결과가 없으면 다시 호출
  useEffect(() => {
    Object.values(runs).forEach(r => {
      const issue = issues.find(i => i.issue_id === r.issueId)
      if (!issue) return
      const fb = lastFeedback(r)
      const hit = getCachedDesign(toAiIssue(issue), fb)
      if (hit) setAi(s => ({ ...s, [r.issueId]: { status: 'done', token: 0, startedAt: 0, feedback: fb, result: hit } }))
      else if (r.status !== 'done') callDesign(issue, fb)
      if (!r.approvals.some(a => a.gate === 'G1' && a.decision === 'approved')) return
      const t = implTarget(issue)
      const ih = getCachedImpl(toAiIssue(issue), reqTexts(issue, hit), t.file)
      if (ih) setImpl(s => ({ ...s, [r.issueId]: { status: 'done', token: 0, startedAt: 0, result: ih } }))
      else if (r.status !== 'done') callImpl(issue, hit)
    })
  }, [])

  useEffect(() => {
    try {
      const doneQa = Object.fromEntries(Object.entries(qa).map(([k, v]) => [k, v.filter(i => i.status === 'done').map(i => ({ ...i, stream: undefined }))]))
      localStorage.setItem(LS, JSON.stringify({ custom: issues.filter(i => i.custom), runs, speed, aiLog, qa: doneQa }))
    } catch {
      /* 무시 */
    }
  }, [issues, runs, speed, aiLog, qa])

  // 시뮬레이션 진행 박자
  useEffect(() => {
    if (!Object.values(runs).some(r => r.status === 'running')) return
    // 설계(S02) · 첫 구현(S07)은 AI 응답이 끝나고 작업창을 2초 더 보여 준 뒤에 넘어간다
    const hold = (k: string, r: Run) =>
      (r.current?.ev.stage === 'S02' && showConsole(aiRef.current[k])) || (r.current?.ev.stage === 'S07' && r.current.attempt === 1 && showConsole(implRef.current[k]))
    const t = setTimeout(() => setRuns(rs => Object.fromEntries(Object.entries(rs).map(([k, r]) => [k, hold(k, r) ? r : step(r)]))), DELAY[speed])
    return () => clearTimeout(t)
  }, [runs, speed])

  const go = (p: Page, id?: string) => {
    if (id) setFocusId(id)
    setRoute({ page: p, id })
    window.scrollTo(0, 0)
  }

  const ctx: Ctx = {
    issues, runs, ai, impl, qa, aiLog, speed, setSpeed, go, focusId, ask,
    select: setFocusId,
    startRun: issue => {
      const id = issue.issue_id
      setFocusId(id)
      setRuns(rs => ({ ...rs, [id]: newRun(issue) }))
      setImpl(s => Object.fromEntries(Object.entries(s).filter(([k]) => k !== id)))
      setQa(s => ({ ...s, [id]: [] }))
      setAiLog(s => ({ ...s, [id]: issue.aiDraft ? [{ kind: '이슈 초안 작성 (한 문장 요청)', ok: true, ms: issue.aiDraft.ms, at: issue.aiDraft.at, cached: issue.aiDraft.cached }] : [] }))
      callDesign(issue)
    },
    addIssue: issue => setIssues(is => [...is.filter(i => i.issue_id !== issue.issue_id), issue]),
    gateAction: (id, a) => {
      const stage = runs[id]?.gate?.ev.stage
      setRuns(rs => ({ ...rs, [id]: act(rs[id], a) }))
      const issue = issues.find(i => i.issue_id === id)
      if (!issue) return
      if (a.type === 'reject' && (stage === 'G1' || stage === 'G2')) {
        setImpl(s => Object.fromEntries(Object.entries(s).filter(([k]) => k !== id)))
        callDesign(issue, a.text)
      }
      if (a.type === 'approve' && stage === 'G1' && !implRef.current[id]) callImpl(issue)
    },
    pause: (id, paused) =>
      setRuns(rs => {
        const r = rs[id]
        if (!r || (paused && r.status !== 'running') || (!paused && r.status !== 'paused')) return rs
        return { ...rs, [id]: { ...r, status: paused ? 'paused' : 'running' } }
      }),
    finishNow: id => {
      if (aiPending(ai[id])) return
      const issue = issues.find(i => i.issue_id === id)!
      setRuns(rs => ({ ...rs, [id]: fastForward(rs[id] ?? newRun(issue)) }))
      if (!implRef.current[id]) callImpl(issue)
    },
  }

  const reset = () => {
    gen.current++
    clearAiCache()
    setAi({})
    setImpl({})
    setQa({})
    setAiLog({})
    setRuns({})
    setIssues(SAMPLE_ISSUES)
    go('input')
  }

  return (
    <div className="app">
      <header className="topnav">
        <div className="topnav-in">
          <button className="brand" onClick={() => go('input')}>
            <img src="./favicon.svg" alt="" />
            <span>AI 개발 공정 에이전트</span>
          </button>
          <nav className="tabs">
            {NAV.map(n => (
              <button key={n.page} className={(n.page === 'input' ? DEMO.includes(route.page) : route.page === n.page) ? 'on' : ''} onClick={() => go(n.page, focusId)}>
                {n.label}
              </button>
            ))}
          </nav>
          <button className="icobtn" onClick={reset} title="데모 초기화" aria-label="데모 초기화">
            <Icon name="reset" />
          </button>
        </div>
      </header>
      <main className="content">
        {DEMO.includes(route.page) && <Demo ctx={ctx} step={route.page as Step} />}
        {route.page === 'report' && <Report ctx={ctx} id={route.id ?? focusId} />}
        {route.page === 'model' && <ModelInfo />}
      </main>
      <footer className="foot">설계 · 위험 등급 · 코드 · API 테스트 요청 · 리뷰 · 배포 요약은 실제 AI가 실시간으로 만들고, 빌드 · 테스트 실행은 가상 '출장관리 시스템' 데이터로 시뮬레이션한 프로토타입입니다.</footer>
    </div>
  )
}
