// bootstrap.ts — Render 冷启动时幂等重建 SQLite（本地也可手动跑：npx tsx scripts/bootstrap.ts）
// 免费实例磁盘是临时的：每次启动（睡眠唤醒/重启/重新部署）磁盘都是空库，需自动重建
// 步骤：prisma db push 建表 → 词库为空则按本地同款顺序导入全部词书 → 从环境变量建管理员
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, '..'); // server/（导入脚本都假设 cwd=server，路径 ../data）

// 直接用 node 调 CLI 入口（Windows 上 spawn npx.cmd 会 EINVAL；tsx/prisma 均在 exports 中暴露入口）
const TSX_CLI = require.resolve('tsx/cli');
const PRISMA_CLI = require.resolve('prisma/build/index.js');

function run(cli: string, label: string, args: string[]) {
  console.log(`▶ ${label} ${args.join(' ')}`);
  const r = spawnSync(process.execPath, [cli, ...args], { cwd: SERVER_DIR, stdio: 'inherit' });
  if (r.status !== 0) {
    console.error(`❌ 失败(退出码 ${r.status}): ${label} ${args.join(' ')}`);
    process.exit(r.status ?? 1);
  }
}

async function main() {
  // 1. 建表（幂等；--skip-generate 省时间，Prisma Client 在 npm install 时已生成）
  run(PRISMA_CLI, 'prisma', ['db', 'push', '--skip-generate']);

  const prisma = new PrismaClient();
  // 2. 词库为空才重建（本地/持久磁盘场景词库已存在 → 秒过）
  const wordCount = await prisma.word.count();
  if (wordCount === 0) {
    console.log('📦 词库为空，开始重建（约 3~8 分钟）…');
    run(TSX_CLI, 'tsx', ['scripts/import-words.ts']); // 延世1~6 + TOPIK（建 9 本书）
    run(TSX_CLI, 'tsx', ['scripts/import-pdf-books.ts']); // PDF 书词表 + 文本例句
    run(TSX_CLI, 'tsx', ['scripts/import-custom-topik.ts']); // 以 parsed.json 重建 TOPIK 三本（要求 TOPIK 书已存在）
    run(TSX_CLI, 'tsx', ['scripts/import-mappings.ts']); // 歌词/综艺映射（含 /media/clips/ 音频路径）
  } else {
    console.log(`✅ 词库已存在（${wordCount} 词），跳过导入`);
  }

  // 3. 从环境变量创建管理员（幂等：存在则设管理员并重置密码）
  if (process.env.ADMIN_USERNAME && process.env.ADMIN_PASSWORD) {
    run(TSX_CLI, 'tsx', ['scripts/create-admin.ts', process.env.ADMIN_USERNAME, process.env.ADMIN_PASSWORD]);
  } else {
    console.log('⚠️ 未设置 ADMIN_USERNAME/ADMIN_PASSWORD，跳过管理员创建');
  }
  await prisma.$disconnect();
  console.log('✅ bootstrap 完成');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
