import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { Ctx, Speed } from '../App'
import { R1042, SAMPLE_ISSUES, SCENARIO_HINT, STAGE_INFO } from '../data'
import type { Issue, IssueType, StageId } from '../data'
import { artifactsOf, hm, implToReadyMinutes, riskOf } from '../engine'
import type { Run } from '../engine'
import { Badge, Icon, PRIORITY_KO, RiskBadge, Seg, StatusBadge, deptOf } from '../ui'
import { ReleaseCard } from './Release'
import {
  AiActivityBar, AiBadge, AiConsole, AiRequirements, AiResultCard, AiRiskDetail, AskBox, CheckLine, ImplDetail,
  AFTER_MS, aiChecks, aiNodeMarks, aiOk, aiPending, implOk, implTarget, logTone, noteWithAi, showConsole, summaryView, throttleProgress,
} from '../aiView'
import type { Phase } from '../aiView'
import { previewDesign, previewImpl, previewIntake, runIntake } from '../liveAi'
import type { AiFailure, IntakeResult } from '../liveAi'

// 흐름도에 보이는 핵심 단계 — 세부 단계(S03~S06, S10, S11 등)는 묶어서 표시
const NODES: { label: string; actor: string; gate?: boolean; stages: StageId[] }[] = [
  { label: '접수', actor: 'AI', stages: ['S01'] },
  { label: '설계', actor: 'AI', stages: ['S02'] },
  { label: '설계 승인', actor: '사람', gate: true, stages: ['G1'] },
  { label: '구현', actor: 'AI', stages: ['S03', 'S04-S06', 'G2', 'S07', 'S07b'] },
  { label: 'API 검증', actor: '실행기', stages: ['S07c'] },
  { label: 'AI 리뷰', actor: 'AI', stages: ['S08'] },
  { label: '기준 대조', actor: '실행기', stages: ['S09', 'G5'] },
  { label: '배포 준비', actor: '실행기', stages: ['S10', 'S11', 'S13'] },
  { label: '배포 승인', actor: '사람', gate: true, stages: ['G4'] },
  { label: '배포 대기', actor: '완료', stages: [] },
]
const N = NODES.length
const nodeOf = (s: StageId) => NODES.findIndex(n => n.stages.includes(s))
const xPct = (i: number) => ((i + 0.5) / N) * 100

function activeIndex(run?: Run) {
  if (!run) return -1
  if (run.status === 'done') return N - 1
  const s = run.gate?.ev.stage ?? run.current?.ev.stage ?? run.queue.find(e => e.result !== 'skip')?.stage
  return s ? nodeOf(s) : N - 1
}

export type Step = 'input' | 'process' | 'result'

export default function Demo({ ctx, step }: { ctx: Ctx; step: Step }) {
  const issue = ctx.issues.find(i => i.issue_id === ctx.focusId) ?? ctx.issues[1]
  const run = ctx.runs[issue.issue_id]
  const done = run?.status === 'done'

  // 배포 승인이 끝나는 순간에만 결과 화면으로 넘어간다 (완료된 공정을 다시 볼 때는 그대로)
  const wasDone = useRef(done)
  useEffect(() => {
    if (step === 'process' && done && !wasDone.current) {
      const t = setTimeout(() => ctx.go('result', issue.issue_id), 1400)
      return () => clearTimeout(t)
    }
    wasDone.current = done
  }, [done, step])

  const start = (i: Issue) => {
    wasDone.current = false
    ctx.startRun(i)
    ctx.go('process', i.issue_id)
  }

  return (
    <div className="page">
      <Stepper ctx={ctx} step={step} run={run} issue={issue} />

      {step === 'input' && <InputSection ctx={ctx} issue={issue} onSelect={id => ctx.select(id)} onStart={start} />}

      {step === 'process' && (
        <section className="sec">
          <SecHead
            title={run ? issue.title : 'AI 처리'}
            sub={run ? `${issue.issue_id} · AI는 만들고, 실행기는 판정하고, 사람은 승인합니다` : 'AI는 만들고, 실행기는 판정하고, 사람은 승인합니다'}
            right={run && <Controls ctx={ctx} issue={issue} run={run} />}
          />
          <div className="panel">
            <Flow run={run} ai={aiNodeMarks(issue, run, ctx.ai[issue.issue_id], ctx.impl[issue.issue_id], activeIndex(run))} />
            {run && <ActivityBar ctx={ctx} issue={issue} run={run} />}
            <Activity ctx={ctx} issue={issue} run={run} />
          </div>
          {done && (
            <div className="next-row">
              <button className="btn primary lg" onClick={() => ctx.go('result', issue.issue_id)}>
                결과 보기 <Icon name="chev" className="ico-s" />
              </button>
            </div>
          )}
        </section>
      )}

      {step === 'result' && (
        <section className="sec">
          <SecHead title={done ? issue.title : '결과'} sub={done ? `${issue.issue_id} · 모든 판정에는 실행해서 확인한 근거가 붙습니다` : '모든 판정에는 실행해서 확인한 근거가 붙습니다'} />
          <Results ctx={ctx} issue={issue} run={run} />
        </section>
      )}
    </div>
  )
}

