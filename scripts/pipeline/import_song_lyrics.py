# -*- coding: utf-8 -*-
"""
歌曲歌词中文翻译导入 → MediaMapping.quoteZh

把用户提供的双语歌词（韩语+中文）与数据库里的 song 映射 quote 匹配，
把对应中文翻译写回数据库 + media/mappings.json。

支持的输入格式（自动探测）：
  1) JSON 列表: [{"ko": "...", "zh": "..."}] 或 [{"quote": "...", "translation": "..."}]
  2) 韩/中成对文本: 每行一条，韩语行后面紧跟中文行（允许空行/时间轴 [00:12.34] 前缀）
  3) TSV: 韩语<TAB 或 | 或，>中文

用法（在 pipeline 目录）:
  .venv\\Scripts\\python import_song_lyrics.py <歌词文件路径> [--dry-run]

匹配规则：quote 与歌词行互相包含（去标点空格）→ 精确配对；否则模糊匹配
（相似度 ≥ 0.72 且是最高分）→ 弱证据配对，报告里标 ❓ 供人工核对。
"""
import argparse
import json
import re
import sqlite3
import sys
from difflib import SequenceMatcher
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
MEDIA_DIR = PROJECT_ROOT / "media"
DB_PATH = PROJECT_ROOT / "server" / "prisma" / "dev.db"
MAPPINGS_JSON = MEDIA_DIR / "mappings.json"

HANGUL_RE = re.compile(r"[가-힣]")
CJK_RE = re.compile(r"[一-鿿]")


def norm(s: str) -> str:
    """去时间轴、标点、空格、重复标记，仅保留韩文/中文/数字字母"""
    s = re.sub(r"^\[[^\]]*\]", "", s.strip())  # 时间轴前缀
    s = re.sub(r"[（(]?\s*[×xX]\s*\d+\s*[)）]?", "", s)  # (×2) 重复标记
    return re.sub(r"[^\w가-힣一-鿿]", "", s)


def similar(a: str, b: str) -> float:
    return SequenceMatcher(None, norm(a), norm(b)).ratio()


def parse_pairs(path: Path) -> list[tuple[str, str]]:
    """把输入文件解析成 (韩语, 中文) 对"""
    raw = path.read_text(encoding="utf-8-sig")
    # 1) JSON
    if raw.lstrip().startswith(("[", "{")):
        try:
            data = json.loads(raw)
            if isinstance(data, dict):
                data = [data]
            pairs = []
            for d in data:
                ko = d.get("ko") or d.get("hangul") or d.get("quote") or d.get("kr")
                zh = d.get("zh") or d.get("translation") or d.get("cn")
                if ko and zh:
                    pairs.append((str(ko), str(zh)))
            if pairs:
                return pairs
        except json.JSONDecodeError:
            pass
    # 2) 逐行：韩语行 + 下一中文行
    lines = [l.strip() for l in raw.splitlines() if l.strip()]
    pairs = []
    i = 0
    while i < len(lines):
        ko = lines[i]
        if not HANGUL_RE.search(ko):
            i += 1
            continue
        zh = lines[i + 1] if i + 1 < len(lines) else ""
        if zh and CJK_RE.search(zh) and not HANGUL_RE.search(zh):
            pairs.append((ko, zh))
            i += 2
        else:
            # 3) 同一行内分隔：韩语<TAB/|/，>中文
            for sep in ("\t", " | ", "｜", "，", ","):
                if sep in ko:
                    a, b = ko.split(sep, 1)
                    if HANGUL_RE.search(a) and CJK_RE.search(b) and not HANGUL_RE.search(b):
                        pairs.append((a.strip(), b.strip()))
                        break
            i += 1
    return pairs


def main():
    parser = argparse.ArgumentParser(description="歌曲歌词翻译导入")
    parser.add_argument("file", help="双语歌词文件路径")
    parser.add_argument("--dry-run", action="store_true", help="只匹配不写库")
    args = parser.parse_args()

    pairs = parse_pairs(Path(args.file))
    print(f"📄 解析出 {len(pairs)} 对 韩/中 歌词")
    if not pairs:
        print("❌ 没解析出歌词对，请检查格式（韩语行+中文行 / JSON / TSV）")
        sys.exit(1)

    conn = sqlite3.connect(DB_PATH, timeout=15)
    conn.execute("PRAGMA busy_timeout=15000")
    rows = conn.execute(
        "SELECT quote FROM MediaMapping WHERE sourceType='song' AND quoteZh IS NULL"
    ).fetchall()
    conn.close()
    quotes = [r[0] for r in rows]
    print(f"📋 待翻译 song 句子（去重后）: {len(quotes)} 句")

    results: list[tuple[str, str]] = []  # (quote, zh)
    report: list[str] = []
    unmatched = [q for q in quotes]
    for ko, zh in pairs:
        if not unmatched:
            break
        nk, nz = norm(ko), norm(zh)
        best_q, best_score, best_mode = None, 0.0, ""
        for q in unmatched:
            nq = norm(q)
            if not nq:
                continue
            if nk in nq or (len(nk) >= 4 and nq in nk):
                best_q, best_score, best_mode = q, 1.0, "✅ 包含"
                break
            s = similar(q, ko)
            if s > best_score:
                best_q, best_score, best_mode = q, s, "❓ 模糊"
        if best_q and best_score >= 0.72:
            results.append((best_q, zh))
            unmatched.remove(best_q)
            report.append(f"{best_mode} | {zh} | {best_q}")
    print(f"🎯 命中 {len(results)} 句，剩余未匹配 {len(unmatched)} 句")
    for q in unmatched:
        report.append(f"❌ 未匹配 | {q}")

    if args.dry_run:
        print("(dry-run，未写库)")
    else:
        conn = sqlite3.connect(DB_PATH, timeout=15)
        conn.execute("PRAGMA busy_timeout=15000")
        for quote, zh in results:
            conn.execute(
                "UPDATE MediaMapping SET quoteZh=? WHERE sourceType='song' AND quoteZh IS NULL AND quote=?",
                (zh, quote),
            )
        conn.commit()
        conn.close()

        data = json.loads(MAPPINGS_JSON.read_text(encoding="utf-8"))
        zh_by_quote = {q: z for q, z in results}
        n = 0
        for m in data:
            if m["sourceType"] == "song" and not m.get("quoteZh") and m["quote"] in zh_by_quote:
                m["quoteZh"] = zh_by_quote[m["quote"]]
                n += 1
        MAPPINGS_JSON.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"💾 数据库 + mappings.json 已更新（{n} 条映射）")

    out = MEDIA_DIR / "song-lyrics-report.txt"
    out.write_text("\n".join(report), encoding="utf-8")
    print(f"📝 报告: {out}")


if __name__ == "__main__":
    main()
