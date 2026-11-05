// drizzle/*.sql → cloudflare/migrations.js (Workers 번들에 SQL을 넣기 위한 변환). 빌드 때마다 실행.
import { readdir, readFile, writeFile } from 'node:fs/promises';
const dir = new URL('../drizzle/', import.meta.url);
const files = (await readdir(dir)).filter(f => /^\d{4}_.*\.sql$/.test(f)).sort();
const list = [];
for (const f of files) {
  const sql = await readFile(new URL(f, dir), 'utf8');
  list.push({ name: f.replace(/\.sql$/, ''), statements: sql.split('--> statement-breakpoint').map(s => s.trim()).filter(Boolean) });
}
await writeFile(new URL('./migrations.js', import.meta.url), '// 자동 생성 파일 (cloudflare/gen-migrations.mjs). 직접 고치지 마세요.\nexport default ' + JSON.stringify(list, null, 1) + ';\n');
console.log('migrations:', list.length);