/** 흐름도 아래: 이 공정에서 실제 AI가 한 일 한 줄 요약 */
function ActivityBar({ ctx, issue, run }: { ctx: Ctx; issue: Issue; run: Run }) {
  const id = issue.issue_id
  const d = aiOk(ctx.ai[id])
  const im = implOk(ctx.impl[id])
  const qa = ctx.qa[id] ?? []
  const kinds = (issue.aiDraft ? 1 : 0) + (d ? 3 : 0) + (im ? 3 : 0) + (qa.some(i => i.result?.ok) ? 1 : 0)
  const working = aiPending(ctx.ai[id]) || aiPending(ctx.impl[id]) || qa.some(i => aiPending(i))
  return <AiActivityBar calls={(ctx.aiLog[id] ?? []).filter(l => l.ok).length} kinds={kinds} rows={aiChecks(issue, run, d, im)} working={working} />
}

function Stepper({ ctx, step, run, issue }: { ctx: Ctx; step: Step; run?: Run; issue: Issue }) {
  const items: { key: Step; label: string; sub: string; state: string }[] = [
    { key: 'input', label: '이슈 입력', sub: issue.issue_id, state: run ? 'done' : 'ready' },
    {
      key: 'process', label: 'AI 처리',
      sub: !run ? '대기' : run.status === 'done' ? '완료' : run.gate ? (run.gate.ev.stage === 'G5' ? '개입 필요' : '승인 대기') : '진행 중',
      state: !run ? 'off' : run.status === 'done' ? 'done' : run.gate ? 'wait' : 'ready',
    },
    { key: 'result', label: '결과', sub: run?.status === 'done' ? '확인 가능' : '대기', state: run?.status === 'done' ? 'done' : 'off' },
  ]
  return (
    <nav className="stepper">
      {items.map((it, k) => (
        <button key={it.key} className={`stp s-${it.state} ${step === it.key ? 'on' : ''}`} onClick={() => ctx.go(it.key, issue.issue_id)}>
          <span className="stp-n">{it.state === 'done' && step !== it.key ? <Icon name="check" className="ico-xs" /> : k + 1}</span>
          <span className="stp-t">
            <b>{it.label}</b>
            <small>{it.sub}</small>
          </span>
          {k < items.length - 1 && <Icon name="chev" className="stp-arrow" />}
        </button>
      ))}
    </nav>
  )
}

function SecHead({ title, sub, right }: { title: string; sub: string; right?: ReactNode }) {
  return (
    <div className="sec-h">
      <div className="sec-t">
        <h2>{title}</h2>
        <p>{sub}</p>
      </div>
      {right}
    </div>
  )
}

