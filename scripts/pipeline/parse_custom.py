# -*- coding: utf-8 -*-
"""解析 data/custom 下的词表文本 → data/custom/parsed.json
- topik3级/topik4级：韩语词行 + [词性]中文释义行 交替
- 韩语中级高级词汇必备：编号词条 + 同义词行（韩语 + 中文）
用法: .venv\\Scripts\\python parse_custom.py
"""
import json
import re
from pathlib import Path

from extract_doc import extract

CUSTOM = Path(__file__).resolve().parents[2] / "data" / "custom"
OUT = CUSTOM / "parsed.json"

# 来源网站广告文字（噪声）
NOISE_RE = re.compile(
    r"\s*(日语培训|日语图书|在线教学|一级能力测试|商务日语|能力测试|视频教学|日语教学|日语考级|日语学习|日本语|jiahewh|www\.|shop\.)+[.\s]*$",
    re.IGNORECASE,
)

POS_OK = {"名", "动", "形", "副", "感", "代", "数", "冠", "连", "助", "依存名", "补助动", "补助形", "词组", "俗", "口"}

KOREAN_RE = re.compile(r"^[가-힣][가-힣 .~·\-]*$")
PAIR_RE = re.compile(r"^([가-힣][가-힣 .~·\-]{0,14})\s+([一-鿿][一-鿿，。、！？：;；\s()（）/]*)$")
NUM_RE = re.compile(r"^(\d+)\.\s*([가-힣][가-힣 .~·\-]*)$")


def clean_meaning(s: str) -> str:
    s = NOISE_RE.sub("", s).strip()
    return s


def parse_simple(doc: Path, book: str, freq: int) -> list[dict]:
    """3级/4级格式：韩语行 + [词性]中文行"""
    runs = extract(doc)
    entries, seen = [], set()
    i = 0
    while i < len(runs) - 1:
        line = runs[i].strip()
        m = re.match(r"^([가-힣][가-힣 .~·\-]*)", line)
        if m and not line.startswith("["):
            korean = m.group(1).strip()
            nxt = runs[i + 1].strip()
            pm = re.match(r"^\[([^\]]+)\]\s*(.*)$", nxt)
            if pm and pm.group(1) in POS_OK:
                meaning = clean_meaning(pm.group(2))
                if meaning and len(meaning) >= 1:
                    key = korean
                    if key not in seen:
                        seen.add(key)
                        entries.append({"hangul": korean, "meaningCn": meaning, "pos": f"[{pm.group(1)}]", "book": book, "frequency": freq})
                    i += 2
                    continue
        i += 1
    return entries


def parse_synonym_book(doc: Path, book: str, freq: int) -> list[dict]:
    """中高级词汇书：编号词条（同行「词=同义词 中文」或跨行取中文）+ 无编号同义行"""
    runs = extract(doc)
    entries, seen = [], set()

    def add(korean: str, meaning: str):
        meaning = clean_meaning(meaning)
        korean = korean.strip().strip(".")
        if not meaning or len(korean) > 14 or len(korean) < 1:
            return
        if korean in seen:
            return
        seen.add(korean)
        entries.append({"hangul": korean, "meaningCn": meaning, "pos": None, "book": book, "frequency": freq})

    i = 0
    while i < len(runs):
        line = runs[i].strip()
        if "예:" in line or "www." in line or "jiahewh" in line.lower() or "http" in line.lower():
            i += 1
            continue
        # 编号词条：75. 겸손하다=겸허하다 谦逊（同行）或 1. 가리키다（跨行取中文）
        nm = re.match(r"^(\d+)\.\s*(.+)$", line)
        if nm:
            rest = nm.group(2).strip()
            # 韩语部分（可能带 =同义词 或 -反义词）+ 尾部中文
            m2 = re.match(r"^([가-힣][가-힣 .~·\-]*?)(?:=[가-힣][가-힣 .~·\-/()=]*)?\s*([一-鿿].*)?$", rest)
            if m2:
                korean = m2.group(1).split("=")[0].split("-")[0].strip()
                meaning = (m2.group(2) or "").strip()
                if meaning:
                    add(korean, meaning)
                    i += 1
                    continue
                # 同行无中文 → 从后续行找「同义行」的中文
                j = i + 1
                while j < len(runs) and j < i + 3:
                    pm = PAIR_RE.match(runs[j].strip())
                    if pm:
                        add(korean, pm.group(2))
                        break
                    j += 1
            i += 1
            continue
        # 无编号同义行：일컫다 指
        pm = PAIR_RE.match(line)
        if pm:
            add(pm.group(1), pm.group(2))
        i += 1
    return entries


def load_topik12() -> list[dict]:
    """TOPIK 1/2级新词表：topik12-raw.json（提取）+ topik12-translations.json（中文翻译）
    由 extract_topik_docx.py 生成，释义为人工翻译的中文。"""
    raw_path = CUSTOM / "topik12-raw.json"
    trans_path = CUSTOM / "topik12-translations.json"
    if not (raw_path.exists() and trans_path.exists()):
        print(f"⚠️ 缺少 topik12-raw.json / topik12-translations.json，跳过初级词表")
        return []
    raw = json.loads(raw_path.read_text(encoding="utf-8"))
    trans = json.loads(trans_path.read_text(encoding="utf-8"))
    entries = []
    for e in raw:
        t = trans.get(e["hangul"], {})
        entries.append({
            "hangul": e["hangul"],
            "meaningCn": t.get("m", ""),
            "pos": t.get("p") or None,
            "book": "TOPIK 初级词表",
            "frequency": e.get("frequency", 1),
            "exampleKo": e.get("exampleKo", ""),
            "exampleZh": t.get("e", ""),
        })
    return entries


def main():
    all_entries = []
    all_entries += load_topik12()
    all_entries += parse_simple(CUSTOM / "topik3级单词.doc", "TOPIK 中级词表", 3)
    all_entries += parse_simple(CUSTOM / "topik4级单词.doc", "TOPIK 中级词表", 4)
    all_entries += parse_synonym_book(CUSTOM / "韩语中级高级词汇必备.doc", "TOPIK 中高级词表", 5)

    OUT.write_text(json.dumps(all_entries, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"🎉 解析完成：共 {len(all_entries)} 条 → {OUT}")
    print(f"   中级词表: {sum(1 for e in all_entries if e['book'] == 'TOPIK 中级词表')} 条")
    print(f"   中高级词表: {sum(1 for e in all_entries if e['book'] == 'TOPIK 中高级词表')} 条")
    print("   样例:")
    for e in all_entries[:5]:
        print(f"     {e['hangul']} — {e['meaningCn']} {e['pos'] or ''}")


if __name__ == "__main__":
    main()
