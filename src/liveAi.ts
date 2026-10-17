// 실제 AI 호출 — Pollinations 무료 공개 API (API 키·가입 없음, 브라우저에서 직접 호출)
// 응답을 실시간(스트리밍)으로 받아 AI가 쓰는 과정을 화면에 보여 주고, 결과는 실행기 규칙으로 검사한다.
//   · 설계 호출: 설계 요구사항 · 위험 등급 · 배포 요약 (설계 반려 시 반려 사유를 넣어 다시)
//   · 구현 호출: 코드 변경안 · API 테스트 요청 · 자기 리뷰
//   · 이슈 작성: 한 문장 → 제목 · 유형 · 수용 기준
//   · 질문: PL 질문에 이슈 · 설계 · 파일 · API 목록만 근거로 답변

export type Risk = '낮음' | '보통' | '높음'

export interface AiIssue {
  id: string
  type: 'feature' | 'bug'
  title: string
  description: string
  ac: string[] // "AC-1 ..." 형식
}

export interface AiFacts {
  files: number
  backend: number
  screen: number
  acTotal: number
  regression: number
  rollbacks: number
}

export interface Check {
  pass: boolean
  detail: string
}

export interface AiFailure {
  ok: false
  reason: string
  raw?: string
}

interface Meta {
  ok: true
  model: string
  elapsedMs: number
  createdAt: string
  cached: boolean
  raw: string
}

export interface AiResult extends Meta {
  requirements: { text: string; ac: string[] }[]
  risk: Risk
  riskReason: string
  evidence: string[]
  summary: string // 숫자 대조 통과 시 AI 원문, 실패 시 템플릿 요약
  aiSummary: string // AI가 쓴 요약 원문
  summaryFromAi: boolean
  checks: { coverage: Check; evidence: Check; numbers: Check }
}

export interface ApiRequest {
  id: string
  cond: string
  request: string
  expected: string
  ac: string[]
}

export interface Finding {
  id: string
  severity: string
  message: string
  quote: string
  kept: boolean // 인용한 코드가 AI 코드에 있으면 반영, 없으면 보류
}

export interface ImplResult extends Meta {
  file: string
  code: string
  apiRequests: ApiRequest[]
  checks: { tags: Check; api: Check }
}

export interface ReviewResult extends Meta {
  file: string
  findings: Finding[]
  check: Check
}

export interface IntakeResult extends Meta {
  title: string
  type: 'feature' | 'bug'
  description: string
  ac: string[]
  checks: { count: Check; vague: Check }
}

export interface AskResult extends Meta {
  answer: string
  check: Check
}

export type AiPhase = 'waiting' | 'calling' | 'thinking' | 'streaming'
export interface AiProgress {
  phase: AiPhase
  seconds?: number
  text?: string
}
type OnProgress = (p: AiProgress) => void

const ENDPOINT = 'https://text.pollinations.ai/openai'
const MODEL = 'openai-fast'
export const MODEL_LABEL = 'GPT-OSS 20B'
const CACHE_PREFIX = 'ai-live:'
// 무료 한도: 접속자당 30초에 1회(직전 호출 시작 기준). 웹 페이지에서 더 빨리 부르면 응답 없이 멈추므로 미리 기다린다.
const GAP_MS = 31000
const LAST_KEY = 'ai-live-last'
const FIRST_BYTE_MS = 30000
const IDLE_MS = 20000
const TOTAL_MS = 80000
let lastStartMem = 0

const ROLE = (job: string) => `너는 사내 'AI 개발 공정 에이전트'의 ${job} 담당이다. 반드시 한국어로 답한다.`

// ── 공통: 차례 기다리기 + 실시간 호출 ─────────────────────
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

function lastStart() {
  try {
    return Math.max(lastStartMem, Number(localStorage.getItem(LAST_KEY) ?? 0))
  } catch {
    return lastStartMem
  }
}

function markStart(at = Date.now()) {
  lastStartMem = at
  try {
    localStorage.setItem(LAST_KEY, String(at))
  } catch {
    /* 저장소를 못 쓰면 메모리 값만 사용 */
  }
}

async function waitTurn(onProgress?: OnProgress) {
  for (;;) {
    const left = Math.ceil((lastStart() + GAP_MS - Date.now()) / 1000)
    if (left <= 0) return
    onProgress?.({ phase: 'waiting', seconds: left })
    await sleep(1000)
  }
}

type ChatOk = { ok: true; content: string; elapsedMs: number }

