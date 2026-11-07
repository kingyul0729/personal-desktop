// scripts/inv-data/old-app-data.json(직원 근태 등 개인 자료)을 암호화해 public/old-data.enc 로 만든다.
// 저장소가 공개라서 원본은 올리지 않고, 사용자가 재고체크 '예전 앱 자료 넣기'에서 코드를 입력하면 브라우저에서 풀어 넣는다.
// 실행: OLD_DATA_CODE=XXXX-XXXX-XXXX-XXXX node scripts/encrypt-old-data.mjs   (코드는 저장소에 적지 않는다)
import { readFileSync, writeFileSync } from 'node:fs';
import { webcrypto as crypto } from 'node:crypto';

const code = (process.env.OLD_DATA_CODE || '').trim().toUpperCase();
if (code.length < 16) throw new Error('OLD_DATA_CODE가 필요해요');
const plain = readFileSync(new URL('./inv-data/old-app-data.json', import.meta.url));
const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12)), iter = 600000;
const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(code), 'PBKDF2', false, ['deriveKey']);
const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain));
const b64 = u => Buffer.from(u).toString('base64');
writeFileSync(new URL('../public/old-data.enc', import.meta.url), JSON.stringify({ v: 1, iter, salt: b64(salt), iv: b64(iv), data: b64(data) }));
console.log('public/old-data.enc', data.length, 'bytes');
