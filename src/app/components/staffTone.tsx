import type React from 'react';

// 직원별 고유 파스텔 색(id로 고정 배정 — 새로고침해도 같은 색). [글자색, 연한 바탕, 테두리]
// 2026-11-08 사용자 '너무 쨍해' → 채도를 낮춘 차분한 톤.
export const STAFF_TONES: [string, string, string][] = [
  ['#5e7a66', '#eef3ef', '#c6d7cb'], // 세이지
  ['#6c6690', '#f1f0f6', '#cfcbe0'], // 라벤더
  ['#966b55', '#f7f0eb', '#e2cbbd'], // 피치
  ['#7f6c3a', '#f8f3e2', '#e0d3aa'], // 버터
  ['#8f6273', '#f6eff1', '#dcc6ce'], // 로즈
  ['#557a76', '#eef4f3', '#c2d8d5'], // 민트그린
];
// 이름 타일·달력 날짜는 채도를 낮추기 전 색 그대로(2026-11-08 사용자 요청). [글자색, 연한 바탕, 테두리]
export const STAFF_TONES_VIVID: [string, string, string][] = [
  ['#4f7f5f', '#e9f3ec', '#9cc9aa'], // 세이지
  ['#6b58b8', '#efecfa', '#b9adeb'], // 라벤더
  ['#b25d38', '#fcefe7', '#f0b393'], // 피치
  ['#8a6a17', '#faf2db', '#e8cc79'], // 버터
  ['#a84a6c', '#fbecf1', '#eaa6bf'], // 로즈
  ['#2f7a73', '#e5f3f1', '#93cbc5'], // 민트그린
];
export const vividOf = (id: number) => STAFF_TONES_VIVID[(id - 1 + STAFF_TONES_VIVID.length) % STAFF_TONES_VIVID.length];
export const toneOf = (id: number) => STAFF_TONES[(id - 1 + STAFF_TONES.length) % STAFF_TONES.length];


// 사람 표시(Fluent 2 아바타처럼): 동그라미 안에 성을 뺀 이름, 직원마다 같은 색.
export function StaffAvatar({ id, name, size = 32 }: { id: number; name: string; size?: number }) {
  const [c, bg] = vividOf(id);
  const short = name.length >= 3 ? name.slice(1) : name;
  return <span className="ui-avatar" aria-hidden="true" style={{ width: size, height: size, fontSize: Math.round(size * 0.36), color: c, background: bg } as React.CSSProperties}>{short}</span>;
}
