import { formatPrepaidAmount, type PrepaidResult } from './prepaid.ts';

export type ChartPaymentMethod = '' | 'card' | 'cash' | 'transfer' | 'mixed';
export type ChartTone = 'red' | 'black' | 'blue';
export interface ChartPart { text: string; tone: ChartTone }
export const chartColors: Record<ChartTone, string> = { red: '#c52222', black: '#111111', blue: '#2168ce' };
export const chartPaymentLabels = { card: '카 ok', cash: '현금 ok', transfer: '계좌 ok', mixed: '복합 ok' };
export interface ChartContext {
  subject: string;
  program: string;
  familyShared: boolean;
  owner: string;
}
export const emptyChartContext: ChartContext = { subject: '', program: '', familyShared: false, owner: '' };

export function createPrepaidChart(result: PrepaidResult, method: ChartPaymentMethod, context: ChartContext = emptyChartContext) {
  if (!result.ready || result.collected === null || result.receivable === null) return null;
  // Only format the exact result object shared with the inputs and result card.
  const amount = formatPrepaidAmount;
  const paymentLabel = method ? ` ${chartPaymentLabels[method]}` : '';
  const settled = result.receivable === 0;
  const lines: ChartPart[][] = [[{ text: `${amount(result.basisAmount)}선불권`, tone: 'red' }]];
  // An unpaid difference is not an additional receipt. Only use that wording
  // after the full amount is settled, using the shared calculation's excess.
  if (result.excess > 0 && result.collected > 0 && settled) {
    lines[0].push({ text: ` 적용후 차액 ${amount(result.excess)}p 추가수납`, tone: 'black' });
  }
  const simplePayment = !result.hasDeposit && !result.isExisting && settled
    && result.collected === result.applied;
  lines.push([{ text: `${amount(result.normal)}p→${amount(result.applied)}p${simplePayment ? paymentLabel : ''}`, tone: 'black' }]);
  const subject = context.subject.trim();
  const program = context.program.trim();
  if (context.familyShared && context.owner.trim()) {
    lines.push([{ text: `선불권 보유자: ${context.owner.trim()}`, tone: 'black' }]);
  }
  const description = [subject, program].filter(Boolean).join(' ');
  if (result.isExisting || description) {
    const deduction = settled ? `선불권에서 ${amount(result.used)}p 차감` : '';
    const note = [description, deduction].filter(Boolean).join(', ');
    if (note) lines.push([{ text: note, tone: 'black' }]);
  }
  if (result.deposit > 0) {
    lines.push([{ text: `예약금 ${amount(result.deposit)}P${result.collected === 0 ? paymentLabel : ''}`, tone: 'black' }]);
  }
  if (result.collected > 0 && !simplePayment) {
    lines.push([{ text: `당일수납 ${amount(result.collected)}P${paymentLabel}`, tone: 'black' }]);
  }
  if (result.showReceivable) {
    lines.push([{ text: `미수금 ${amount(result.receivable)}P`, tone: 'red' }]);
  }
  if (result.remaining !== null && result.remaining > 0) {
    lines.push([{ text: `남은 차액: ${amount(result.remaining)}P`, tone: 'blue' }]);
  } else if (result.isUsageComplete) {
    lines.push([{ text: '선불권제 사용완료', tone: 'red' }]);
  }
  const needsPaymentMethod = result.collected > 0 || result.deposit > 0;
  const familyReady = !context.familyShared || (!!subject && !!context.owner.trim());
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
