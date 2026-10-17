// 실제 AI 호출 — Pollinations 무료 공개 API (API 키·가입 없음, 브라우저에서 직접 호출)
// 공정 1회에 1번만 호출해 설계 요구사항 · 위험 등급 · 배포 요약을 한꺼번에 받고,
// 받은 결과는 실행기 규칙(요구사항 반영 · 근거 인용 · 숫자 대조)으로 검사한다.
// PL이 설계를 반려하면 반려 사유를 넣어 한 번 더 호출한다.

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

export interface AiResult {
  ok: true
  model: string
  elapsedMs: number
  createdAt: string
  cached: boolean
  requirements: { text: string; ac: string[] }[]
  risk: Risk
  riskReason: string
  evidence: string[]
  summary: string // 숫자 대조 통과 시 AI 원문, 실패 시 템플릿 요약
  aiSummary: string // AI가 쓴 요약 원문
  summaryFromAi: boolean
  checks: { coverage: Check; evidence: Check; numbers: Check }
  raw: string
}

export interface AiFailure {
  ok: false
  reason: string
  raw?: string
}

export type AiStatus = { phase: 'calling' } | { phase: 'waiting'; seconds: number }

const ENDPOINT = 'https://text.pollinations.ai/openai'
const MODEL = 'openai-fast'
export const MODEL_LABEL = 'GPT-OSS 20B'
const TIMEOUT_MS = 30000
const CACHE_PREFIX = 'ai-live:'
// 무료 한도: 접속자당 30초에 1회(직전 호출 시작 기준). 웹 페이지에서 더 빨리 부르면 응답 없이 멈추므로 미리 기다린다.
const GAP_MS = 31000
const LAST_KEY = 'ai-live-last'
let lastStartMem = 0

const SYSTEM = "너는 사내 'AI 개발 공정 에이전트'의 설계·분류·요약 담당이다. 반드시 한국어로 답하고, 설명 없이 JSON 객체 하나만 출력한다."

function buildPrompt(issue: AiIssue, f: AiFacts, feedback?: string) {
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
    '[출력 형식]',
    '{"requirements":[{"text":"","ac":["AC-1"]}],"risk":"","risk_reason":"","evidence":[""],"summary":""}',
  ].join('\n')
}

// ── 실행기 검사 ──────────────────────────────────────────
const acIdOf = (a: string, i: number) => a.match(/^AC-\d+/i)?.[0].toUpperCase() ?? `AC-${i + 1}`
const normAc = (s: unknown) =>
  String(s).toUpperCase().replace(/\s/g, '').replace(/^AC(\d)/, 'AC-$1')
const normText = (s: string) => s.replace(/[\s'"“”‘’`.,·()[\]]/g, '')

function normRisk(v: unknown): Risk | null {
  const s = String(v ?? '').trim()
  if (/높음|^상$|high/i.test(s)) return '높음'
  if (/보통|^중$|medium|moderate/i.test(s)) return '보통'
  if (/낮음|^하$|low/i.test(s)) return '낮음'
  return null
}

function numbersIn(s: string) {
  const cleaned = s
    .replace(/ISSUE-\d+/gi, ' ')
    .replace(/\b(?:AC|REQ|S|G|F)-?\d+[a-z]?/gi, ' ')
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

// ── 호출 ────────────────────────────────────────────────
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

function lastStart() {
  try {
    return Math.max(lastStartMem, Number(localStorage.getItem(LAST_KEY) ?? 0))
  } catch {
    return lastStartMem
  }
}

function markStart() {
  lastStartMem = Date.now()
  try {
    localStorage.setItem(LAST_KEY, String(lastStartMem))
  } catch {
    /* 저장소를 못 쓰면 메모리 값만 사용 */
  }
}

async function waitTurn(onStatus?: (s: AiStatus) => void) {
  for (;;) {
    const left = Math.ceil((lastStart() + GAP_MS - Date.now()) / 1000)
    if (left <= 0) return
    onStatus?.({ phase: 'waiting', seconds: left })
    await sleep(1000)
  }
}

async function post(body: unknown) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })
    return { status: res.status, text: await res.text() }
  } finally {
    clearTimeout(timer)
  }
}

