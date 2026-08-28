# -*- coding: utf-8 -*-
"""
GOING 视频内嵌中文字幕 OCR → MediaMapping.quoteZh

GOING 视频是中文压制版：中文字幕烧录在画面最底部（约 96% 高度），
韩文字幕在其上方（约 89%）。对每条映射的时间窗口抽多帧 → 裁出底部字幕带
（起 91% 高度处）→ RapidOCR 识别中文 → 多帧投票取最稳定的行 →
写回数据库 + media/mappings.json（防止重导映射时丢失翻译）。

用法（在 pipeline 目录）:
  .venv\\Scripts\\python translate_going_ocr.py [--limit N] [--dry-run]
可重复运行：已翻译的 quote 自动跳过。
"""
import argparse
import json
import re
import sqlite3
import subprocess
from difflib import SequenceMatcher
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
MEDIA_DIR = PROJECT_ROOT / "media"
GOING_DIR = MEDIA_DIR / "going"
DB_PATH = PROJECT_ROOT / "server" / "prisma" / "dev.db"
MAPPINGS_JSON = MEDIA_DIR / "mappings.json"
TMP_DIR = MEDIA_DIR / "_ocr_tmp"

FRAMES = 6       # 每个时间窗口抽几帧
CROP_TOP = 0.91  # 只取画面底部 9%（中文字幕带）
SCALE = 1.5      # 字幕带放大倍数（小字更易识别）
MIN_SIM = 0.55   # 两帧 OCR 结果视为同一句的相似度阈值
CJK_RE = re.compile(r"[一-鿿]")

_ocr = None  # 惰性加载（加载模型要几秒）


def get_ocr():
    global _ocr
    if _ocr is None:
        from rapidocr_onnxruntime import RapidOCR
        _ocr = RapidOCR()
    return _ocr


def norm(s: str) -> str:
    return re.sub(r"[\s\W_]+", "", s)


def similar(a: str, b: str) -> float:
    return SequenceMatcher(None, norm(a), norm(b)).ratio()


def extract_frame(video: Path, t: float, out_png: Path) -> bool:
    """抽一帧并裁出底部中文字幕带（放大便于 OCR）"""
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error",
         "-ss", f"{t:.2f}", "-i", str(video),
         "-frames:v", "1",
         "-vf", f"crop=iw:ih*{1 - CROP_TOP:.3f}:0:ih*{CROP_TOP:.3f},"
                f"scale=iw*{SCALE}:ih*{SCALE}",
         "-q:v", "2", str(out_png)],
        check=False,
    )
    return out_png.exists() and out_png.stat().st_size > 500


def ocr_frame(png: Path):
    """识别字幕带，返回 (平均置信度, 拼接文本)；无中文时返回 (0, '')"""
    result, _ = get_ocr()(str(png))
    if not result:
        return 0.0, ""
    lines = []
    for box, text, score in result:
        t = text.strip()
        if score < 0.5 or not t:
            continue
        if len(t) < 2 or len(t) > 48:
            continue
        if not CJK_RE.search(t):  # 只保留含中文的行（韩文字幕/水印噪声过滤）
            continue
        y = sum(p[1] for p in box) / 4
        lines.append((y, t, score))
    if not lines:
        return 0.0, ""
    lines.sort(key=lambda x: x[0])
    return sum(s for _, _, s in lines) / len(lines), " ".join(t for _, t, _ in lines)


def vote(cands: list[tuple[float, str]]) -> tuple[str, bool] | None:
    """多帧 OCR 结果投票：取出现次数最多的句子；返回 (文本, 是否强证据)。
    强证据 = 至少 2 帧一致；弱证据 = 只有单帧命中（可能错位，供人工核对）"""
    groups: list[list[tuple[float, str]]] = []
    for score, text in cands:
        for group in groups:
            if similar(text, group[0][1]) >= MIN_SIM:
                group.append((score, text))
                break
        else:
            groups.append([(score, text)])
    best = max(groups, key=lambda g: (len(g), max(s for s, _ in g)))
    strong = len(best) >= 2
    return max(best, key=lambda x: x[0])[1], strong


def load_todo():
    """读数据库：sourceType=going 且未翻译的 quote → 时间窗口"""
    conn = sqlite3.connect(DB_PATH, timeout=15)
    conn.execute("PRAGMA busy_timeout=15000")
    rows = conn.execute(
        "SELECT quote, sourceName, MIN(startTime), MAX(endTime) FROM MediaMapping "
        "WHERE sourceType='going' AND quoteZh IS NULL "
        "GROUP BY quote, sourceName"
    ).fetchall()
    done_rows = conn.execute(
        "SELECT COUNT(*) FROM MediaMapping WHERE sourceType='going' AND quoteZh IS NOT NULL"
    ).fetchone()[0]
    conn.close()
    todo = []
    for quote, source, s, e in rows:
        todo.append({"quote": quote, "source": source, "start": float(s), "end": float(e)})
    print(f"📋 待翻译 GOING 句子: {len(todo)} 句（已翻译 {done_rows} 条映射）")
    return todo