// ── ① 입력 ────────────────────────────────────────────────
function InputSection({ ctx, issue, onSelect, onStart }: { ctx: Ctx; issue: Issue; onSelect: (id: string) => void; onStart: (i: Issue) => void }) {
  const [custom, setCustom] = useState(false)
  const [form, setForm] = useState({ type: 'feature' as IssueType, title: '', acs: '', desc: '' })
  const [err, setErr] = useState('')
  const [sentence, setSentence] = useState('')
  const [intake, setIntake] = useState<{ status: Phase; startedAt: number; doneAt?: number; seconds?: number; stream?: string; result?: IntakeResult | AiFailure } | null>(null)
  const drafting = !!intake && aiPending(intake)

  // 한 문장 요청 → AI가 제목 · 유형 · 수용 기준을 실시간으로 작성
  const draft = () => {
    if (!sentence.trim() || drafting) return
    setIntake({ status: 'calling', startedAt: Date.now() })
    runIntake(
      sentence,
      throttleProgress(p => setIntake(s => (s && s.status !== 'done' ? { ...s, status: p.phase, seconds: p.seconds, stream: p.text ?? s.stream } : s))),
    ).then(res => {
      setIntake(s => (s ? { ...s, status: 'done', doneAt: Date.now(), result: res } : s))
      // 작업창을 2초 더 보여 준 뒤 닫는다
      setTimeout(() => setIntake(s => (s ? { ...s } : s)), AFTER_MS + 50)
      if (res.ok) {
        setForm({ type: res.type, title: res.title, acs: res.ac.join('\n'), desc: res.description })
        setErr('')
      }
    })
  }
  const nextId = `ISSUE-${1046 + ctx.issues.filter(i => i.custom).length}`

  const startCustom = () => {
    const acs = form.acs.split('\n').map(s => s.trim()).filter(Boolean)
    if (!form.title.trim() || acs.length === 0) return setErr('제목과 수용 기준(한 줄에 하나)을 입력하세요.')
    const d = new Date()
    const it: Issue = {
      issue_id: nextId, type: form.type, title: form.title.trim(), requester: '총무팀 / user_0001', priority: 'medium',
      created_at: d.toISOString(), description: form.desc.trim() || form.title.trim(), custom: true,
      aiDraft: intake?.result?.ok ? { ms: intake.result.elapsedMs, at: intake.result.createdAt, cached: intake.result.cached, checks: [intake.result.checks.count, intake.result.checks.vague] } : undefined,
      acceptance_criteria: acs.map((a, i) => `AC-${i + 1} ${a.replace(/^AC-\d+\s*/, '')}`),
    }
    ctx.addIssue(it)
    setErr('')
    setCustom(false)
    setIntake(null)
    setSentence('')
    onStart(it)
  }

  const list = [...SAMPLE_ISSUES, ...ctx.issues.filter(i => i.custom)]
  return (
    <section className="sec">
      <SecHead title="어떤 기능 요청을 처리할까요?" sub="이슈 관리 시스템에 접수된 기능 요청을 고르거나 직접 입력합니다" />
      <div className="panel input">
        <div className="pick">
          {list.map(i => (
            <button key={i.issue_id} className={`pick-row ${!custom && issue.issue_id === i.issue_id ? 'on' : ''}`} onClick={() => { setCustom(false); onSelect(i.issue_id) }}>
              <span className={`tag ${i.type === 'bug' ? 'bug' : ''}`}>{i.type === 'bug' ? '버그' : '기능'}</span>
              <span className="pick-t">
                <b>{i.title}</b>
                <small>{SCENARIO_HINT[i.issue_id] ?? '직접 입력한 이슈'}</small>
              </span>
              <StatusBadge run={ctx.runs[i.issue_id]} />
            </button>
          ))}
          <button className={`pick-row add ${custom ? 'on' : ''}`} onClick={() => setCustom(true)}>
            <span className="tag add">
              <Icon name="plus" className="ico-xs" />
            </span>
            <span className="pick-t">
              <b>직접 입력</b>
              <small>새 기능 요청을 작성합니다</small>
            </span>
          </button>
        </div>

        <div className="detail">
          {custom ? (
            <div className="form">
              <div className="detail-h">
                <span className="mono muted">{nextId}</span>
                <Seg<IssueType> value={form.type} onChange={t => setForm({ ...form, type: t })} options={[['feature', '기능'], ['bug', '버그']]} />
              </div>
              <div className="intake">
                <label htmlFor="intake-s">
                  한 문장으로 요청 <span className="muted small">AI가 제목 · 유형 · 수용 기준을 작성합니다</span>
                </label>
                <div className="intake-row">
                  <input id="intake-s" value={sentence} disabled={drafting} placeholder="예: 출장 신청서를 결재선까지 포함해서 PDF로 뽑고 싶다" onChange={e => setSentence(e.target.value)} onKeyDown={e => e.key === 'Enter' && draft()} />
                  <button className="btn primary" disabled={drafting || !sentence.trim()} onClick={draft}>
                    AI로 이슈 작성
                  </button>
                </div>
                {intake && showConsole(intake) && <AiConsole slot={intake} preview={previewIntake(intake.stream ?? '')} label="이슈 초안" />}
                {intake?.result?.ok && (
                  <div className="intake-checks">
                    <span className="chip c-green">
                      <span className="dot" />
                      실제 AI 작성 · 아래 내용을 고칠 수 있습니다
                    </span>
                    <CheckLine c={intake.result.checks.count} />
                    <CheckLine c={intake.result.checks.vague} />
                  </div>
                )}
                {intake?.result && !intake.result.ok && <span className="err-t">AI 응답을 받지 못했습니다 ({intake.result.reason}). 아래에 직접 입력해 주세요.</span>}
              </div>
              <label>
                제목
                <input value={form.title} placeholder="예: 출장 신청서 PDF 출력" onChange={e => setForm({ ...form, title: e.target.value })} />
              </label>
              <label>
                수용 기준 <span className="muted small">한 줄에 하나</span>
                <textarea rows={4} value={form.acs} placeholder={'출장 상세 화면에 [PDF 출력] 버튼 표시\nPDF에 신청자·출장지·기간 포함'} onChange={e => setForm({ ...form, acs: e.target.value })} />
              </label>
              {err && <span className="err-t">{err}</span>}
              <div className="detail-f">
                <button className="btn quiet" onClick={() => { setIntake(null); setForm({ type: 'feature', title: '출장 신청서 PDF 출력', acs: '출장 상세 화면에 [PDF 출력] 버튼 표시\nPDF에 신청자·출장지·기간·결재선 포함\n파일명은 trip_TRIPID.pdf', desc: '' }) }}>
                  예시 채우기
                </button>
                <button className="btn primary lg" onClick={startCustom}>
                  <Icon name="play" className="ico-s" /> AI 공정 시작
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="detail-h">
                <span className="mono muted">{issue.issue_id}</span>
                <div className="chips">
                  <Badge tone="gray">{deptOf(issue)}</Badge>
                  <Badge tone="gray">우선순위 {PRIORITY_KO[issue.priority]}</Badge>
                  <RiskBadge risk={riskOf(issue).risk} />
                </div>
              </div>
              <h3 className="detail-title">{issue.title}</h3>
              <p className="muted">{issue.description}</p>
              <ol className="acs">
                {issue.acceptance_criteria.map(a => (
                  <li key={a}>
                    <span className="mono">{a.match(/^AC-\d+/)?.[0]}</span>
                    {a.replace(/^AC-\d+\s*/, '')}
                  </li>
                ))}
              </ol>
              <div className="detail-f">
                <span className="muted small">수용 기준 {issue.acceptance_criteria.length}개 · 레포 정보는 접수 단계에서 자동 수집</span>
                <button className="btn primary lg" onClick={() => onStart(issue)}>
                  <Icon name="play" className="ico-s" /> {ctx.runs[issue.issue_id] ? '다시 시작' : 'AI 공정 시작'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  )
}

// ── ② 흐름도 ──────────────────────────────────────────────
function Flow({ run, ai }: { run?: Run; ai?: { marks: Set<number>; working?: number } }) {
  const at = activeIndex(run)
  const waiting = !!run?.gate
  const g5 = run?.gate?.ev.stage === 'G5'
  const moving = run?.status === 'running'
  const arcs = run
    ? run.history
        .filter(h => h.routeTo)
        .map(h => [nodeOf(h.stage), nodeOf(h.routeTo!)] as const)
        .filter((a, i, arr) => arr.findIndex(b => b[0] === a[0] && b[1] === a[1]) === i)
    : []
  const fill = at < 0 ? 0 : (at / (N - 1)) * 100

  return (
    <div className="flow">
      <div className="flow-arcs">
        <svg viewBox="0 0 1000 56" preserveAspectRatio="none" aria-hidden="true">
          {arcs.map(([from, to]) => {
            const x1 = xPct(from) * 10, x2 = xPct(to) * 10
            return <path key={`${from}-${to}`} className="arc" d={`M${x1},54 C${x1},4 ${x2},4 ${x2},54`} vectorEffect="non-scaling-stroke" />
          })}
        </svg>
        {arcs.map(([from, to]) => (
          <span key={`l${from}-${to}`} className="arc-label" style={{ left: `${(xPct(from) + xPct(to)) / 2}%` }}>
            <Icon name="back" className="ico-xs" /> 실패 → 되돌림
          </span>
        ))}
      </div>

      <div className="flow-track">
        <div className="track-bg" />
        <div className={`track-fill ${moving ? 'moving' : ''}`} style={{ width: `calc((100% - ${100 / N}%) * ${fill / 100})` }} />
        {at >= 0 && <div className={`token ${waiting ? (g5 ? 'red' : 'wait') : ''}`} style={{ left: `${xPct(at)}%` }} />}
      </div>

      <ol className="nodes" style={{ gridTemplateColumns: `repeat(${N}, 1fr)` }}>
        {NODES.map((n, i) => {
          const st = at < 0 ? 'todo' : i < at ? 'done' : i === at ? (run?.status === 'done' ? 'done' : waiting ? (g5 ? 'alert' : 'wait') : 'now') : 'todo'
          return (
            <li key={n.label} className={`node n-${st} ${n.gate ? 'is-gate' : ''} ${i === N - 1 ? 'end' : ''} ${ai?.marks.has(i) ? 'has-ai' : ''} ${ai?.working === i ? 'ai-working' : ''}`}>
              <span className="n-ico">
                {st === 'done' ? <Icon name="check" className="ico-s" /> : st === 'now' ? <span className="spin" /> : n.gate ? <Icon name="user" className="ico-s" /> : <span className="n-num">{i + 1}</span>}
              </span>
              <span className="n-label">{n.label}</span>
              <span className="n-actor">{st === 'wait' ? '승인 대기' : st === 'alert' ? '개입 필요' : n.actor}</span>
              {(ai?.marks.has(i) || ai?.working === i) && <span className="n-ai">{ai?.working === i ? 'AI 작업 중' : '실제 AI'}</span>}
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function Controls({ ctx, issue, run }: { ctx: Ctx; issue: Issue; run: Run }) {
  const id = issue.issue_id
  const pending = aiPending(ctx.ai[id])
  return (
    <div className="controls">
      <AiBadge slots={[ctx.ai[id], ctx.impl[id], ...(ctx.qa[id] ?? [])]} count={(ctx.aiLog[id] ?? []).filter(l => l.ok).length} />
      <Seg<Speed> value={ctx.speed} onChange={ctx.setSpeed} options={[['slow', '느리게'], ['normal', '보통'], ['fast', '빠르게']]} />
      {run.status === 'running' && (
        <button className="icobtn" title="일시정지" onClick={() => ctx.pause(id, true)}>
          <Icon name="pause" />
        </button>
      )}
      {run.status === 'paused' && (
        <button className="icobtn" title="계속" onClick={() => ctx.pause(id, false)}>
          <Icon name="play" />
        </button>
      )}
      {run.status !== 'done' && (
        <button className="btn sm" disabled={pending} title={pending ? 'AI 응답을 기다리는 중입니다' : undefined} onClick={() => ctx.finishNow(id)}>
          <Icon name="skip" className="ico-xs" /> 결과 바로 보기
        </button>
      )}
    </div>
  )
}

// ── ② 지금 일어나는 일 + 로그 ─────────────────────────────
function Activity({ ctx, issue, run }: { ctx: Ctx; issue: Issue; run?: Run }) {
  const logRef = useRef<HTMLOListElement>(null)
  const gateRef = useRef<HTMLDivElement>(null)
  const gateKey = run?.gate ? `${run.gate.ev.stage}${run.gate.attempt}` : ''
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' })
  }, [run?.history.length])
  useEffect(() => {
    if (gateKey) gateRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [gateKey])

  if (!run) {
    return (
      <div className="activity empty-act">
        <Icon name="flow" />
        <p><b>이슈 입력</b>에서 이슈를 고르고 AI 공정 시작을 누르면 흐름이 시작됩니다.</p>
      </div>
    )
  }

  const aiState = ctx.ai[issue.issue_id]
  const implState = ctx.impl[issue.issue_id]
  const ok = aiOk(aiState)
  const im = implOk(implState)
  const last = [...run.history].reverse().find(h => h.result !== 'skip')
  const sv = ok ? summaryView(issue, run, ok) : null
  const curStage = run.current?.ev.stage ?? (run.status === 'running' ? run.queue.find(e => e.result !== 'skip')?.stage : undefined)
  return (
    <div className="activity">
      <div className="act-main" ref={gateRef}>
        {run.gate ? (
          <GatePanel ctx={ctx} issue={issue} run={run} />
        ) : run.status === 'done' ? (
          <div className="now done">
            <span className="now-ico ok">
              <Icon name="check" className="ico-s" />
            </span>
            <div>
              <b>배포 승인 완료</b>
              <p>이슈 상태가 배포 대기로 바뀌고 감사 기록이 확정되었습니다.</p>
            </div>
          </div>
        ) : (
          <div className="now">
            <span className="now-ico">{curStage ? <span className="spin" /> : <Icon name="pause" className="ico-s" />}</span>
            <div>
              <b>{curStage ? `${STAGE_INFO[curStage].name} 진행 중` : '일시정지됨'}</b>
              {curStage && (
                <dl className="who">
                  <dt>AI</dt>
                  <dd>{STAGE_INFO[curStage].ai}</dd>
                  <dt>실행기</dt>
                  <dd>{STAGE_INFO[curStage].judge}</dd>
                </dl>
              )}
            </div>
          </div>
        )}
        {!run.gate && curStage === 'S02' && aiState && showConsole(aiState) && (
          <AiConsole slot={aiState} preview={previewDesign(aiState.stream ?? '')} label="설계 · 위험 · 요약" />
        )}
        {!run.gate && curStage === 'S07' && run.current?.attempt === 1 && implState && showConsole(implState) && (
          <AiConsole slot={implState} preview={previewImpl(implState.stream ?? '', implTarget(issue).file)} label="코드 · API · 리뷰" />
        )}
        {!run.gate && last && (
          <div className={`just r-${last.result}`}>
            <span className="just-k">방금 완료</span>
            <b>
              {STAGE_INFO[last.stage].name}
              {last.attempt > 1 && ` ${last.attempt}차`}
            </b>
            <span>{noteWithAi(last, issue, run, ok, im)}</span>
            {last.stage === 'S02' && ok && <CheckLine c={ok.checks.coverage} />}
            {last.stage === 'S03' && ok && <AiRiskDetail res={ok} />}
            {im && last.attempt === 1 && (last.stage === 'S07' || last.stage === 'S07c' || last.stage === 'S08') && <ImplDetail stage={last.stage} im={im} />}
            {last.stage === 'S13' && sv && <CheckLine c={sv.check} />}
            {last.routeTo && <span className="back-note">↩ {STAGE_INFO[last.routeTo].name} 단계로 되돌려 다시 수정합니다</span>}
          </div>
        )}
      </div>
      <div className="act-log">
        <div className="log-h">
          <span>실행 로그</span>
          <span className="mono muted">{run.dateLabel.slice(5)} {hm(run.current?.start ?? run.clock)}</span>
        </div>
        <ol ref={logRef}>
          {run.history
            .filter(h => h.result !== 'skip')
            .map((h, k) => (
              <li key={k} className={`r-${logTone(h, issue, run, ok, im)}`}>
                <span className="mono">{hm(h.end)}</span>
                <span className="lg-dot" />
                <span>
                  <b>{STAGE_INFO[h.stage].name}</b>
                  {h.attempt > 1 && <em> {h.attempt}차</em>} {noteWithAi(h, issue, run, ok, im)}
                </span>
              </li>
            ))}
        </ol>
      </div>
    </div>
  )
}

function GatePanel({ ctx, issue, run }: { ctx: Ctx; issue: Issue; run: Run }) {
  const g = run.gate!
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const art = artifactsOf(issue)
  const id = issue.issue_id
  const aiState = ctx.ai[id]
  const ok = aiOk(aiState)
  const approve = () => ctx.gateAction(id, { type: 'approve' })
  const reject = () => {
    if (!reason.trim()) return
    ctx.gateAction(id, { type: 'reject', text: reason.trim() })
    setRejecting(false)
    setReason('')
  }

  if (g.ev.stage === 'G4') return <ReleaseCard ctx={ctx} issue={issue} run={run} />

  if (g.ev.stage === 'G5') {
    return (
      <div className="gate red">
        <div className="gate-h">
          <span className="now-ico red">
            <Icon name="bell" className="ico-s" />
          </span>
          <div>
            <b>사람 개입 요청</b>
            <p>{g.ev.note}</p>
          </div>
        </div>
        <ul className="plain">
          {g.ev.details?.map(d => (
            <li key={d}>{d}</li>
          ))}
        </ul>
        <div className="gate-f">
          <span className="muted small">조치: {g.ev.comment}</span>
          <button className="btn danger" onClick={approve}>
            원인 처리 후 재개
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="gate">
      <div className="gate-h">
        <span className="now-ico wait">
          <Icon name="user" className="ico-s" />
        </span>
        <div>
          <b>{g.ev.stage === 'G2' ? '구조 승인 요청' : '설계 승인 요청'}</b>
          <p>PL에게 알림이 발송되었습니다. 설계를 확인하고 승인하면 구현부터 자동으로 이어집니다.</p>
        </div>
      </div>
      <div className="gate-body">
        <div>
          <h4>
            요구사항 {ok ? <Badge tone="green">실제 AI 작성</Badge> : aiState && <Badge tone="gray">시뮬레이션</Badge>}
          </h4>
          {ok ? (
            <AiRequirements res={ok} state={aiState} />
          ) : (
            <ol className="plain num">
              {art.requirements.slice(0, 4).map(r => (
                <li key={r}>{r}</li>
              ))}
            </ol>
          )}
          <h4>바꿀 파일 · 레포 대조 완료</h4>
          <div className="file-chips">
            {art.files[0].map(f => (
              <span key={f[0]} className="mono">
                {f[0].split('/').pop()}
              </span>
            ))}
          </div>
        </div>
        <div>
          <h4>화면 그림</h4>
          <Wire issue={issue} />
          <h4>API</h4>
          <p className="mono small">
            <b className="api-m">{art.apiTable[0][0]}</b> {art.apiTable[0][1]}
          </p>
        </div>
      </div>
      {g.ev.stage === 'G1' && <AskBox items={ctx.qa[id] ?? []} onAsk={q => ctx.ask(id, q)} />}
      {g.ev.suggestReject && (
        <p className="pl-note">
          PL 메모: “{g.ev.suggestReject}” <span className="muted">— 반려 시나리오</span>
        </p>
      )}
      {rejecting ? (
        <div className="gate-f">
          <input autoFocus value={reason} placeholder="반려 사유" onChange={e => setReason(e.target.value)} onKeyDown={e => e.key === 'Enter' && reject()} />
          {g.ev.suggestReject && !reason && (
            <button className="btn" onClick={() => setReason(g.ev.suggestReject!)}>
              메모 넣기
            </button>
          )}
          <button className="btn danger" disabled={!reason.trim()} onClick={reject}>
            반려하고 설계로
          </button>
          <button className="btn quiet" onClick={() => setRejecting(false)}>
            취소
          </button>
        </div>
      ) : (
        <div className="gate-f end">
          <button className="btn" onClick={() => setRejecting(true)}>
            반려
          </button>
          <button className="btn primary" onClick={approve}>
            승인
          </button>
        </div>
      )}
    </div>
  )
}

function Wire({ issue }: { issue: Issue }) {
  const is1042 = issue.issue_id === 'ISSUE-1042'
  return (
    <div className="wire">
      <div className="wire-bar">
        <span>{is1042 ? '출장관리 › 출장 목록' : artifactsOf(issue).menu.replace(' > ', ' › ')}</span>
        <span className="wire-new">{is1042 ? 'CSV 내려받기' : '신규'}</span>
      </div>
      {is1042 ? (
        <div className="wire-grid">
          {['TRIP_ID', 'DEST', 'STATUS', 'MEMO'].map(c => (
            <span key={c} className="h">
              {c}
            </span>
          ))}
          {R1042.csv2.slice(0, 2).flatMap(r => {
            const c = r.split(',')
            return [c[0], c[3], c[6], c[7] || '—'].map((v, k) => <span key={r + k}>{v}</span>)
          })}
        </div>
      ) : (
        <div className="wire-list">
          {issue.acceptance_criteria.slice(0, 3).map(a => (
            <span key={a}>{a.replace(/^AC-\d+\s*/, '')}</span>
          ))}
        </div>
      )}
    </div>
  )
}

// ── ③ 결과 ────────────────────────────────────────────────
function Results({ ctx, issue, run }: { ctx: Ctx; issue: Issue; run?: Run }) {
  if (!run || run.status !== 'done') {
    return (
      <div className="panel result-empty">
        {['수용 기준', '기존 API 회귀', '되돌림', '구현 → 배포 준비'].map(k => (
          <div key={k} className="ghost-kpi">
            <span>{k}</span>
            <b>—</b>
          </div>
        ))}
        <p>
          배포 승인까지 끝나면 결과가 여기에 표시됩니다.
          <button className="btn sm" onClick={() => ctx.go(run ? 'process' : 'input', issue.issue_id)}>
            {run ? 'AI 처리 화면으로' : '이슈 입력으로'}
          </button>
        </p>
      </div>
    )
  }
  const art = artifactsOf(issue)
  const final = art.ac[art.ac.length - 1]
  const first = art.ac[0]
  const mins = implToReadyMinutes(run)
  const g4 = run.approvals.filter(a => a.gate === 'G4').slice(-1)[0]
  return (
    <>
    <div className="panel">
      <div className="kpis">
        <div className="kpi">
          <span>수용 기준</span>
          <b>
            {final.length}/{final.length}
          </b>
          <Badge tone="green">통과</Badge>
        </div>
        <div className="kpi">
          <span>기존 API 회귀</span>
          <b>12/12</b>
          <Badge tone="green">통과</Badge>
        </div>
        <div className="kpi">
          <span>되돌림</span>
          <b>{run.rollbacks}회</b>
          <Badge tone={run.rollbacks ? 'orange' : 'gray'}>{run.rollbacks ? '자동 수정' : '없음'}</Badge>
        </div>
        <div className="kpi">
          <span>구현 → 배포 준비</span>
          <b>{mins ? `${mins.toFixed(1)}분` : '—'}</b>
          <Badge tone="gray">기존 95.6분</Badge>
        </div>
      </div>
      <div className="res-body">
        <div>
          <h4>수용 기준 대조</h4>
          <ul className="res-ac">
            {final.map((r, k) => (
              <li key={r[0]}>
                <span className="ok-dot">
                  <Icon name="check" className="ico-xs" />
                </span>
                <span className="mono">{r[0]}</span>
                <span className="res-t">{r[2]}</span>
                {first[k][1] === 'fail' && <Badge tone="orange">1차 실패 → 통과</Badge>}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h4>배포 승인</h4>
          <p className="res-approve">
            <b>{g4?.by}</b> 승인 · “{g4?.text}”
          </p>
          <p className="muted small">
            변경 파일 {art.files[0].length}개 · AI 리뷰 지적 {art.findings.length}건 · 위험 {run.risk}
          </p>
          <div className="res-btns">
            <button className="btn primary" onClick={() => ctx.go('report', issue.issue_id)}>
              상세 검증 리포트
            </button>
          </div>
        </div>
      </div>
    </div>
    <AiResultCard issue={issue} run={run} design={ctx.ai[issue.issue_id]} impl={ctx.impl[issue.issue_id]} qa={ctx.qa[issue.issue_id] ?? []} log={ctx.aiLog[issue.issue_id] ?? []} />
    </>
  )
}