function parseJson(content: string) {
  const s = content.replace(/<think>[\s\S]*?<\/think>/g, '')
  const a = s.indexOf('{')
  const b = s.lastIndexOf('}')
  if (a < 0 || b <= a) throw new Error('응답에 JSON이 없음')
  return JSON.parse(s.slice(a, b + 1))
}

const cacheKey = (issue: AiIssue, feedback = '') => {
  let h = 7
  for (const c of issue.title + issue.description + issue.ac.join('|') + feedback) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return `${CACHE_PREFIX}${issue.id}:${h}`
}

export function getCachedAi(issue: AiIssue, feedback?: string): AiResult | null {
  try {
    const raw = localStorage.getItem(cacheKey(issue, feedback))
    return raw ? { ...(JSON.parse(raw) as AiResult), cached: true } : null
  } catch {
    return null
  }
}

export function clearAiCache() {
  try {
    Object.keys(localStorage).filter(k => k.startsWith(CACHE_PREFIX)).forEach(k => localStorage.removeItem(k))
  } catch {
    /* 저장소를 못 쓰면 무시 */
  }
}

export async function runLiveAi(
  issue: AiIssue,
  facts: AiFacts,
  onStatus?: (s: AiStatus) => void,
  feedback?: string,
): Promise<AiResult | AiFailure> {
  const hit = getCachedAi(issue, feedback)
  if (hit) return hit

  const body = {
    model: MODEL,
    reasoning_effort: 'low',
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: buildPrompt(issue, facts, feedback) },
    ],
  }
  try {
    await waitTurn(onStatus)
    const t0 = Date.now()
    onStatus?.({ phase: 'calling' })
    markStart()
    let r = await post(body)
    if (r.status === 402 || r.status === 429) {
      // 무료 한도(접속자당 30초 1회) — 안내된 시간만큼 기다렸다가 1번 더 시도
      const wait = Math.min(Number(r.text.match(/wait (\d+) second/i)?.[1] ?? 30) + 1, 35)
      for (let s = wait; s > 0; s--) {
        onStatus?.({ phase: 'waiting', seconds: s })
        await sleep(1000)
      }
      onStatus?.({ phase: 'calling' })
      markStart()
      r = await post(body)
    }
    if (r.status !== 200) return { ok: false, reason: `AI 서버 응답 ${r.status}` }

    const content: string = JSON.parse(r.text)?.choices?.[0]?.message?.content ?? ''
    const j = parseJson(content)

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
    if (!requirements.length || !risk || !summary)
      return { ok: false, reason: 'AI 응답 형식 오류 (필수 항목 누락)', raw: content }
    const evidence = (Array.isArray(j.evidence) ? j.evidence : []).map(String).filter(Boolean).slice(0, 3)

    const numbers = checkNumbers(issue, facts, summary)
    const result: AiResult = {
      ok: true,
      model: MODEL_LABEL,
      elapsedMs: Date.now() - t0,
      createdAt: new Date().toISOString(),
      cached: false,
      requirements,
      risk,
      riskReason: String(j.risk_reason ?? '').trim(),
      evidence,
      summary: numbers.pass ? summary : templateSummary(issue, facts),
      aiSummary: summary,
      summaryFromAi: numbers.pass,
      checks: {
        coverage: checkCoverage(issue, requirements),
        evidence: checkEvidence(issue, evidence),
        numbers,
      },
      raw: content,
    }
    try {
      localStorage.setItem(cacheKey(issue, feedback), JSON.stringify(result))
    } catch {
      /* 저장 실패는 무시 */
    }
    return result
  } catch (e) {
    const msg = e instanceof Error ? (e.name === 'AbortError' ? '30초 안에 응답 없음' : e.message) : String(e)
    return { ok: false, reason: msg }
  }
}

/** 위험 등급 비교: AI 판정 vs 규칙(계약 파일) 판정. 흐름은 규칙 판정을 따른다. */
export function compareRisk(ai: Risk, rule: Risk) {
  const rank = { 낮음: 0, 보통: 1, 높음: 2 }
  if (rank[ai] === rank[rule]) return { tone: 'green' as const, text: '규칙 판정과 일치' }
  if (rank[ai] < rank[rule]) return { tone: 'orange' as const, text: `AI 판정 ${ai} → 규칙 하한 ${rule} 적용` }
  return { tone: 'orange' as const, text: `AI가 더 높게 판단(${ai}) → PL 참고로 기록` }
}
