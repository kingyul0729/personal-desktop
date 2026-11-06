// 큰 금액을 '만' 단위로 읽어 주는 표기: 1,028,500원 → 102만 8,500원, 3,000,000원 → 300만원.
// 일·십·백·천을 세지 않아도 바로 읽히도록 숫자 옆에 작게 붙인다.
export function readWon(won: number): string {
  const value = Number.isFinite(won) ? Math.max(0, Math.round(won)) : 0;
  if (value < 10000) return `${value.toLocaleString('ko-KR')}원`;
  const eok = Math.floor(value / 1e8), man = Math.floor((value % 1e8) / 1e4), rest = value % 1e4;
  const parts = [eok ? `${eok.toLocaleString('ko-KR')}억` : '', man ? `${man.toLocaleString('ko-KR')}만` : '', rest ? rest.toLocaleString('ko-KR') : ''].filter(Boolean);
  return rest ? `${parts.join(' ')}원` : `${parts.join(' ')}원`;
}
