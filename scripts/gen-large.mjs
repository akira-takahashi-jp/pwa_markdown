// 5,000 行程度の大きなサンプルを生成する: node scripts/gen-large.mjs
import { writeFileSync } from 'node:fs'

const out = ['# 大きなファイルのサンプル', '']
let n = 0
while (out.length < 5000) {
  n++
  out.push(`## セクション ${n}`, '')
  out.push(`これは段落 ${n} です。**太字**や *斜体*、\`code\`、[リンク](https://example.com) を含みます。`, '')
  out.push('- 項目 A', '- 項目 B', '  - ネスト', '- [ ] タスク', '')
  out.push('| 列 1 | 列 2 | 列 3 |', '| --- | --- | --- |', `| ${n} | ${n * 2} | ${n * 3} |`, '')
  if (n % 10 === 0) out.push('```js', `function f${n}(x) {`, `  return x * ${n}`, '}', '```', '')
  if (n % 25 === 0) out.push('```mermaid', 'flowchart LR', `  A${n} --> B${n} --> C${n}`, '```', '')
  if (n % 15 === 0) out.push(`数式 $x_{${n}} = \\sqrt{${n}}$`, '')
}
writeFileSync(new URL('../samples/large.md', import.meta.url), out.join('\n'))
console.log(`samples/large.md: ${out.length} lines`)
