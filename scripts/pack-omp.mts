// oh-my-pi판 배포 패키지(omp-agent-office)를 만든다: omp/·core/·타입 파일만 담고, Claude Code 쪽 파일은 넣지 않는다.
// 타입 파일에서는 Claude Code의 상태 계약(declare module 'claude-code')을 걷어 낸다.
// 쓰는 법: node scripts/pack-omp.mts [--pack]   (--pack이면 dist/에 .tgz까지 만든다: npm publish --registry <사내 레지스트리>로 올린다)
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'dist', 'omp-agent-office')
const meta = JSON.parse(readFileSync(join(root, 'omp', 'package.json'), 'utf8')) as { version: string }

rmSync(out, { recursive: true, force: true })
mkdirSync(join(out, 'types'), { recursive: true })
for (const dir of ['omp', 'core']) {
  cpSync(join(root, dir), join(out, dir), { recursive: true, filter: src => !src.endsWith('.test.ts') && !src.endsWith('.test.tsx') && !src.endsWith('package.json') && !src.endsWith('README.md') && !src.endsWith('tsconfig.json') })
}

// 데이터 타입만 남긴다(Claude Code의 상태 계약 블록은 뺀다)
const types = readFileSync(join(root, 'types', 'index.d.ts'), 'utf8')
const cut = types.indexOf("declare module 'claude-code'")
if (cut < 0) throw new Error("types/index.d.ts에서 declare module 'claude-code' 블록을 찾지 못했습니다")
// 블록 끝: 여는 중괄호부터 짝이 맞는 닫는 중괄호까지 센다(들여쓰기나 위치에 기대지 않는다)
const open = types.indexOf('{', cut)
let depth = 0
let end = -1
for (let i = open; i < types.length; i++) {
  if (types[i] === '{') depth++
  else if (types[i] === '}' && --depth === 0) {
    end = i + 1
    break
  }
}
if (open < 0 || end <= cut) throw new Error("declare module 'claude-code' 블록의 끝을 찾지 못했습니다")
const stripped = `${types.slice(0, cut)}${types.slice(end)}`.replace(/\n{3,}/g, '\n\n')
if (stripped.includes('claude-code')) throw new Error('배포본 타입 파일에 claude-code가 남았습니다')
writeFileSync(join(out, 'types', 'index.d.ts'), stripped)

writeFileSync(join(out, 'package.json'), `${JSON.stringify({
  name: 'omp-agent-office',
  version: meta.version,
  description: 'oh-my-pi 확장: 서브에이전트를 부서 직원으로 받아 평가·결재·인사 기록·토큰 비용·사무실 평면도를 보인다',
  type: 'module',
  license: 'MIT',
  omp: { extensions: ['./omp/index.ts'] },
  files: ['omp', 'core', 'types', 'README.md'],
  peerDependencies: { '@oh-my-pi/pi-coding-agent': '>=18', '@oh-my-pi/pi-ai': '>=18', '@oh-my-pi/pi-tui': '>=18' },
  peerDependenciesMeta: { '@oh-my-pi/pi-tui': { optional: true } },
}, null, 2)}\n`)
cpSync(join(root, 'omp', 'README.md'), join(out, 'README.md'))

if (process.argv.includes('--pack')) {
  execFileSync('npm', ['pack', '--pack-destination', join(root, 'dist')], { cwd: out, stdio: 'inherit' })
}
console.log(`만들었습니다: ${out}`)