async function streamChat(messages: { role: string; content: string }[], onProgress?: OnProgress, retry = true): Promise<ChatOk | AiFailure> {
  await waitTurn(onProgress)
  onProgress?.({ phase: 'calling' })
  markStart()
  const t0 = Date.now()
  const ctrl = new AbortController()
  let why = ''
  const abort = (reason: string) => {
    why = reason
    ctrl.abort()
  }
  const total = setTimeout(() => abort(`${TOTAL_MS / 1000}초 안에 끝나지 않음`), TOTAL_MS)
  let idle = setTimeout(() => abort(`${FIRST_BYTE_MS / 1000}초 안에 응답 없음`), FIRST_BYTE_MS)
  const touch = () => {
    clearTimeout(idle)
    idle = setTimeout(() => abort('응답이 중간에 멈춤'), IDLE_MS)
  }
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // seed를 매번 바꿔 서버에 저장된 이전 답을 재사용하지 않고 항상 새로 생성하게 한다
      body: JSON.stringify({ model: MODEL, reasoning_effort: 'low', stream: true, seed: Math.floor(Math.random() * 1e9), messages }),
      signal: ctrl.signal,
    })
    if ((res.status === 402 || res.status === 429) && retry) {
      // 한도에 걸렸다는 응답 — 안내된 시간만큼 기다렸다가 1번 더
      const text = await res.text()
      const wait = Math.min(Number(text.match(/wait (\d+) second/i)?.[1] ?? 30) + 1, 35)
      markStart(Date.now() + wait * 1000 - GAP_MS)
      clearTimeout(total)
      clearTimeout(idle)
      return streamChat(messages, onProgress, false)
    }
    if (!res.ok) return { ok: false, reason: `AI 서버 응답 ${res.status}` }
    if (!(res.headers.get('content-type') ?? '').includes('event-stream')) {
      const j = await res.json()
      return { ok: true, content: String(j?.choices?.[0]?.message?.content ?? ''), elapsedMs: Date.now() - t0 }
    }
    const reader = res.body!.getReader()
    const dec = new TextDecoder()
    let buf = ''
    let content = ''
    let thinking = false
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      touch()
      buf += dec.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.startsWith('data:') || line.includes('[DONE]')) continue
        try {
          const d = JSON.parse(line.slice(5))?.choices?.[0]?.delta ?? {}
          if (d.reasoning && !content && !thinking) {
            thinking = true
            onProgress?.({ phase: 'thinking' })
          }
          if (d.content) {
            content += d.content
            onProgress?.({ phase: 'streaming', text: content })
          }
        } catch {
          /* 조각 하나가 깨져도 계속 */
        }
      }
    }
    if (!content.trim()) return { ok: false, reason: 'AI가 빈 응답을 보냄' }
    return { ok: true, content, elapsedMs: Date.now() - t0 }
  } catch (e) {
    return { ok: false, reason: why || (e instanceof Error ? e.message : String(e)) }
  } finally {
    clearTimeout(total)
    clearTimeout(idle)
  }
}

// ── 저장된 결과 ─────────────────────────────────────────
const keyOf = (kind: string, ...parts: string[]) => {
  let h = 7
  for (const c of parts.join('|')) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return `${CACHE_PREFIX}${kind}:${h}`
}

function cacheGet<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? { ...(JSON.parse(raw) as T), cached: true } : null
  } catch {
    return null
  }
}

function cacheSet(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v))
  } catch {
    /* 저장 실패는 무시 */
  }
}

export function clearAiCache() {
  try {
    Object.keys(localStorage).filter(k => k.startsWith(CACHE_PREFIX)).forEach(k => localStorage.removeItem(k))
  } catch {
    /* 저장소를 못 쓰면 무시 */
  }
}

const meta = (content: string, elapsedMs: number): Meta => ({
  ok: true, model: MODEL_LABEL, elapsedMs, createdAt: new Date().toISOString(), cached: false, raw: content,
})

// ── 응답 해석 도우미 ──────────────────────────────────────
function parseJson(content: string) {
  const s = content.replace(/<think>[\s\S]*?<\/think>/g, '')
  const a = s.indexOf('{')
  const b = s.lastIndexOf('}')
  if (a < 0 || b <= a) throw new Error('응답에 JSON이 없음')
  return JSON.parse(s.slice(a, b + 1))
}

