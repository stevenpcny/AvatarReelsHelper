/**
 * Client-side copy audit (质检) — ported 1:1 from the former server.py logic.
 * No backend/Vertex call: the caller supplies a `callModel(prompt)` function
 * that hits Gemini or OpenRouter directly with the user's own API key.
 */

export interface CopySegment {
  id: string;
  chinese: string;
  english: string;
}

export interface AuditResult {
  id: string;
  chinese: string;
  originalEnglish: string;
  markupEnglish: string;
  correctedEnglish: string;
  qcEnglishHasChinese: boolean;
}

const CHINESE_CHAR = '一-龥　-〿＀-￯';
const TSV_ROW_START = /^(\d+)\t/gm;
const SEG_RE = new RegExp(
  '(^|[\\n\\s.!?"\'“”])(\\d{1,3}[.\\s\\t]+)(?=["\'“‘\\s]*[' + CHINESE_CHAR + '])',
  'g'
);
const ID_PREFIX = /^(\d+[.\s\t]+)/;
const TRAILING_PUNCT = /^[\s“”"‘’')\]}>]+/;
const CHINESE_TEST = new RegExp('[' + CHINESE_CHAR + ']');

export function hasChinese(s: string): boolean {
  return CHINESE_TEST.test(s || '');
}

function stripQuotes(s: string): string {
  return s.replace(/^[\s“"]+|[\s”"]+$/g, '').trim();
}

function collapseWs(s: string): string {
  return s.replace(/\s*\n\s*/g, ' ').trim();
}

export function stripLeadingId(text: string, segId = ''): string {
  if (!text) return '';
  text = text.trim();
  if (segId) {
    const m = text.match(/^\[?(\d+)\]?[.\s\t]+/);
    if (m && m[1] === String(segId)) return text.slice(m[0].length).trim();
    return text;
  }
  const m = text.match(ID_PREFIX);
  return m ? text.slice(m[0].length).trim() : text;
}

export function parseCopy(text: string): CopySegment[] {
  const segments: CopySegment[] = [];

  if (/^\d+\t/m.test(text)) {
    // TSV format
    const starts = [...text.matchAll(TSV_ROW_START)];
    starts.forEach((m, i) => {
      const start = m.index!;
      const end = i + 1 < starts.length ? starts[i + 1].index! : text.length;
      const row = text.slice(start, end);
      const segId = m[1];
      const withoutId = row.slice(segId.length + 1);
      const tabIdx = withoutId.indexOf('\t');
      let chinese = '';
      let english = '';
      if (tabIdx !== -1) {
        chinese = stripQuotes(withoutId.slice(0, tabIdx));
        english = collapseWs(stripQuotes(withoutId.slice(tabIdx + 1)));
      } else if (CHINESE_TEST.test(withoutId)) {
        chinese = stripQuotes(withoutId);
      } else {
        english = collapseWs(stripQuotes(withoutId));
      }
      segments.push({ id: segId, chinese, english });
    });
  } else {
    // Inline format
    const matches = [...text.matchAll(SEG_RE)];
    const rawSegs: string[] = [];
    if (matches.length === 0) {
      rawSegs.push(text);
    } else {
      matches.forEach((m, i) => {
        const start = m.index! + m[1].length;
        const end = i + 1 < matches.length ? matches[i + 1].index! + matches[i + 1][1].length : text.length;
        rawSegs.push(text.slice(start, end).trim());
      });
    }

    for (const seg of rawSegs) {
      const idMatch = seg.match(ID_PREFIX);
      const idStr = idMatch ? idMatch[1] : '';
      const rest = seg.slice(idStr.length);
      let lastCn = -1;
      for (let i = 0; i < rest.length; i++) {
        if (CHINESE_TEST.test(rest[i])) lastCn = i;
      }
      if (lastCn !== -1) {
        const tail = rest.slice(lastCn + 1).match(TRAILING_PUNCT);
        if (tail) lastCn += tail[0].length;
      }
      const chinese = lastCn !== -1 ? rest.slice(0, lastCn + 1).trim() : '';
      const english = collapseWs(lastCn !== -1 ? rest.slice(lastCn + 1) : rest);
      const segId = idStr ? idStr.replace(/[.\s\t]+$/, '') : '1';
      segments.push({ id: segId, chinese, english });
    }
  }

  // Dedupe by id (keep first).
  const seen = new Set<string>();
  const unique: CopySegment[] = [];
  for (const s of segments) {
    if (!seen.has(s.id)) {
      seen.add(s.id);
      unique.push(s);
    }
  }
  return unique;
}

export const AUDIT_PROMPT = `你是一个专业的文案质检员。以下文案为基督教口播视频用途，包含神学术语和敬拜语言，请以此为背景进行质检。请对以下英文文案进行"AI 文案质检"。

待处理英文文案（每段以 [id] 形式给出段落标识）：
__BATCH__

质检要求：
__INSTR__

特别注意：
1. 每段开头的 [id] 只是段落标识，输出时不要包含它（例如输入 "[1] Hello"，输出 "Hello"）。
2. 仅对英文部分进行纠错。
3. 绝对不要纠正介词搭配。
4. 绝对不要进行风格润色或改写。
5. 正文中出现的所有数字一律原样保留，禁止删除或改动；尤其是 "1. ... 2. ... 3. ..." 这类内嵌的编号清单，它们是正文内容而非段落序号，必须完整保留。
6. 返回结果中包含：
   - id: 段落标识（即 [id] 中的数字）
   - originalEnglish: 原始英文部分（不含 [id]）
   - markupEnglish: 带有修改标记的英文（使用 ~~删除~~ 和 **新增** 标记差异，不含 [id]）
   - correctedEnglish: 修正后的纯净英文（不含 [id]）
7. 关于 markupEnglish 的关键规则：只标记【实际发生了改变】的词。如果原文某个词已经是正确的（例如 He、His、Your 已经大写），则不要用任何标记包裹它，直接原样输出。markupEnglish 中有标记的部分必须与 originalEnglish 和 correctedEnglish 之间的实际差异完全对应。

请以 JSON 数组格式返回结果。
示例格式：[{"id": "1", "originalEnglish": "...", "markupEnglish": "...", "correctedEnglish": "..."}]`;

export function parseAuditJson(text: string): any[] {
  let clean = text.replace(/^```json\n?/, '').replace(/```\s*$/, '').trim();
  const start = clean.indexOf('[');
  const end = clean.lastIndexOf(']');
  if (start !== -1 && end !== -1) clean = clean.slice(start, end + 1);
  return JSON.parse(clean);
}

const BATCH_SIZE = 15;

/**
 * Runs the full audit: parses `copy` into segments, batches them, and calls
 * `callModel(prompt)` (engine-specific — Gemini or OpenRouter, injected by the
 * caller) for each batch. `callModel` must return the raw JSON-array text.
 */
export async function runCopyAudit(
  copy: string,
  options: string[],
  instructions: Record<string, string>,
  callModel: (prompt: string) => Promise<string>,
  onProgress?: (batch: number, totalBatches: number) => void
): Promise<AuditResult[]> {
  const activeInstructions = options
    .map((oid) => `- ${oid === 'custom' ? '自定义指令' : oid}: ${instructions[oid] || ''}`)
    .join('\n');

  const segments = parseCopy(copy);
  const results: AuditResult[] = [];
  const totalBatches = Math.ceil(segments.length / BATCH_SIZE);

  for (let i = 0; i < segments.length; i += BATCH_SIZE) {
    const batch = segments.slice(i, i + BATCH_SIZE);
    const auditable = batch.filter((s) => s.english.trim());
    if (auditable.length === 0) continue;

    onProgress?.(Math.floor(i / BATCH_SIZE) + 1, totalBatches);

    const batchText = auditable.map((s) => `[${s.id}] ${s.english}`).join('\n\n');
    const prompt = AUDIT_PROMPT.replace('__BATCH__', batchText).replace('__INSTR__', activeInstructions);

    const text = await callModel(prompt);
    if (!text) throw new Error('AI 返回了空响应。');

    const byId = new Map(auditable.map((s) => [s.id, s]));
    const seenIds = new Set(results.map((r) => r.id));
    for (const res of parseAuditJson(text)) {
      const id = String(res.id);
      if (seenIds.has(id)) continue;
      const local = byId.get(id) || auditable[0];
      const corrected = stripLeadingId(res.correctedEnglish || '', id);
      results.push({
        id,
        chinese: local.chinese,
        originalEnglish: stripLeadingId(res.originalEnglish || '', id),
        markupEnglish: stripLeadingId(res.markupEnglish || '', id),
        correctedEnglish: corrected,
        qcEnglishHasChinese: hasChinese(corrected),
      });
      seenIds.add(id);
    }
  }

  return results;
}
