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
import { clearAiCache, getCachedAi, runLiveAi } from './liveAi'
import { aiPending, lastFeedback, predictedFacts, toAiIssue } from './aiView'
import type { AiState } from './aiView'

export type Page = 'input' | 'process' | 'result' | 'report' | 'model'
export type Speed = 'slow' | 'normal' | 'fast'

export interface Ctx {
  issues: Issue[]
  runs: Record<string, Run>
  ai: Record<string, AiState>
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
}

const NAV: { page: Page; label: string }[] = [
  { page: 'input', label: '서비스 시연' },
  { page: 'report', label: '검증 리포트' },
  { page: 'model', label: 'AI 모델' },
]

const DEMO: Page[] = ['input', 'process', 'result']
const DELAY: Record<Speed, number> = { slow: 1800, normal: 1000, fast: 420 }
const LS = 'ai-dev-agent-v3'

function load(): { issues: Issue[]; runs: Record<string, Run>; speed: Speed } {
  try {
    const raw = localStorage.getItem(LS)
    if (raw) {
      const d = JSON.parse(raw)
      return { issues: [...SAMPLE_ISSUES, ...(d.custom ?? [])], runs: d.runs ?? {}, speed: d.speed ?? 'normal' }
    }
  } catch {
    /* 저장소를 못 쓰면 기본값으로 시작 */
  }
  return { issues: SAMPLE_ISSUES, runs: {}, speed: 'normal' }
}

// 화면 이동은 메모리 상태로만 관리 (아티팩트 · 정적 호스팅 어디서든 동작)
const initialRoute = (): { page: Page; id?: string } => ({ page: 'input' })

export default function App() {
  const init = useMemo(load, [])
  const [issues, setIssues] = useState<Issue[]>(init.issues)
  const [runs, setRuns] = useState<Record<string, Run>>(init.runs)
  const [speed, setSpeed] = useState<Speed>(init.speed)
  const [route, setRoute] = useState(initialRoute)
  const [focusId, setFocusId] = useState(route.id ?? 'ISSUE-1042')
  const [ai, setAi] = useState<Record<string, AiState>>({})
  const aiRef = useRef(ai)
  aiRef.current = ai

  // 실제 AI 호출 — 공정 1회에 1번 (설계 반려 시에는 반려 사유를 넣어 1번 더)
  const callAi = (issue: Issue, feedback?: string) => {
    const id = issue.issue_id
    const token = Date.now() + Math.random()
    const patch = (f: (a: AiState) => AiState) => setAi(s => (s[id]?.token === token ? { ...s, [id]: f(s[id]) } : s))
    setAi(s => ({ ...s, [id]: { status: 'calling', token, startedAt: Date.now(), feedback, result: s[id]?.result } }))
    runLiveAi(toAiIssue(issue), predictedFacts(issue), st => patch(a => ({ ...a, status: st.phase, seconds: st.phase === 'waiting' ? st.seconds : undefined })), feedback).then(res =>
      patch(a =>
        !res.ok && feedback && a.result?.ok
          ? { ...a, status: 'done', feedback: undefined, note: '반려 사유 반영 재호출 실패 → 이전 AI 설계 유지' }
          : { ...a, status: 'done', result: res, note: undefined },
      ),
    )
  }

  // 새로고침 후: 저장된 AI 결과를 다시 붙이고, 진행 중인 공정인데 결과가 없으면 다시 호출
  useEffect(() => {
    Object.values(runs).forEach(r => {
      const issue = issues.find(i => i.issue_id === r.issueId)
      if (!issue) return
      const fb = lastFeedback(r)
      const hit = getCachedAi(toAiIssue(issue), fb)
      if (hit) setAi(s => ({ ...s, [r.issueId]: { status: 'done', token: 0, startedAt: 0, feedback: fb, result: hit } }))
      else if (r.status !== 'done') callAi(issue, fb)
    })
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(LS, JSON.stringify({ custom: issues.filter(i => i.custom), runs, speed }))
    } catch {
      /* 무시 */
    }
  }, [issues, runs, speed])

  // 시뮬레이션 진행 박자
  useEffect(() => {
    if (!Object.values(runs).some(r => r.status === 'running')) return
    // 설계(S02)는 AI 응답이 올 때까지 끝내지 않는다
    const hold = (k: string, r: Run) => r.current?.ev.stage === 'S02' && aiPending(aiRef.current[k])
    const t = setTimeout(() => setRuns(rs => Object.fromEntries(Object.entries(rs).map(([k, r]) => [k, hold(k, r) ? r : step(r)]))), DELAY[speed])
    return () => clearTimeout(t)
  }, [runs, speed])

  const go = (p: Page, id?: string) => {
    if (id) setFocusId(id)
    setRoute({ page: p, id })
    window.scrollTo(0, 0)
  }

  const ctx: Ctx = {
    issues, runs, ai, speed, setSpeed, go, focusId,
    select: setFocusId,
    startRun: issue => {
      setFocusId(issue.issue_id)
      setRuns(rs => ({ ...rs, [issue.issue_id]: newRun(issue) }))
      callAi(issue)
    },
    addIssue: issue => setIssues(is => [...is.filter(i => i.issue_id !== issue.issue_id), issue]),
    gateAction: (id, a) => {
      const stage = runs[id]?.gate?.ev.stage
      setRuns(rs => ({ ...rs, [id]: act(rs[id], a) }))
      const issue = issues.find(i => i.issue_id === id)
      if (issue && a.type === 'reject' && (stage === 'G1' || stage === 'G2')) callAi(issue, a.text)
    },
    pause: (id, paused) =>
      setRuns(rs => {
        const r = rs[id]
        if (!r || (paused && r.status !== 'running') || (!paused && r.status !== 'paused')) return rs
        return { ...rs, [id]: { ...r, status: paused ? 'paused' : 'running' } }
      }),
    finishNow: id => {
      if (aiPending(ai[id])) return
      setRuns(rs => {
        const issue = issues.find(i => i.issue_id === id)!
        return { ...rs, [id]: fastForward(rs[id] ?? newRun(issue)) }
      })
    },
  }

  const reset = () => {
    clearAiCache()
    setAi({})
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
      <footer className="foot">설계 요구사항 · 위험 등급 · 배포 요약은 실제 AI로 생성하고, 나머지 단계는 가상 '출장관리 시스템' 데이터로 시뮬레이션한 프로토타입입니다.</footer>
    </div>
  )
}