const acIdOf = (a: string, i: number) => a.match(/^AC-\d+/i)?.[0].toUpperCase() ?? `AC-${i + 1}`
const normAc = (s: unknown) => String(s).toUpperCase().replace(/\s/g, '').replace(/^AC(\d)/, 'AC-$1')
const normText = (s: string) => s.replace(/[\s'"“”‘’`.,·()[\]]/g, '')
const squash = (s: string) => s.replace(/\s+/g, '')
const UI_AC = /화면|버튼|메뉴|표시|키보드|입력란|클릭/

function normRisk(v: unknown): Risk | null {
  const s = String(v ?? '').trim()
  if (/높음|^상$|high/i.test(s)) return '높음'
  if (/보통|^중$|medium|moderate/i.test(s)) return '보통'
  if (/낮음|^하$|low/i.test(s)) return '낮음'
  return null
}

/** 아직 덜 온 JSON 문자열 조각을 사람이 읽는 글자로 바꾼다 */
function unescapePartial(s: string) {
  return s
    .replace(/\\(u[0-9a-fA-F]{0,3})?$/, '')
    .replace(/\\(u[0-9a-fA-F]{4}|.)/g, m => {
      try {
        return JSON.parse(`"${m}"`)
      } catch {
        return ''
      }
    })
}

const fieldAll = (src: string, key: string) =>
  [...src.matchAll(new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)`, 'g'))].map(m => unescapePartial(m[1]))
const fieldOne = (src: string, key: string): string | undefined => fieldAll(src, key)[0]

// ── ① 설계 호출 ─────────────────────────────────────────
function designPrompt(issue: AiIssue, f: AiFacts, feedback?: string) {
  return [
    '[이슈]',
    `ID: ${issue.id}`,
    `유형: ${issue.type === 'bug' ? '버그' : '기능'}`,
    `제목: ${issue.title}`,
    `설명: ${issue.description || '(없음)'}`,
    '수용 기준:',
    ...issue.ac,
    ...(feedback ? ['', '[PL 반려 사유 — 설계 요구사항에 반드시 반영]', feedback] : []),
    '',
    '[배포 준비 사실 — 요약에는 이 숫자만 사용]',
    `변경 파일 ${f.files}개 (백엔드 ${f.backend} · 화면 ${f.screen})`,
    `수용 기준 ${f.acTotal}/${f.acTotal} 통과`,
    `기존 API 회귀 ${f.regression}/${f.regression} 통과`,
    `되돌림 ${f.rollbacks}회 (구현 중 기준 대조에 실패해 구현 단계로 돌아간 횟수, 배포 후 롤백 아님)`,
    '',
    '[할 일]',
    '1. requirements: 설계 요구사항 3~5개. 각 항목은 40자 안팎의 한 문장이고, 관련 수용 기준 번호를 ac 배열에 넣는다. 모든 수용 기준이 최소 한 번은 들어가야 한다.',
    '2. risk: 변경 위험 등급. "낮음", "보통", "높음" 세 단어 중 하나를 글자 그대로 쓴다(상·중·하, 영어 금지). risk_reason은 한 문장.',
    '3. evidence: 위험 판단의 근거가 된 문구 1~2개. [이슈]의 제목·설명·수용 기준 문장에서 일부를 글자 하나 바꾸지 말고 그대로 복사한다. "AC-2 본문" 같은 설명이나 [배포 준비 사실]의 문장은 쓰지 않는다.',
    '4. summary: PL에게 보낼 배포 승인 요청 요약 2문장, 존댓말(~습니다). 숫자는 [배포 준비 사실]에 있는 숫자만 쓰고, 퍼센트·비율·추정치는 쓰지 않는다.',
    '',
    '[출력 형식] 설명 없이 JSON 객체 하나만 출력한다.',
    '{"requirements":[{"text":"","ac":["AC-1"]}],"risk":"","risk_reason":"","evidence":[""],"summary":""}',
  ].join('\n')
}

function numbersIn(s: string) {
  const cleaned = s.replace(/ISSUE-\d+/gi, ' ').replace(/\b(?:AC|REQ|S|G|F)-?\d+[a-z]?/gi, ' ')
  return (cleaned.match(/\d+(?:\.\d+)?/g) ?? []).map(Number)
}

function checkCoverage(issue: AiIssue, reqs: { ac: string[] }[]): Check {
  const ids = issue.ac.map(acIdOf)
  const covered = ids.filter(id => reqs.some(r => r.ac.includes(id)))
  const missing = ids.filter(id => !covered.includes(id))
  return {
    pass: missing.length === 0,
    detail: `수용 기준 ${covered.length}/${ids.length} 반영${missing.length ? ` · 누락 ${missing.join(', ')} → PL 확인 필요` : ''}`,
  }
}

function checkEvidence(issue: AiIssue, evidence: string[]): Check {
  const source = normText([issue.title, issue.description, ...issue.ac].join(' '))
  const found = evidence.filter(e => normText(e).length >= 2 && source.includes(normText(e)))
  return {
    pass: evidence.length > 0 && found.length === evidence.length,
    detail: evidence.length
      ? `근거 인용 ${found.length}/${evidence.length}건 원문에서 확인${found.length < evidence.length ? ' · 원문에 없는 인용 있음' : ''}`
      : '근거 인용 없음',
  }
}

export function checkNumbers(issue: AiIssue, f: AiFacts, summary: string): Check {
  const allowed = new Set([
    f.files, f.backend, f.screen, f.acTotal, f.regression, f.rollbacks,
    ...numbersIn([issue.title, issue.description, ...issue.ac].join(' ')),
  ])
  const nums = numbersIn(summary)
  const wrong = [...new Set(nums.filter(n => !allowed.has(n)))]
  if (!nums.length) return { pass: false, detail: '요약에 숫자가 없음 → 템플릿 요약으로 대체' }
  return wrong.length
    ? { pass: false, detail: `실제 값에 없는 숫자 ${wrong.join(', ')} → 템플릿 요약으로 대체` }
    : { pass: true, detail: `요약 속 숫자 ${nums.length}개 모두 실제 값과 일치` }
}

export function templateSummary(issue: AiIssue, f: AiFacts) {
  return `${issue.title} 변경을 마쳤습니다. 변경 파일 ${f.files}개(백엔드 ${f.backend} · 화면 ${f.screen}), 수용 기준 ${f.acTotal}/${f.acTotal} 통과, 기존 API 회귀 ${f.regression}/${f.regression} 통과, 되돌림 ${f.rollbacks}회입니다.`
}

const designKey = (issue: AiIssue, feedback = '') => keyOf('design', issue.id, issue.title, issue.description, issue.ac.join('|'), feedback)

export const getCachedDesign = (issue: AiIssue, feedback?: string) => cacheGet<AiResult>(designKey(issue, feedback))

// 호출은 항상 새로 생성하고, 저장한 결과는 새로고침 뒤 화면을 되살릴 때만 쓴다
export async function runDesign(issue: AiIssue, facts: AiFacts, onProgress?: OnProgress, feedback?: string): Promise<AiResult | AiFailure> {
  const r = await streamChat(
    [
      { role: 'system', content: ROLE('설계·분류·요약') + ' 설명 없이 JSON 객체 하나만 출력한다.' },
      { role: 'user', content: designPrompt(issue, facts, feedback) },
    ],
    onProgress,
  )
  if (!r.ok) return r
  try {
    const j = parseJson(r.content)
    const requirements = (Array.isArray(j.requirements) ? j.requirements : [])
      .map((x: unknown) => {
        if (typeof x === 'string') return { text: x.trim(), ac: (x.match(/AC-?\d+/gi) ?? []).map(normAc) }
        const o = (x ?? {}) as { text?: unknown; ac?: unknown }
        return { text: String(o.text ?? '').trim(), ac: (Array.isArray(o.ac) ? o.ac : []).map(normAc) }
      })
      .filter((x: { text: string }) => x.text)
      .slice(0, 6)
    const risk = normRisk(j.risk)
    const summary = (Array.isArray(j.summary) ? j.summary.join(' ') : String(j.summary ?? '')).trim()
    if (!requirements.length || !risk || !summary) return { ok: false, reason: 'AI 응답 형식 오류 (필수 항목 누락)', raw: r.content }
    const evidence = (Array.isArray(j.evidence) ? j.evidence : []).map(String).filter(Boolean).slice(0, 3)
    const numbers = checkNumbers(issue, facts, summary)
    const result: AiResult = {
      ...meta(r.content, r.elapsedMs),
      requirements,
      risk,
      riskReason: String(j.risk_reason ?? '').trim(),
      evidence,
      summary: numbers.pass ? summary : templateSummary(issue, facts),
      aiSummary: summary,
      summaryFromAi: numbers.pass,
      checks: { coverage: checkCoverage(issue, requirements), evidence: checkEvidence(issue, evidence), numbers },
    }
    cacheSet(designKey(issue, feedback), result)
    return result
  } catch (e) {
    return { ok: false, reason: `AI 응답 해석 실패 (${e instanceof Error ? e.message : e})`, raw: r.content }
  }
}

/** 설계 호출이 쓰는 중인 JSON을 사람이 읽는 줄로 */
export function previewDesign(partial: string) {
  const out: string[] = []
  const reqs = [...partial.matchAll(/"text"\s*:\s*"((?:[^"\\]|\\.)*)"?(?:\s*,\s*"ac"\s*:\s*\[([^\]]*)\]?)?/g)]
  if (reqs.length) {
    out.push('설계 요구사항')
    reqs.forEach((m, i) => {
      const ac = (m[2] ?? '').replace(/["\s]/g, '').replace(/,/g, ' ')
      out.push(`${i + 1}. ${unescapePartial(m[1])}${ac ? `   ${ac}` : ''}`)
    })
  }
  const risk = fieldOne(partial, 'risk')
  if (risk !== undefined) out.push('', `위험 등급: ${risk}`)
  const reason = fieldOne(partial, 'risk_reason')
  if (reason !== undefined) out.push(`이유: ${reason}`)
  const ev = partial.match(/"evidence"\s*:\s*\[([\s\S]*?)(\]|$)/)
  if (ev) [...ev[1].matchAll(/"((?:[^"\\]|\\.)*)"?/g)].forEach(m => m[1] && out.push(`근거: “${unescapePartial(m[1])}”`))
  const summary = fieldOne(partial, 'summary')
  if (summary !== undefined) out.push('', `배포 요약 초안: ${summary}`)
  return out.join('\n')
}

// ── ② 구현 호출 ─────────────────────────────────────────
function implPrompt(issue: AiIssue, reqs: string[], file: string, api: string, others: string[]) {
  return [
    '[이슈]',
    `ID: ${issue.id} · ${issue.type === 'bug' ? '버그' : '기능'} · ${issue.title}`,
    '수용 기준:',
    ...issue.ac,
    '',
    '[승인된 설계 요구사항]',
    ...reqs.map((r, i) => `요구${i + 1}: ${r}`),
    '',
    '[구현 대상]',
    `파일: ${file} (Java, Spring + MyBatis)`,
    `API: ${api}`,
    `함께 바뀌는 파일: ${others.join(', ') || '(없음)'}`,
    '',
    '[할 일]',
    '1. import 문과 클래스 선언 없이, 위 파일의 핵심 메서드만 Java로 25줄 이내로 쓴다. 각 요구사항을 구현한 줄 끝에 // 요구1 처럼 번호 주석을 단다. 이 파일에서 구현하지 않는 요구사항(화면 등)은 코드 맨 위에 // 요구1: TripList.vue에서 처리 처럼 처리하는 파일을 주석으로 적는다. 모든 요구사항 번호가 최소 한 번은 나와야 한다.',
    '2. API 테스트 요청 3개. cond는 확인 조건(한국어), request는 "GET /api/...?파라미터" 형태, expected는 기대 결과 한 구절(한국어), ac는 이 요청이 확인하는 수용 기준 번호 배열.',
    '',
    '[출력 형식] 아래 두 블록만 순서대로 출력한다. 다른 설명은 쓰지 않는다.',
    '```java',
    '(코드)',
    '```',
    '```json',
    '{"api_requests":[{"id":"REQ-01","cond":"","request":"","expected":"","ac":["AC-2"]}]}',
    '```',
  ].join('\n')
}

function checkTags(code: string, n: number): Check {
  const nums = Array.from({ length: n }, (_, i) => i + 1)
  const found = nums.filter(i => new RegExp(`요구\\s*${i}(?!\\d)`).test(code))
  const missing = nums.filter(i => !found.includes(i))
  return {
    pass: missing.length === 0,
    detail: `설계 요구사항 ${found.length}/${n}이 코드에 반영(추적 주석)${missing.length ? ` · 요구${missing.join(', 요구')} 없음` : ''}`,
  }
}

function checkApi(issue: AiIssue, reqs: ApiRequest[]): Check {
  const ids = issue.ac.map(acIdOf)
  const apiIds = ids.filter((_, i) => !UI_AC.test(issue.ac[i]))
  const ui = ids.length - apiIds.length
  if (!reqs.length) return { pass: false, detail: 'API 테스트 요청이 없음' }
  if (!apiIds.length) return { pass: true, detail: `요청 ${reqs.length}건 · 수용 기준이 모두 화면 기준이라 화면 시험으로 확인` }
  const covered = apiIds.filter(id => reqs.some(r => r.ac.includes(id)))
  const missing = apiIds.filter(id => !covered.includes(id))
  return {
    pass: missing.length === 0,
    detail: `API로 확인할 수용 기준 ${covered.length}/${apiIds.length} 포함${ui ? ` · 화면 기준 ${ui}개는 화면 시험` : ''}${missing.length ? ` · 빠짐 ${missing.join(', ')}` : ''}`,
  }
}

function reviewCheck(review: Finding[]): Check {
  const kept = review.filter(f => f.kept).length
  const held = review.length - kept
  if (!review.length) return { pass: true, detail: 'AI 리뷰 지적 0건' }
  return { pass: held === 0, detail: `AI 리뷰 지적 ${review.length}건: 반영 ${kept} · 보류 ${held}${held ? ' (인용한 코드가 구현 코드에 없음)' : ''}` }
}

const implKey = (issue: AiIssue, reqs: string[], file: string) => keyOf('impl', issue.id, issue.title, issue.ac.join('|'), reqs.join('|'), file)

export const getCachedImpl = (issue: AiIssue, reqs: string[], file: string) => cacheGet<ImplResult>(implKey(issue, reqs, file))

export async function runImpl(issue: AiIssue, reqs: string[], file: string, api: string, others: string[], onProgress?: OnProgress): Promise<ImplResult | AiFailure> {
  const r = await streamChat(
    [
      { role: 'system', content: ROLE('구현') + ' 지시한 두 블록(java, json)만 출력한다.' },
      { role: 'user', content: implPrompt(issue, reqs, file, api, others) },
    ],
    onProgress,
  )
  if (!r.ok) return r
  const fence = r.content.match(/```(?:java)?[^\n]*\n([\s\S]*?)```/)
  const code = (fence?.[1] ?? '').replace(/\s+$/, '')
  if (!fence || !code) return { ok: false, reason: 'AI 응답에 코드 블록이 없음', raw: r.content }
  let apiRequests: ApiRequest[] = []
  try {
    const j = parseJson(r.content.slice((fence.index ?? 0) + fence[0].length))
    apiRequests = (Array.isArray(j.api_requests) ? j.api_requests : []).slice(0, 4).map((x: Record<string, unknown>, i: number) => ({
      id: String(x?.id ?? `REQ-0${i + 1}`),
      cond: String(x?.cond ?? ''),
      request: String(x?.request ?? ''),
      expected: String(x?.expected ?? ''),
      ac: (Array.isArray(x?.ac) ? x.ac : []).map(normAc),
    }))
  } catch {
    /* 표 부분이 깨지면 코드만 쓰고, 빈 결과는 검사에서 드러난다 */
  }
  const result: ImplResult = {
    ...meta(r.content, r.elapsedMs),
    file,
    code,
    apiRequests,
    checks: { tags: checkTags(code, reqs.length), api: checkApi(issue, apiRequests) },
  }
  cacheSet(implKey(issue, reqs, file), result)
  return result
}

/** 구현 호출이 쓰는 중인 내용을 사람이 읽는 줄로 */
export function previewImpl(partial: string, file: string) {
  const out = [`// ${file} — AI 작성`]
  const start = partial.match(/```(?:java)?[^\n]*\n/)
  if (!start) return out.join('\n')
  const body = partial.slice((start.index ?? 0) + start[0].length)
  const end = body.indexOf('```')
  out.push(end < 0 ? body : body.slice(0, end).replace(/\s+$/, ''))
  if (end < 0) return out.join('\n')
  const rest = body.slice(end + 3)
  const conds = fieldAll(rest, 'cond')
  const reqs = fieldAll(rest, 'request')
  if (conds.length) {
    out.push('', 'API 테스트 요청')
    conds.forEach((c, i) => out.push(`REQ-0${i + 1}  ${c}${reqs[i] ? `  ·  ${reqs[i]}` : ''}`))
  }
  return out.join('\n')
}

// ── ③ AI 리뷰 호출: 구현 호출이 쓴 코드를 다른 호출이 읽고 지적 ──
function reviewPrompt(issue: AiIssue, reqs: string[], file: string, code: string) {
  return [
    `[이슈] ${issue.id} ${issue.title}`,
    '[설계 요구사항]',
    ...reqs.map((r, i) => `요구${i + 1}: ${r}`),
    '',
    `[리뷰할 코드 — ${file}]`,
    '```java',
    code,
    '```',
    '',
    '[할 일] 위 코드만 읽고 결함이나 위험 1~3개를 지적한다.',
    '- severity: "높음", "중간", "낮음" 중 하나',
    '- message: 무엇이 왜 문제인지 한국어 한 문장',
    '- quote: 근거가 되는 줄을 위 코드에서 따옴표 없이 글자 그대로 한 줄 복사',
    '',
    '[출력 형식] 설명 없이 JSON 객체 하나만 출력한다.',
    '{"review":[{"id":"F-01","severity":"","message":"","quote":""}]}',
  ].join('\n')
}

const reviewKey = (issue: AiIssue, code: string) => keyOf('review', issue.id, code)

export const getCachedReview = (issue: AiIssue, code: string) => cacheGet<ReviewResult>(reviewKey(issue, code))

export async function runReview(issue: AiIssue, reqs: string[], file: string, code: string, onProgress?: OnProgress): Promise<ReviewResult | AiFailure> {
  const r = await streamChat(
    [
      { role: 'system', content: ROLE('코드 리뷰') + ' 근거 없는 지적은 하지 않는다. 설명 없이 JSON 객체 하나만 출력한다.' },
      { role: 'user', content: reviewPrompt(issue, reqs, file, code) },
    ],
    onProgress,
  )
  if (!r.ok) return r
  try {
    const j = parseJson(r.content)
    const flat = squash(code)
    const findings: Finding[] = (Array.isArray(j.review) ? j.review : []).slice(0, 3).map((x: Record<string, unknown>, i: number) => {
      const quote = String(x?.quote ?? '').trim().replace(/^["'`“”‘’]+|["'`“”‘’]+$/g, '').trim()
      return {
        id: `F-0${i + 1}`,
        severity: String(x?.severity ?? '').trim(),
        message: String(x?.message ?? '').trim(),
        quote,
        kept: squash(quote).length >= 4 && flat.includes(squash(quote)),
      }
    })
    const result: ReviewResult = { ...meta(r.content, r.elapsedMs), file, findings, check: reviewCheck(findings) }
    cacheSet(reviewKey(issue, code), result)
    return result
  } catch (e) {
    return { ok: false, reason: `AI 응답 해석 실패 (${e instanceof Error ? e.message : e})`, raw: r.content }
  }
}

/** 리뷰 호출이 쓰는 중인 JSON을 사람이 읽는 줄로 */
export function previewReview(partial: string, file: string) {
  const out = [`AI 리뷰 · ${file}`]
  const sev = fieldAll(partial, 'severity')
  const msg = fieldAll(partial, 'message')
  const quote = fieldAll(partial, 'quote')
  const n = Math.max(sev.length, msg.length)
  for (let i = 0; i < n; i++) {
    out.push('', `F-0${i + 1}${sev[i] ? ` [${sev[i]}]` : ''} ${msg[i] ?? ''}`)
    if (quote[i] !== undefined) out.push(`   인용: ${quote[i]}`)
  }
  return out.join('\n')
}

// ── ④ 한 문장으로 이슈 작성 ──────────────────────────────
const VAGUE = /적절|빠르게|빠른|편리|편하게|쉽게|최대한|원활|충분|가능한 한|등등/g

export async function runIntake(sentence: string, onProgress?: OnProgress): Promise<IntakeResult | AiFailure> {
  const r = await streamChat(
    [
      { role: 'system', content: ROLE('이슈 접수') + ' 설명 없이 JSON 객체 하나만 출력한다.' },
      {
        role: 'user',
        content: [
          `[요청 문장] ${sentence.trim()}`,
          '[대상 시스템] 사내 출장관리 시스템 (출장 신청 · 승인 · 정산 · 통계 화면)',
          '',
          '[할 일] 이 요청을 개발 이슈로 정리한다.',
          '- title: 30자 이내 제목',
          '- type: "기능" 또는 "버그"',
          '- description: 요청 배경 한 문장',
          '- acceptance_criteria: 검증할 수 있는 수용 기준 3~4개. 화면 위치 · 항목 이름 · 숫자처럼 확인 가능한 조건으로 쓰고, "적절히", "빠르게", "편리하게" 같은 모호한 말은 쓰지 않는다. 번호는 붙이지 않는다.',
          '',
          '[출력 형식] {"title":"","type":"","description":"","acceptance_criteria":[""]}',
        ].join('\n'),
      },
    ],
    onProgress,
  )
  if (!r.ok) return r
  try {
    const j = parseJson(r.content)
    const ac: string[] = (Array.isArray(j.acceptance_criteria) ? j.acceptance_criteria : [])
      .map((a: unknown) => String(a).replace(/^\s*(AC-?\d+[.:)]?|\d+[.)])\s*/i, '').trim())
      .filter(Boolean)
      .slice(0, 6)
    const title = String(j.title ?? '').trim().slice(0, 40)
    if (!title || !ac.length) return { ok: false, reason: 'AI 응답 형식 오류 (제목 또는 수용 기준 없음)', raw: r.content }
    const vague = ac.flatMap(a => a.match(VAGUE) ?? [])
    const result: IntakeResult = {
      ...meta(r.content, r.elapsedMs),
      title,
      type: /버그|bug/i.test(String(j.type)) ? 'bug' : 'feature',
      description: String(j.description ?? '').trim(),
      ac,
      checks: {
        count: { pass: ac.length >= 2 && ac.length <= 5, detail: `수용 기준 ${ac.length}개${ac.length > 5 ? ' → 5개 이하 권장' : ac.length < 2 ? ' → 2개 이상 필요' : ''}` },
        vague: { pass: vague.length === 0, detail: vague.length ? `모호한 표현 ${vague.length}건(${[...new Set(vague)].join(', ')}) → 고쳐 쓰기 권장` : '모호한 표현 0건' },
      },
    }
    return result
  } catch (e) {
    return { ok: false, reason: `AI 응답 해석 실패 (${e instanceof Error ? e.message : e})`, raw: r.content }
  }
}

export function previewIntake(partial: string) {
  const out: string[] = []
  const title = fieldOne(partial, 'title')
  if (title !== undefined) out.push(`제목: ${title}`)
  const type = fieldOne(partial, 'type')
  if (type !== undefined) out.push(`유형: ${type}`)
  const desc = fieldOne(partial, 'description')
  if (desc !== undefined) out.push(`설명: ${desc}`)
  const acs = partial.match(/"acceptance_criteria"\s*:\s*\[([\s\S]*?)(\]|$)/)
  if (acs) [...acs[1].matchAll(/"((?:[^"\\]|\\.)*)"?/g)].forEach((m, i) => m[1] && out.push(`AC-${i + 1} ${unescapePartial(m[1])}`))
  return out.join('\n')
}

// ── ⑤ PL 질문 ──────────────────────────────────────────
export interface AskContext {
  issue: AiIssue
  requirements: string[]
  files: string[]
  newApi: string // "GET /api/trips/export"
  regression: string[] // "GET /api/trips 출장 목록"
}

export async function runAsk(ctx: AskContext, question: string, onProgress?: OnProgress): Promise<AskResult | AiFailure> {
  const r = await streamChat(
    [
      { role: 'system', content: ROLE('설계 설명') + ' 주어진 정보만 근거로 답하고, 모르는 것은 모른다고 말한다.' },
      {
        role: 'user',
        content: [
          `[이슈] ${ctx.issue.id} ${ctx.issue.title}`,
          ...ctx.issue.ac,
          '',
          '[설계 요구사항]',
          ...ctx.requirements.map((r, i) => `요구${i + 1}: ${r}`),
          '',
          `[바꿀 파일] ${ctx.files.join(', ')}`,
          `[새 API] ${ctx.newApi}`,
          '[기존 API — 회귀 확인 대상]',
          ...ctx.regression,
          '',
          `[PL 질문] ${question.trim()}`,
          '',
          '[답변 규칙] 3문장 이내 존댓말. 파일이나 API를 말할 때는 위 목록의 이름을 그대로 쓴다. 마크다운 · 목록 기호 없이 문장만 쓴다.',
        ].join('\n'),
      },
    ],
    onProgress,
  )
  if (!r.ok) return r
  const answer = r.content.replace(/[*#`]/g, '').trim()
  // 언급한 파일 · API가 실제 목록에 있는지, API는 메서드까지 맞는지 대조
  const apis = [ctx.newApi, ...ctx.regression].map(s => s.split(' ').slice(0, 2).join(' '))
  const knownApis = new Set(apis)
  const knownPaths = new Set(apis.map(a => a.split(' ')[1]))
  const files = [...new Set(answer.match(/[\w-]+\.(?:java|xml|vue|ts)\b/g) ?? [])]
  const withMethod = [...new Set([...answer.matchAll(/\b(GET|POST|PUT|DELETE)\s+(\/api\/[\w/{}.-]*[\w}])/g)].map(m => `${m[1]} ${m[2]}`))]
  const bare = [...new Set(answer.match(/\/api\/[\w/{}.-]*[\w}]/g) ?? [])].filter(p => !withMethod.some(w => w.endsWith(' ' + p)))
  const mentioned = [...files, ...withMethod, ...bare]
  const unknown = [
    ...files.filter(f => !ctx.files.includes(f)),
    ...withMethod.filter(a => !knownApis.has(a)).map(a => (knownPaths.has(a.split(' ')[1]) ? `${a}(메서드 불일치)` : a)),
    ...bare.filter(p => !knownPaths.has(p)),
  ]
  const result: AskResult = {
    ...meta(r.content, r.elapsedMs),
    answer,
    check: !mentioned.length
      ? { pass: true, detail: '답변에 언급한 파일 · API 없음' }
      : unknown.length
        ? { pass: false, detail: `목록에 없는 항목 ${unknown.join(', ')} → 확인 필요` }
        : { pass: true, detail: `언급한 파일 · API ${mentioned.length}개 모두 실제 목록에 있음` },
  }
  return result
}

/** 위험 등급 비교: AI 판정 vs 규칙(계약 파일) 판정. 흐름은 규칙 판정을 따른다. */
export function compareRisk(ai: Risk, rule: Risk) {
  const rank = { 낮음: 0, 보통: 1, 높음: 2 }
  if (rank[ai] === rank[rule]) return { tone: 'green' as const, text: '규칙 판정과 일치' }
  if (rank[ai] < rank[rule]) return { tone: 'orange' as const, text: `AI 판정 ${ai} → 규칙 하한 ${rule} 적용` }
  return { tone: 'orange' as const, text: `AI가 더 높게 판단(${ai}) → PL 참고로 기록` }
}
