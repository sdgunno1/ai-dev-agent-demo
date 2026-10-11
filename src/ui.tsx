import type { ReactNode } from 'react'
import type { Issue, Priority } from './data'
import type { Run, StageView } from './engine'
import type { Ctx } from './App'

export const PRIORITY_KO: Record<Priority, string> = { high: '높음', medium: '보통', low: '낮음' }
export const deptOf = (i: Issue) => i.requester.split('/')[0].trim()

const PATHS: Record<string, string> = {
  dashboard: 'M4.75 4.75h5.5v5.5h-5.5zM13.75 4.75h5.5v5.5h-5.5zM4.75 13.75h5.5v5.5h-5.5zM13.75 13.75h5.5v5.5h-5.5z',
  plus: 'M12 5.5v13M5.5 12h13',
  flow: 'M5 6.5h4.5v4.5H5zM14.5 13h4.5v4.5h-4.5zM9.5 8.75h3a2 2 0 0 1 2 2v2.25',
  check: 'M4.5 12.5l5 5 10-11',
  shield: 'M12 3.5l6.75 2.6v5.4c0 4.05-2.75 7.15-6.75 8.5-4-1.35-6.75-4.45-6.75-8.5V6.1L12 3.5zM9.5 12.1l1.85 1.85 3.4-3.6',
  rocket: 'M12 4c3 1.5 4.5 4.5 4.5 8.5l-2 2.5h-5l-2-2.5C7.5 8.5 9 5.5 12 4zM9.5 15l-2 3.5 3-1M14.5 15l2 3.5-3-1M12 9.5h.01',
  book: 'M5 5.75A2.25 2.25 0 0 1 7.25 3.5h11.5v14.25H7.25A2.25 2.25 0 0 0 5 20V5.75zM8.75 7.75h6.5M8.75 11.25h6.5',
  list: 'M8.5 6.5h11M8.5 12h11M8.5 17.5h11M4.75 6.5h.01M4.75 12h.01M4.75 17.5h.01',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16v-5M12 8h.01',
  reset: 'M4.75 12a7.25 7.25 0 1 0 2.2-5.2M4.75 4.75v3.5h3.5',
  menu: 'M4.75 7h14.5M4.75 12h14.5M4.75 17h14.5',
  play: 'M8 5.5v13l10-6.5z',
  pause: 'M8.5 5.5v13M15.5 5.5v13',
  skip: 'M6 5.5l8 6.5-8 6.5zM17.5 5.5v13',
  chev: 'M9 6l6 6-6 6',
  chevDown: 'M6 9l6 6 6-6',
  x: 'M6 6l12 12M18 6L6 18',
  back: 'M9.5 7.5L5 12l4.5 4.5M5 12h9a5 5 0 0 1 5 5',
  bell: 'M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0',
  download: 'M12 4v11M7.5 11l4.5 4.5 4.5-4.5M5 19.5h14',
  user: 'M12 11.25a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM5 19.75a7 7 0 0 1 14 0',
  doc: 'M7 3.75h7l4 4v12.5H7zM14 3.75v4h4M9.75 12.5h5.5M9.75 16h5.5',
}

export function Icon({ name, className = 'ico' }: { name: string; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      {PATHS[name].split('M').filter(Boolean).map((d, k) => (
        <path key={k} d={'M' + d} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      ))}
    </svg>
  )
}

const VIEW_LABEL: Record<StageView, string> = {
  pending: '대기', running: '진행 중', pass: '통과', fail: '실패', skip: '생략', waiting: '승인 대기',
  rollback: '되돌림', findings: '지적', rejected: '반려',
}

export function Badge({ tone, children }: { tone: string; children: ReactNode }) {
  return <span className={`chip c-${tone}`}>{children}</span>
}

export function ViewBadge({ view }: { view: StageView }) {
  const tone = { pending: 'gray', running: 'blue', pass: 'green', fail: 'red', skip: 'gray', waiting: 'orange', rollback: 'orange', findings: 'orange', rejected: 'red' }[view]
  return <Badge tone={tone}>{VIEW_LABEL[view]}</Badge>
}

export function ResultBadge({ r }: { r: string }) {
  const m: Record<string, [string, string]> = {
    pass: ['green', '통과'], fail: ['red', '실패'], skip: ['gray', '생략'], findings: ['orange', '지적'],
    approved: ['green', '승인'], rejected: ['red', '반려'], resolved: ['blue', '처리'],
  }
  const [t, l] = m[r] ?? ['gray', r]
  return <Badge tone={t}>{l}</Badge>
}

export function RiskBadge({ risk }: { risk: string }) {
  return <Badge tone={risk === '높음' ? 'red' : risk === '보통' ? 'orange' : 'green'}>위험 {risk}</Badge>
}

export function StatusBadge({ run }: { run?: Run }) {
  if (!run) return <Badge tone="gray">미시작</Badge>
  if (run.status === 'done') return <Badge tone="green">배포 대기</Badge>
  if (run.status === 'gate') return <Badge tone={run.gate?.ev.stage === 'G5' ? 'red' : 'orange'}>{run.gate?.ev.stage === 'G5' ? '개입 필요' : '승인 대기'}</Badge>
  if (run.status === 'paused') return <Badge tone="gray">일시정지</Badge>
  return <Badge tone="blue">진행 중</Badge>
}

export function Card({ title, extra, children, className = '' }: { title?: ReactNode; extra?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {(title || extra) && (
        <header className="card-h">
          <h3>{title}</h3>
          {extra}
        </header>
      )}
      <div className="card-b">{children}</div>
    </section>
  )
}

export function SimLabel() {
  return <span className="sim-label" title="실제 AI 대신 시범 실행 결과 데이터로 재생한 결과입니다">시뮬레이션</span>
}

export function PageHead({ title, sub, right }: { title: string; sub?: string; right?: ReactNode }) {
  return (
    <div className="page-h">
      <div>
        <h1>{title}</h1>
        {sub && <p className="sub">{sub}</p>}
      </div>
      {right && <div className="page-h-r">{right}</div>}
    </div>
  )
}

/** 화면 상단: 이슈 선택 드롭다운 */
export function IssuePicker({ ctx, value, onChange, filter }: { ctx: Ctx; value: string; onChange: (id: string) => void; filter?: (r?: Run) => boolean }) {
  const list = ctx.issues.filter(i => !filter || filter(ctx.runs[i.issue_id]))
  return (
    <label className="picker">
      <span className="k">이슈</span>
      <select value={value} onChange={e => onChange(e.target.value)}>
        {list.map(i => (
          <option key={i.issue_id} value={i.issue_id}>
            {i.issue_id} · {i.title}
          </option>
        ))}
      </select>
      <Icon name="chevDown" className="ico-s" />
    </label>
  )
}

export function Kpis({ items }: { items: { label: string; value: ReactNode; foot?: ReactNode }[] }) {
  return (
    <div className="kpis" style={{ gridTemplateColumns: `repeat(${items.length}, 1fr)` }}>
      {items.map(k => (
        <div key={k.label} className="kpi">
          <div className="lab">{k.label}</div>
          <div className="val">{k.value}</div>
          {k.foot && <div className="foot">{k.foot}</div>}
        </div>
      ))}
    </div>
  )
}

export function Seg<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="seg">
      {options.map(([v, l]) => (
        <button key={v} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>
          {l}
        </button>
      ))}
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>
}