def update_db_and_json(results: list[tuple[str, str]]):
    """写回数据库（同 quote 的所有映射行）+ 更新 mappings.json"""
    conn = sqlite3.connect(DB_PATH, timeout=15)
    conn.execute("PRAGMA busy_timeout=15000")
    for quote, zh in results:
        conn.execute(
            "UPDATE MediaMapping SET quoteZh=? WHERE sourceType='going' AND quoteZh IS NULL AND quote=?",
            (zh, quote),
        )
    conn.commit()
    conn.close()

    data = json.loads(MAPPINGS_JSON.read_text(encoding="utf-8"))
    zh_by_quote = {q: z for q, z in results}
    n = 0
    for m in data:
        if m["sourceType"] == "going" and not m.get("quoteZh") and m["quote"] in zh_by_quote:
            m["quoteZh"] = zh_by_quote[m["quote"]]
            n += 1
    MAPPINGS_JSON.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"💾 数据库 + mappings.json 已更新（{n} 条映射）")


def main():
    parser = argparse.ArgumentParser(description="GOING 内嵌中文字幕 OCR → quoteZh")
    parser.add_argument("--limit", type=int, default=0, help="只处理前 N 句（测试用）")
    parser.add_argument("--dry-run", action="store_true", help="只识别不写库")
    args = parser.parse_args()

    TMP_DIR.mkdir(parents=True, exist_ok=True)
    todo = load_todo()
    if args.limit:
        todo = todo[: args.limit]
        print(f"⚠️ 仅处理前 {args.limit} 句")

    videos: dict[str, Path] = {}
    for source in {x["source"] for x in todo}:
        v = GOING_DIR / f"{source}.mp4"
        if v.exists():
            videos[source] = v
        else:
            print(f"⚠️ 找不到视频 {source}.mp4，跳过其句子")

    frame_cache: dict[tuple[str, int], str | None] = {}  # (视频, 0.5s粒度时间) → OCR 文本
    results: list[tuple[str, str]] = []
    report: list[str] = []
    done = 0

    for i, item in enumerate(todo):
        src = item["source"]
        video = videos.get(src)
        if video is None:
            report.append(f"⏭️ 无视频 | {src} | {item['quote']}")
            continue

        s = max(0.0, item["start"] - 0.5)
        e = item["end"] + 0.8
        cands: list[tuple[float, str]] = []
        for k in range(FRAMES):
            t = s + (e - s) * (k + 0.5) / FRAMES
            key = (src, round(t * 2) // 1)
            if key not in frame_cache:
                png = TMP_DIR / f"f_{key[0][:12]}_{key[1]}.png".replace(" ", "_")
                if not extract_frame(video, t, png):
                    frame_cache[key] = None
                    continue
                score, text = ocr_frame(png)
                frame_cache[key] = text if text else None
            text = frame_cache[key]
            if text:
                # 帧缓存里只存了文本，置信度按 0.7 近似（投票主要看出现次数）
                cands.append((0.7, text))

        hit = vote(cands) if cands else None
        if hit:
            zh, strong = hit
            results.append((item["quote"], zh))
            mark = "✅" if strong else "❓"
            report.append(f"{mark} {zh} | {item['quote']} | {src} {item['start']:.0f}-{item['end']:.0f}s")
        else:
            report.append(f"❌ 未识别 | {item['quote']} | {src} {item['start']:.0f}-{item['end']:.0f}s")

        done += 1
        if done % 20 == 0 or done == len(todo):
            print(f"⏳ {done}/{len(todo)}  命中 {len(results)}")

        if done % 50 == 0 and results and not args.dry_run:
            update_db_and_json(results)
            results = []

    if results and not args.dry_run:
        update_db_and_json(results)

    (MEDIA_DIR / "ocr-report.txt").write_text("\n".join(report), encoding="utf-8")
    strong = sum(1 for r in report if r.startswith("✅"))
    weak = sum(1 for r in report if r.startswith("❓"))
    print(f"\n🎉 完成: {done} 句，识别出 {strong} 句（另 {weak} 句弱证据需人工核对），报告见 media/ocr-report.txt")


if __name__ == "__main__":
    main()
