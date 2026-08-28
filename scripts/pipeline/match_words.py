# -*- coding: utf-8 -*-
"""
阶段 2：转录 JSON + 词表 → 单词-歌词/综艺片段映射 + 自动剪辑音频
用法（在 pipeline 目录）:
  .venv\\Scripts\\python match_words.py
输入: media/transcripts/*.json + 数据库词表（server/prisma/dev.db）
输出: media/mappings.json + media/clips/*.mp3
"""
import json
import re
import shutil
import sqlite3
import subprocess
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
MEDIA_DIR = PROJECT_ROOT / "media"
TRANS_DIR = MEDIA_DIR / "transcripts"
CLIPS_DIR = MEDIA_DIR / "clips"
DB_PATH = PROJECT_ROOT / "server" / "prisma" / "dev.db"
OUT_JSON = MEDIA_DIR / "mappings.json"

# 单词的干扰后缀：가구03 → 가구、듣다(1) → 듣다
CLEAN_RE = re.compile(r"(\d+)$|[(\[（].*?[)\]）]$")

# 过于泛用的虚词/高频词，匹配了也没学习价值，跳过
STOPWORDS = {
    "하다", "있다", "없다", "되다", "이다", "가다", "오다", "보다", "그", "이",
    "저", "우리", "너", "나", "것", "수", "때", "은", "는", "이", "을", "를",
    "에", "의", "도", "만", "로", "에서", "까지", "부터", "네", "요", "요.",
}

# 常见活用还原到词典形的词性标签（kiwipiepy tag）
# 注意：kiwi 的 lemma 对动词/形容词已给出词典形（좋다/하다），直接用
VERB_TAGS = {"VV", "VA", "VX", "VCP", "VCN"}
# 直接可作为词形使用的标签（名词/感叹词等）
DIRECT_TAGS = {"NNG", "NNP", "NP", "IC", "NR", "SN", "SH"}


def load_words() -> dict[str, list[tuple[str, str]]]:
    """从 SQLite 词表读 (id, hangul)，仅限延世韩国语词书（yonsei）→ 匹配表"""
    conn = sqlite3.connect(DB_PATH)
    rows = conn.execute(
        "SELECT w.id, w.hangul FROM Word w"
        " JOIN WordBook b ON w.bookId = b.id"
        " WHERE b.category = 'yonsei'"
    ).fetchall()
    conn.close()
    table: dict[str, list[tuple[str, str]]] = {}
    for wid, hangul in rows:
        cleaned = CLEAN_RE.sub("", hangul).strip()
        if not cleaned or cleaned in STOPWORDS:
            continue
        table.setdefault(cleaned, []).append((wid, hangul))
    print(f"📖 词表加载（仅延世词书）: {len(table)} 个可匹配词形")
    return table


def token_lemmas(kiwi, text: str) -> list[tuple[str, str]]:
    """形态素分析，输出 (词典形, 原句字面形态) 列表
    字面形态用 token 的字符位置截取，保证能精确高亮（含 하→해 等缩合形）
    """
    lemmas: list[tuple[str, str]] = []
    tokens = kiwi.tokenize(text)
    for i, tok in enumerate(tokens):
        tag = tok.tag
        lemma = tok.lemma or tok.form
        surface = text[tok.start:tok.end]
        if tag in VERB_TAGS:
            lemmas.append((lemma, surface))  # kiwi 的 lemma 已是词典形
        elif tag in ("XSV", "XSA") and i > 0 and tokens[i - 1].tag in ("NNG", "NNP"):
            # 名词 + 하다 的组合动词：공부/NNG + 하/XSV → 공부하다
            prev = tokens[i - 1]
            lemmas.append((prev.lemma + "하다", text[prev.start:tok.end]))
        elif tag in DIRECT_TAGS:
            lemmas.append((lemma, surface))
    return lemmas


