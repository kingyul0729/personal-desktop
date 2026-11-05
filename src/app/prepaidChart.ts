import { formatWonAmount, type PrepaidResult } from './prepaid.ts';

// 차트 입력용 문구. 계산 결과(PrepaidResult) 하나만 보고 만들어서 화면 금액과 항상 같다.
//   300만원권
//   차감 ○○원 · 추가 수납 ○○원 (카드)
//   남은잔액 ○○원            ← 잔액 0원이면 「잔액 0원 · 사용완료」
export type ChartPaymentMethod = '' | 'card' | 'cash' | 'transfer' | 'mixed';
export type ChartTone = 'red' | 'black' | 'blue';
export interface ChartPart { text: string; tone: ChartTone }
export const chartColors: Record<ChartTone, string> = { red: '#c52222', black: '#111111', blue: '#2168ce' };
export const chartPaymentLabels: Record<Exclude<ChartPaymentMethod, ''>, string> = { card: '카드', cash: '현금', transfer: '계좌이체', mixed: '복합' };
export interface ChartContext {
  subject: string;
  program: string;
  familyShared: boolean;
  owner: string;
}
export const emptyChartContext: ChartContext = { subject: '', program: '', familyShared: false, owner: '' };

export function createPrepaidChart(result: PrepaidResult, method: ChartPaymentMethod, context: ChartContext = emptyChartContext) {
  if (!result.ready) return null;
  const won = formatWonAmount;
  const pay = method ? ` (${chartPaymentLabels[method]})` : '';
  const lines: ChartPart[][] = [[{ text: `${result.tier}만원권`, tone: 'red' }]];

  const subject = context.subject.trim(), program = context.program.trim(), owner = context.owner.trim();
  if (context.familyShared && owner) lines.push([{ text: `선불권 보유자: ${owner}`, tone: 'black' }]);
  const description = [subject, program].filter(Boolean).join(' ');
  if (description) lines.push([{ text: description, tone: 'black' }]);

  // 차감은 선불권에서 실제로 쓴 금액, 추가 수납은 오늘 실제로 받은 금액만.
  const parts = [`차감 ${won(result.deducted)}`];
  if (result.deposit > 0) parts.push(`예약금 ${won(result.deposit)}`);
  if (result.collected > 0) parts.push(`추가 수납 ${won(result.collected)}${pay}`);
  lines.push([{ text: parts.join(' · '), tone: 'black' }]);

  if (result.receivable > 0) lines.push([{ text: `미수금 ${won(result.receivable)}`, tone: 'red' }]);
  if (result.shortfall > 0) lines.push([{ text: `시술비 부족분 ${won(result.shortfall)}`, tone: 'red' }]);
  if (result.overpaid > 0) lines.push([{ text: `초과 수납 ${won(result.overpaid)}`, tone: 'blue' }]);

  if (result.remaining > 0) lines.push([{ text: `남은잔액 ${won(result.remaining)}`, tone: 'blue' }]);
  else lines.push([{ text: result.isUsageComplete ? '잔액 0원 · 사용완료' : '잔액 0원', tone: 'red' }]);

  const needsPaymentMethod = result.collected > 0;
  const familyReady = !context.familyShared || (!!subject && !!owner);
  return { lines, needsPaymentMethod, familyReady, canCopy: (!needsPaymentMethod || !!method) && familyReady };
}

export function chartClipboardContent(lines: ChartPart[][]) {
  const escape = (text: string) => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
  return {
    text: lines.map(line => line.map(part => part.text).join('')).join('\n'),
    html: `<div>${lines.map(line => `<div>${line.map(part => `<span style="color:${chartColors[part.tone]}">${escape(part.text)}</span>`).join('')}</div>`).join('')}</div>`,
  };
}

export async function copyChartContent(content: { text: string; html: string }): Promise<'rich' | 'plain' | false> {
  // Both formats are written in the click gesture so supporting chart editors
  // receive colors and plain-text editors receive exactly the same wording.
  try {
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
      await navigator.clipboard.write([new ClipboardItem({
        'text/plain': new Blob([content.text], { type: 'text/plain' }),
        'text/html': new Blob([content.html], { type: 'text/html' }),
      })]);
      return 'rich';
    }
  } catch { /* Some browsers permit plain text only. */ }
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(content.text);
      return 'plain';
    }
  } catch { /* Older browsers use the selected text fallback below. */ }
  const focused = document.activeElement as HTMLElement | null;
  const textarea = document.createElement('textarea');
  textarea.value = content.text;
  textarea.readOnly = true;
  textarea.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;';
  (document.querySelector('dialog[open]') ?? document.body).appendChild(textarea);
  try {
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, content.text.length);
    return document.execCommand('copy') ? 'plain' : false;
  } finally {
    textarea.remove();
    focused?.focus({ preventScroll: true });
  }
}
