import { useState } from 'react'
import type { Ctx } from '../App'
import { CSV_HEADER, REGRESSION_APIS } from '../data'
import { artifactsOf, attemptsOf, hms, unit } from '../engine'
import { STAGE_INFO } from '../data'
import { Badge, Card, Empty, Icon, IssuePicker, Kpis, PageHead, ResultBadge, Seg, SimLabel } from '../ui'

type Tab = 'ac' | 'ladder' | 'review' | 'api' | 'reg' | 'log'

export default function Report({ ctx, id }: { ctx: Ctx; id: string }) {
  const issue = ctx.issues.find(i => i.issue_id === id) ?? ctx.issues[0]
  const run = ctx.runs[issue.issue_id]
  const art = artifactsOf(issue)
  const nS09 = Math.min(attemptsOf(run, 'S09'), art.ac.length)
  const nS07 = Math.min(attemptsOf(run, 'S07'), art.ladders.length)
  const nS07c = attemptsOf(run, 'S07c')
  const nS08 = attemptsOf(run, 'S08')
  const [tab, setTab] = useState<Tab>('ac')
  const [acTab, setAcTab] = useState<number | null>(null)
  const [ladTab, setLadTab] = useState<number | null>(null)
  const acIdx = Math.max(0, Math.min(acTab ?? nS09 - 1, nS09 - 1))
  const ladIdx = Math.max(0, Math.min(ladTab ?? nS07 - 1, nS07 - 1))
  const lastAc = nS09 ? art.ac[nS09 - 1] : []

  return (
    <div className="page">
      <PageHead
        title="검증 리포트"
        sub="AI의 “완료했다”는 말 대신, 실행기가 직접 실행해서 확인한 근거로 통과 여부를 판정합니다."
        right={
          <IssuePicker
            ctx={ctx}
            value={issue.issue_id}
            onChange={v => {
              setAcTab(null)
              setLadTab(null)
              ctx.go('report', v)
            }}
          />
        }
      />

      {!run || nS07 === 0 ? (
        <Card>
          <Empty>
            <p>{issue.issue_id}는 아직 구현 단계에 도달하지 않았습니다.</p>
            <button className="btn primary" onClick={() => ctx.finishNow(issue.issue_id)}>
              <Icon name="skip" className="ico-s" /> 공정 결과 바로 보기
            </button>
          </Empty>
        </Card>
      ) : (
        <>
          <Kpis
            items={[
              { label: '수용 기준', value: nS09 ? `${lastAc.filter(r => r[1] === 'pass').length}/${lastAc.length}` : '—', foot: nS09 ? <ResultBadge r={lastAc.every(r => r[1] === 'pass') ? 'pass' : 'fail'} /> : <Badge tone="gray">대기</Badge> },
              { label: '기존 API 회귀', value: '12/12', foot: <ResultBadge r="pass" /> },
              { label: 'API 요청 재생', value: nS07c ? `${art.api.length}/${art.api.length}` : '—', foot: nS07c ? <ResultBadge r="pass" /> : <Badge tone="gray">대기</Badge> },
              { label: '되돌림', value: `${run.rollbacks}회`, foot: <Badge tone={run.rollbacks ? 'orange' : 'gray'}>{run.rollbacks ? '실패 후 자동 수정' : '없음'}</Badge> },
            ]}
          />

          <div className="tabbar">
            <Seg<Tab>
              value={tab}
              onChange={setTab}
              options={[
                ['ac', '수용 기준'],
                ['ladder', '확인 사다리'],
                ['review', 'AI 리뷰'],
                ['api', 'API 재생'],
                ['reg', '회귀 12건'],
                ['log', '실행 기록'],
              ]}
            />
            <SimLabel />
          </div>

          {tab === 'ac' && (
            <Card
              title="수용 기준 대조 · S09"
              extra={
                nS09 > 1 && (
                  <Seg<string> value={String(acIdx)} onChange={v => setAcTab(+v)} options={Array.from({ length: nS09 }, (_, k) => [String(k), `${k + 1}차`] as [string, string])} />
                )
              }
            >
              {nS09 === 0 ? (
                <p className="muted">S09 대기 중</p>
              ) : (
                <div className="list">
                  {art.ac[acIdx].map((r, k) => {
                    const fixed = acIdx > 0 && art.ac[0][k][1] === 'fail' && r[1] === 'pass'
                    return (
                      <div key={r[0]} className={`li static ${r[1] === 'fail' ? 'li-fail' : ''}`}>
                        <span className={`lead ${r[1] === 'fail' ? 'bad' : 'good'}`}>
                          <Icon name={r[1] === 'fail' ? 'x' : 'check'} className="ico-xs" />
                        </span>
                        <span className="txt">
                          <b>
                            <span className="mono">{r[0]}</span> {issue.acceptance_criteria[k]?.replace(/^AC-\d+\s*/, '')}
                          </b>
                          <span className="wrap">{r[2]}</span>
                        </span>
                        {fixed ? <Badge tone="orange">실패 → 통과</Badge> : <ResultBadge r={r[1]} />}
                      </div>
                    )
                  })}
                </div>
              )}
            </Card>
          )}

          {tab === 'ladder' && (
            <Card
              title="확인 사다리 · S07 구현"
              extra={
                nS07 > 1 && <Seg<string> value={String(ladIdx)} onChange={v => setLadTab(+v)} options={Array.from({ length: nS07 }, (_, k) => [String(k), `${k + 1}차`] as [string, string])} />
              }
            >
              <ol className="ladder">
                {art.ladders[ladIdx].map(r => (
                  <li key={r[0]} className={`lad-${r[1]}`}>
                    <span className="mono">{r[0]}</span>
                    <span className="muted small">{r[3]}</span>
                    <span className="muted small mono">{r[2]}</span>
                    <ResultBadge r={r[1]} />
                  </li>
                ))}
              </ol>
              <p className="hint">순서대로 실행하고 하나라도 실패하면 변경을 원상 복구한 뒤 실패 로그를 AI에게 다시 넘깁니다 (최대 3회).</p>
              <h4 className="mini-h">변경 파일</h4>
              <div className="list">
                {art.files[ladIdx].map(f => (
                  <div key={f[0]} className="li static">
                    <span className="txt">
                      <b className="mono">{f[0]}</b>
                    </span>
                    <span className="plus">+{f[1]}</span>
                    <span className="minus">−{f[2]}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {tab === 'review' && (
            <Card title="AI 리뷰 지적 · S08" extra={<span className="muted small">바뀐 부분만 전달</span>}>
              {nS08 === 0 ? (
                <p className="muted">S08 대기 중</p>
              ) : art.findings.length === 0 ? (
                <p>지적 0건</p>
              ) : (
                <div className="findings">
                  {art.findings.map(f => (
                    <div key={f.id} className={`finding ${f.found ? 'acc' : 'hold'}`}>
                      <div className="f-h">
                        <b>{f.id}</b>
                        <span className="mono muted small">
                          {f.file}:{f.line}
                        </span>
                        <span className="spacer" />
                        <Badge tone={f.found ? 'green' : 'gray'}>{f.decision}</Badge>
                      </div>
                      <p>{f.message}</p>
                      <pre className="code">{f.quoted}</pre>
                      <p className="muted small">
                        {f.found ? '✓' : '✕'} {f.note}
                      </p>
                    </div>
                  ))}
                </div>
              )}
              {nS08 >= 2 && <p className="hint">2차 리뷰: 변경분에서 새 지적 0건</p>}
            </Card>
          )}

          {tab === 'api' && (
            <Card title="API 요청 재생 · S07c" extra={<span className="muted small">테스트 서버에 실제 재생</span>}>
              <div className="table-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>요청</th>
                      <th>조건</th>
                      <th>경로</th>
                      <th className="num">기대</th>
                      <th className="num">실제</th>
                      <th>판정</th>
                    </tr>
                  </thead>
                  <tbody>
                    {art.api.map(a => (
                      <tr key={a.id}>
                        <td className="mono">{a.id}</td>
                        <td>{a.cond}</td>
                        <td className="mono small">{a.path}</td>
                        <td className="num">{unit(a.expected)}</td>
                        <td className="num">{unit(a.actual)}</td>
                        <td>
                          <ResultBadge r="pass" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {art.csv && (
                <div className="csv-cmp">
                  <div>
                    <h4 className="mini-h">
                      REQ-01 응답 · 1차 <Badge tone="red">AC-3 실패</Badge>
                    </h4>
                    <Csv rows={art.csv.before} bad />
                  </div>
                  <div className={nS07 >= 2 ? '' : 'dim'}>
                    <h4 className="mini-h">
                      REQ-01 응답 · 2차 {nS07 >= 2 ? <Badge tone="green">통과</Badge> : <Badge tone="gray">대기</Badge>}
                    </h4>
                    <Csv rows={art.csv.after} />
                  </div>
                </div>
              )}
            </Card>
          )}

          {tab === 'reg' && (
            <Card title="기존 API 회귀" extra={<Badge tone="green">12/12 통과</Badge>}>
              <div className="reg-grid">
                {REGRESSION_APIS.map(a => (
                  <div key={a[0] + a[1]} className="reg">
                    <span className={`m m-${a[0]}`}>{a[0]}</span>
                    <span className="txt">
                      <span className="mono small">{a[1]}</span>
                      <span className="muted small">
                        {a[2]} · {a[3]}
                      </span>
                    </span>
                    <Icon name="check" className="ico-xs ok" />
                  </div>
                ))}
              </div>
            </Card>
          )}
          {tab === 'log' && (
            <Card title="실행 기록 · 감사 로그" extra={<span className="muted small">단계 {run.history.length}건 · 승인 {run.approvals.length}건</span>}>
              <div className="table-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>시각</th>
                      <th>단계</th>
                      <th>시도</th>
                      <th className="num">소요(초)</th>
                      <th>결과</th>
                      <th>비고</th>
                    </tr>
                  </thead>
                  <tbody>
                    {run.history.map((h, k) => (
                      <tr key={k} className={h.result === 'fail' ? 'row-fail' : ''}>
                        <td className="mono">{hms(h.end)}</td>
                        <td>
                          <span className="mono muted">{h.stage}</span> {STAGE_INFO[h.stage].name}
                        </td>
                        <td>{h.attempt}</td>
                        <td className="num">{h.duration_s}</td>
                        <td>
                          <ResultBadge r={h.result ?? 'pass'} />
                        </td>
                        <td>{h.note}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  )
}

function Csv({ rows, bad }: { rows: string[]; bad?: boolean }) {
  return (
    <div className="csv">
      <div className="csv-h">{CSV_HEADER}</div>
      {rows.map(r => {
        const i = r.lastIndexOf(',')
        const last = r.slice(i + 1)
        const hit = /T2609-000[256]/.test(r)
        return (
          <div key={r}>
            {r.slice(0, i + 1)}
            {hit ? <mark className={bad ? 'bad' : 'good'}>{last || '(빈칸)'}</mark> : last}
          </div>
        )
      })}
    </div>
  )
}
