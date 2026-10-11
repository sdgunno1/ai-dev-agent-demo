import { useState } from 'react'
import type { Ctx } from '../App'
import type { Issue } from '../data'
import { artifactsOf, hm, implToReadyMinutes } from '../engine'
import type { Run } from '../engine'

function summaryOf(issue: Issue, run: Run) {
  const art = artifactsOf(issue)
  const files = art.files[0]
  const backend = files.filter(f => !f[0].startsWith('frontend')).length
  const acN = issue.acceptance_criteria.length
  const mins = implToReadyMinutes(run)
  const accepted = art.findings.filter(f => f.decision === '반영').length
  const hold = art.findings.length - accepted
  return { art, files, backend, ui: files.length - backend, acN, mins, accepted, hold }
}

export function ReleaseCard({ ctx, issue, run }: { ctx: Ctx; issue: Issue; run: Run }) {
  const s = summaryOf(issue, run)
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const waiting = run.gate?.ev.stage === 'G4'
  const g4 = run.approvals.filter(a => a.gate === 'G4').slice(-1)[0]
  const id = issue.issue_id
  const reqAt = run.gate?.simStart ?? run.history.find(h => h.stage === 'G4')?.start

  return (
    <div className="msg">
      <div className="msg-top">
        <span>업무 메신저 · AI 개발 공정 에이전트</span>
        <span className="mono">
          {run.dateLabel.slice(5)} {reqAt ? hm(reqAt) : ''}
        </span>
      </div>
      <div className="msg-body">
        <h3>
          [G4 배포 승인 요청] {id} {issue.title}
        </h3>
        <p className="msg-sub">
          위험 등급 {run.risk} · S07~S13 소요 {s.mins ? Math.round(s.mins) : '—'}분 · 되돌림 {run.rollbacks}회
        </p>
        <ul className="msg-list">
          <li className="ok">
            ✓ 변경 파일 {s.files.length}개 (백엔드 {s.backend}
            {s.ui ? ` · 화면 ${s.ui}` : ''})
          </li>
          <li className="ok">
            ✓ 수용 기준 {s.acN}/{s.acN} 통과 · 기존 API 회귀 12/12 통과
          </li>
          <li className="ok">✓ 보안 검사 · 통합 검사 이상 없음</li>
          {s.art.findings.length > 0 ? (
            <li className="warn">
              ! AI 리뷰 지적 {s.art.findings.length}건: 반영 {s.accepted}
              {s.hold ? ` · 보류 ${s.hold} (인용한 코드 없음)` : ''}
            </li>
          ) : (
            <li className="ok">✓ AI 리뷰 지적 0건</li>
          )}
        </ul>
        {waiting ? (
          rejecting ? (
            <div className="reject-row">
              <input autoFocus value={reason} placeholder="반려 사유 (필수)" onChange={e => setReason(e.target.value)} />
              <button
                className="btn danger"
                disabled={!reason.trim()}
                onClick={() => {
                  ctx.gateAction(id, { type: 'reject', text: reason.trim(), routeTo: 'S07' })
                  setRejecting(false)
                  setReason('')
                }}
              >
                반려 확정 → S07로 되돌림
              </button>
              <button className="btn ghost" onClick={() => setRejecting(false)}>
                취소
              </button>
            </div>
          ) : (
            <div className="msg-btns">
              <button className="btn primary" onClick={() => ctx.gateAction(id, { type: 'approve' })}>
                승인
              </button>
              <button className="btn ghost" onClick={() => setRejecting(true)}>
                반려
              </button>
              <button className="btn ghost" onClick={() => ctx.go('report', id)}>
                상세 리포트
              </button>
            </div>
          )
        ) : g4?.decision === 'approved' ? (
          <div className="msg-done">
            ✅ {g4.by} 승인 ({hm(g4.at)}) — “{g4.text}” → 배포 대기열 등록
          </div>
        ) : null}
      </div>
      <div className="msg-foot">승인 → 배포 대기열 등록 · 반려 → 사유와 함께 해당 단계로 되돌림</div>
    </div>
  )
}

