# gen_word_audio.py — 用 edge-tts 为全词表生成"单词独立发音" mp3（可断点续跑）
# 运行：在 scripts/pipeline 目录执行 .venv\Scripts\python gen_word_audio.py
# 输出：media/word-audio/<hangul>.mp3 + data/word-audio-manifest.json（hangul → 站内相对路径）
import asyncio
import json
import os
import re
import sqlite3
import sys

import edge_tts

# Windows 控制台默认 GBK，打 emoji/韩文会崩；统一按 UTF-8 输出
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.stderr.reconfigure(encoding='utf-8', errors='replace')

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # 项目根
DB = os.path.join(ROOT, 'server', 'prisma', 'dev.db')
OUT_DIR = os.path.join(ROOT, 'media', 'word-audio')
MANIFEST = os.path.join(ROOT, 'data', 'word-audio-manifest.json')
VOICE = 'ko-KR-SunHiNeural'
CONCURRENCY = 8  # 并发数（微软端点单条 ~0.5s，8 并发 ≈ 每分钟 500~800 词）


def safe_name(hangul: str) -> str:
    # 只保留韩文/字母/数字/下划线/连字符，其余替换为 _（文件名安全）
    s = re.sub(r'[^가-힣0-9a-zA-Z_-]', '_', hangul)
    return s or 'word'


def load_words():
    conn = sqlite3.connect(DB)
    rows = conn.execute('SELECT hangul FROM Word').fetchall()
    conn.close()
    return sorted({r[0] for r in rows if r[0]})


def save_manifest(ok_words):
    manifest = {
        h: f'/media/word-audio/{safe_name(h)}.mp3'
        for h in ok_words
    }
    with open(MANIFEST, 'w', encoding='utf-8') as f:
        json.dump(manifest, f, ensure_ascii=False, indent=1)
    print(f'📄 manifest 已写入 {MANIFEST}（{len(manifest)} 词）')


async def gen_one(hangul, sem, stats):
    path = os.path.join(OUT_DIR, safe_name(hangul) + '.mp3')
    if os.path.exists(path) and os.path.getsize(path) > 500:
        return  # 已有文件，跳过（断点续跑）
    async with sem:
        for attempt in range(3):
            try:
                tts = edge_tts.Communicate(hangul, VOICE)
                await tts.save(path)
                stats['ok'] += 1
                return
            except Exception as e:
                if attempt == 2:
                    stats['fail'].append((hangul, str(e)))
                else:
                    await asyncio.sleep(1 + attempt)
    if stats['ok'] % 200 == 0 and stats['ok'] > 0:
        print(f'… 已完成 {stats["ok"]} 词')


async def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    words = load_words()
    print(f'📚 词表共 {len(words)} 词，开始生成（并发 {CONCURRENCY}）…')
    sem = asyncio.Semaphore(CONCURRENCY)
    stats = {'ok': 0, 'fail': []}
    await asyncio.gather(*(gen_one(w, sem, stats) for w in words))
    ok_words = [
        w for w in words
        if os.path.exists(os.path.join(OUT_DIR, safe_name(w) + '.mp3'))
        and os.path.getsize(os.path.join(OUT_DIR, safe_name(w) + '.mp3')) > 500
    ]
    save_manifest(ok_words)
    print(f'✅ 完成：成功 {len(ok_words)} 词，失败 {len(stats["fail"])} 词')
    if stats['fail']:
        print('失败样例：', stats['fail'][:10])
        sys.exit(1)


if __name__ == '__main__':
    asyncio.run(main())