def clip_audio(media: Path, start: float, end: float, out_mp3: Path):
    """剪辑单句片段（前 0.3 秒 ~ 后 1.2 秒，最长 12 秒，只含目标词所在句）"""
    pad_start = 0.3
    pad_end = 1.2
    s = max(0.0, start - pad_start)
    e = min(end + pad_end, s + 12.0)
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-ss", f"{s:.2f}", "-to", f"{e:.2f}",
         "-i", str(media), "-vn", "-ac", "1", "-ar", "22050", str(out_mp3)],
        check=False,
    )


def main():
    from kiwipiepy import Kiwi

    # 清空旧剪辑后重建：旧片段 padding 宽（含前后句），且精确定位后文件名会变
    shutil.rmtree(CLIPS_DIR, ignore_errors=True)
    CLIPS_DIR.mkdir(parents=True, exist_ok=True)
    kiwi = Kiwi()
    words = load_words()

    trans_files = sorted(TRANS_DIR.glob("*.json"))
    if not trans_files:
        print("❌ 没有转录文件，请先运行 transcribe.py")
        return

    # 转录文件名 → 原始媒体文件
    media_by_stem = {}
    for sub, stype in (("songs", "song"), ("going", "going")):
        d = MEDIA_DIR / sub
        if d.is_dir():
            for p in d.iterdir():
                if p.suffix.lower() in {".mp4", ".mp3", ".m4a", ".mkv", ".webm", ".wav", ".flv"}:
                    media_by_stem[p.stem] = (p, stype, sub)

    mappings = []
    matched_keys = set()  # 去重: (wordId, sourceName, startTime)
    per_word_source: dict[tuple[str, str], int] = {}  # 每个词每个来源最多取 2 段

    for tj in trans_files:
        stem = tj.stem
        if stem not in media_by_stem:
            print(f"⚠️ 找不到 {stem} 对应的媒体文件，跳过")
            continue
        media, stype, subdir = media_by_stem[stem]
        source_name = stem
        artist = "SEVENTEEN" if stype == "song" else None

        segs = json.loads(tj.read_text(encoding="utf-8"))
        print(f"🎵 匹配 {tj.name}: {len(segs)} 段")

        for seg in segs:
            text = seg["text"].strip()
            if len(text) < 5:
                continue
            lemmas = token_lemmas(kiwi, text)
            for lemma, surface in lemmas:
                if lemma not in words:
                    continue
                for wid, orig_hangul in words[lemma]:
                    key = (wid, source_name, seg["start"])
                    if key in matched_keys:
                        continue
                    if per_word_source.get((wid, source_name), 0) >= 2:
                        continue
                    matched_keys.add(key)
                    per_word_source[(wid, source_name)] = per_word_source.get((wid, source_name), 0) + 1

                    # 剪辑音频（强制重剪：padding 已收紧，旧剪辑含前后句必须废弃）
                    clip_name = f"{orig_hangul}_{stem[:20]}_{int(seg['start'])}.mp3"
                    clip_name = re.sub(r'[\\/:*?"<>|]', "_", clip_name)
                    clip_path = CLIPS_DIR / clip_name
                    if clip_path.exists():
                        clip_path.unlink()
                    clip_audio(media, seg["start"], seg["end"], clip_path)

                    mappings.append({
                        "wordId": wid,
                        "hangul": orig_hangul,
                        "sourceType": stype,
                        "sourceName": source_name,
                        "artist": artist,
                        "quote": text,
                        "surface": surface,
                        "startTime": round(seg["start"], 1),
                        "endTime": round(seg["end"], 1),
                        "audioUrl": f"/media/clips/{clip_name}" if clip_path.exists() else None,
                    })

    OUT_JSON.write_text(json.dumps(mappings, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\n🎉 匹配完成: {len(mappings)} 条映射 → {OUT_JSON}")
    print("   下一步: 在 server 目录运行 npx tsx scripts/import-mappings.ts 导入数据库")


if __name__ == "__main__":
    main()
