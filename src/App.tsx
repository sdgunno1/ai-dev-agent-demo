import { useEffect, useMemo, useState } from 'react'
import { SAMPLE_ISSUES } from './data'
import type { Issue } from './data'
import { act, fastForward, newRun, step } from './engine'
import type { GateAction, Run } from './engine'
import Demo from './pages/Demo'
import type { Step } from './pages/Demo'
import Report from './pages/Report'
import ModelInfo from './pages/ModelInfo'
import { Icon } from './ui'

export type Page = 'input' | 'process' | 'result' | 'report' | 'model'
export type Speed = 'slow' | 'normal' | 'fast'

export interface Ctx {
  issues: Issue[]
  runs: Record<string, Run>
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
const LS = 'ai-dev-agent-v2'

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
    const t = setTimeout(() => setRuns(rs => Object.fromEntries(Object.entries(rs).map(([k, r]) => [k, step(r)]))), DELAY[speed])
    return () => clearTimeout(t)
  }, [runs, speed])

  const go = (p: Page, id?: string) => {
    if (id) setFocusId(id)
    setRoute({ page: p, id })
    window.scrollTo(0, 0)
  }

  const ctx: Ctx = {
    issues, runs, speed, setSpeed, go, focusId,
    select: setFocusId,
    startRun: issue => {
      setFocusId(issue.issue_id)
      setRuns(rs => ({ ...rs, [issue.issue_id]: newRun(issue) }))
    },
    addIssue: issue => setIssues(is => [...is.filter(i => i.issue_id !== issue.issue_id), issue]),
    gateAction: (id, a) => setRuns(rs => ({ ...rs, [id]: act(rs[id], a) })),
    pause: (id, paused) =>
      setRuns(rs => {
        const r = rs[id]
        if (!r || (paused && r.status !== 'running') || (!paused && r.status !== 'paused')) return rs
        return { ...rs, [id]: { ...r, status: paused ? 'paused' : 'running' } }
      }),
    finishNow: id =>
      setRuns(rs => {
        const issue = issues.find(i => i.issue_id === id)!
        return { ...rs, [id]: fastForward(rs[id] ?? newRun(issue)) }
      }),
  }

  const reset = () => {
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
      <footer className="foot">가상 '출장관리 시스템' 데이터로 공정을 시뮬레이션한 프로토타입입니다.</footer>
    </div>
  )
}
