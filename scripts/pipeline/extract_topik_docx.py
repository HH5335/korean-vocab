# -*- coding: utf-8 -*-
"""从 TOPIK 1.docx / TOPIK 2.docx（오늘의 어휘 핸드북）提取词汇 → data/custom/topik12-raw.json
文档结构（两本稍有差异）：
- '오늘의 어휘' 段落后是词汇表：每词两行 —— 词行 / 例句行；'오늘의 문법' 后是语法表（跳过）
- 表内可能有 '듣기 1-4' / '읽기 59-60' 小节标题行，跳过；Word 从 PDF 转换有嵌套表格/文本框重复，按行特征容错
- 词行布局（4 种）：
    A 单格合并：'어디whereadverb'（行尾带词性）       TOPIK 1
    B 两格：'오전morning' + 'noun'（独立词性格）       TOPIK 1
    C 单格合并：'검사1 examination/inspection'（词尾带数字标记，无词性）  TOPIK 2
    D 三格：'직접' + '3' + 'directly/in person'（数字独立格）      TOPIK 2
- 例句行：TOPIK 1 = 韩语例句+英译；TOPIK 2 = 仅韩语例句
- 词行分类特征：韩语部分短(≤12字、无句末标点) 且 英文释义短(≤40字、无句末标点)
用法: .venv\\Scripts\\python extract_topik_docx.py
"""
import json
import re
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

NS = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
CUSTOM = Path(__file__).resolve().parents[2] / "data" / "custom"
OUT = CUSTOM / "topik12-raw.json"
ANOMALIES = CUSTOM / "topik12-anomalies.json"

# 小节标题行：듣기 1-4 / 읽기 59-60 / 듣기 23~24
SECTION_RE = re.compile(r"^\s*(듣기|읽기)\s*\d+\s*[-–—~]\s*\d+\s*$")
# 行内「韩语部分 | 英文部分」拆分：首个 ASCII 字母（或英文括号）开始算英文
SPLIT_RE = re.compile(r"^([가-힣0-9.,!?~·\'‘’\"“”…()\-/ ,]+?)\s*(?=[A-Za-z(])(.+)$")
# 行尾词性 token（容忍 'noun (adjective)'、'adverb/' 等文档转档噪声）
POS_TAIL_RE = re.compile(
    r"\s*(adjective|adverb|auxiliary\s*verb|noun|pronoun|numeral|interjection|expression|particle|determiner|conjunction|dependent\s*noun|verb)"
    r"(\s*\([a-z]+\))?\s*/?\s*$",
    re.IGNORECASE,
)
# 词组式词条：하나(한), 둘(두), ... / 앞, 뒤, 옆, 위, 아래(밑), 안(속), 밖
GROUP_RE = re.compile(r"^[가-힣]+(\([가-힣]+\))?(,\s*[가-힣]+(\([가-힣]+\))?)+$")
# 词组式词行（同行可能带英文释义）：'하나(한), 둘(두), ... One, two, ...'
GROUP_ROW_RE = re.compile(
    r"^([가-힣]+(\([가-힣]+\))?(,\s*[가-힣]+(\([가-힣]+\))?)+)\s*(?:[A-Za-z].*)?$"
)
# 词性组合格：'noun/adverb'、'adjective/noun'（文档噪声，取第一个词性）
POS_COMBO_RE = re.compile(
    r"^(adjective|adverb|auxiliary\s*verb|noun|pronoun|numeral|interjection|expression|particle|determiner|conjunction|dependent\s*noun|verb)"
    r"(/(adjective|adverb|auxiliary\s*verb|noun|pronoun|numeral|interjection|expression|particle|determiner|conjunction|dependent\s*noun|verb))*$",
    re.IGNORECASE,
)

POS_EN = {
    "noun": "名", "verb": "动", "adjective": "形", "adverb": "副",
    "interjection": "感", "pronoun": "代", "numeral": "数", "determiner": "冠",
    "expression": "词组", "particle": "助", "auxiliary verb": "补助动",
    "conjunction": "连", "dependent noun": "依存名",
}


def direct_text(p) -> str:
    """段落直接 run 文本（不含文本框/嵌套对象里的重复内容）"""
    return "".join(t.text or "" for t in p.findall("w:r/w:t", NS))


def cell_text(tc) -> str:
    return "".join(t.text or "" for t in tc.findall(".//w:t", NS)).strip()


def row_cells(tr) -> list[str]:
    return [cell_text(tc) for tc in tr.findall("w:tc", NS)]


def split_ko_en(s: str) -> tuple[str, str]:
    """把 '은행이 어디에 있어요? Where is the bank?' 拆成 (韩语, 英文)"""
    m = SPLIT_RE.match(s)
    if m:
        return m.group(1).strip(), m.group(2).strip()
    return s.strip(), ""


def cell_ko_en(cells: list[str]) -> tuple[str, str]:
    """从一行单元格提取 (韩语部分, 英文部分)：
    - 单格：'어디whereadverb' → ('어디', 'whereadverb')
    - 两格：'오전morning' + 'noun' → ('오전', 'morning')（词性格）
    - 两格：'건강' + 'health' → ('건강', 'health')（释义独立格，布局 E）
    - 三格：'직접' + '3' + 'directly/in person' → ('직접', 'directly/in person')
    """
    c0 = (cells[0] or "").strip()
    ko, en = split_ko_en(c0)
    for c in cells[1:]:
        c = c.strip()
        if not c or re.fullmatch(r"\d+", c) or c.lower() in POS_EN or POS_COMBO_RE.match(c):
            continue
        en = c  # 第一个非词性非数字格 = 释义
        break
    return ko, en


def ko_short_p(ko: str) -> bool:
    ko = re.sub(r"\d+$", "", ko).strip()
    return bool(ko) and len(ko) <= 12 and not re.search(r"[.!?]", ko) and ko.count(" ") <= 2


def en_short_p(en: str) -> bool:
    return bool(en) and len(en) <= 60 and not re.search(r"[.!?]$", en) and en.count(" ") <= 8


def classify(cells: list[str]) -> str:
    """行分类：header / noise / word / example"""
    c0 = (cells[0] or "").strip()
    if not c0:
        return "noise"
    if SECTION_RE.match(c0):
        return "header"
    if not re.search(r"[가-힣]", c0):
        return "noise"
    if GROUP_ROW_RE.match(c0):
        return "word"
    ko, en = cell_ko_en(cells)
    if ko_short_p(ko) and en_short_p(en):
        return "word"
    return "example"


def parse_word_row(cells: list[str]) -> dict | None:
    """词行 → {hangul, meaningEn, posEn, freqMark}"""
    c0 = (cells[0] or "").strip()
    gm = GROUP_ROW_RE.match(c0)
    if gm:
        ko = gm.group(1)  # 词组式词条：'하나(한), 둘(두), ...'
        en = c0[gm.end(1):].strip()  # 同行尾部的英文释义
        if not en:
            en = cell_ko_en(cells)[1]  # 释义在独立格时回退
    else:
        _, split_en = split_ko_en(c0)  # 拆分结果单独判断括号误拆
        ko, en = cell_ko_en(cells)
        ko = re.sub(r"\d+$", "", ko).strip()  # '검사1' 尾部数字标记
        # '(을) 쓰다' 被误拆时合回韩语部分（括号内无英文字母）
        if split_en and split_en.startswith("(") and not re.search(r"[A-Za-z]", split_en):
            ko = c0
    pos, mark = "", ""
    for c in cells[1:]:
        c = c.strip()
        if not c:
            continue
        if re.fullmatch(r"\d+", c):
            mark = mark or c  # 布局 D 数字独立格
        elif c.lower() in POS_EN:
            pos = pos or c  # 独立词性格优先
        elif POS_COMBO_RE.match(c):
            pos = pos or c.split("/")[0]  # 'noun/adverb' → noun
    # 释义行尾的词性噪声循环剥离：'nowadaysadverb/noun' → 'nowadays'
    while True:
        m = POS_TAIL_RE.search(en)
        if not m:
            break
        if not pos:
            pos = m.group(1).strip()
        en = en[: m.start()].strip()
    if not ko or not re.search(r"[가-힣]", ko):
        return None
    return {"hangul": ko, "meaningEn": en, "posEn": pos or "", "freqMark": mark}


def expand_group(entry: dict) -> list[dict]:
    """词组式词条拆成单个词（하나(한), 둘(두) → 하나/한/둘/두，共享释义例句）"""
    hangul = entry["hangul"]
    if not GROUP_RE.match(hangul):
        return [entry]
    parts = [p.strip() for p in hangul.split(",")]
    words = []
    for p in parts:
        m = re.match(r"^([가-힣]+)(?:\(([가-힣]+)\))?$", p)
        if m:
            words.append(m.group(1))
            if m.group(2):
                words.append(m.group(2))
    return [{**entry, "hangul": w} for w in words]


def walk(docx: Path):
    """按文档顺序产出事件：('para', 直接文本) / ('table', 表索引, 行列表)"""
    z = zipfile.ZipFile(docx)
    root = ET.fromstring(z.read("word/document.xml"))
    body = root.find("w:body", NS)
    tbl_i = 0
    for el in body:
        tag = el.tag.rsplit("}", 1)[-1]
        if tag == "p":
            yield "para", direct_text(el)
        elif tag == "tbl":
            yield "table", tbl_i, [row_cells(tr) for tr in el.findall("w:tr", NS)]
            tbl_i += 1


def extract(docx: Path, freq: int, src: str):
    entries, anomalies, mode = [], [], "before"
    cur_word: tuple | None = None  # (word_dict, table_index)

    def flush(reason: str):
        nonlocal cur_word
        if cur_word is not None:
            w, ti = cur_word
            anomalies.append({"src": src, "table": ti, "type": reason, "word": w})
            entries.append({
                "hangul": w["hangul"], "meaningEn": w["meaningEn"],
                "posEn": w["posEn"], "freqMark": w.get("freqMark", ""),
                "exampleKo": "", "exampleEn": "",
                "frequency": freq, "src": src,
            })
            cur_word = None

    for kind, *payload in walk(docx):
        if kind == "para":
            t = payload[0].strip()
            if "오늘의 어휘" in t:
                mode = "vocab"
            elif "오늘의 문법" in t:
                mode = "grammar"
            continue
        if mode != "vocab":
            continue
        ti, rows = payload
        for cells in rows:
            kind = classify(cells)
            if kind == "header" or kind == "noise":
                continue
            if kind == "word":
                if cur_word is not None:  # 上一个词缺例句（防错位扩散）
                    flush("word-without-example")
                w = parse_word_row(cells)
                if not w:
                    continue
                if GROUP_RE.match(w["hangul"]):
                    # 词组式词条自成条目，不等待例句行
                    entries.append({
                        "hangul": w["hangul"], "meaningEn": w["meaningEn"],
                        "posEn": w["posEn"], "freqMark": w.get("freqMark", ""),
                        "exampleKo": "", "exampleEn": "",
                        "frequency": freq, "src": src,
                    })
                else:
                    cur_word = (w, ti)
                continue
            # example 行
            ko, en = cell_ko_en(cells)
            ko = ko.rstrip().rstrip("‘’\"'").strip()  # 行尾引号噪声
            if cur_word is None:
                anomalies.append({"src": src, "table": ti, "type": "example-without-word", "row": cells})
                continue
            w, wti = cur_word
            entries.append({
                "hangul": w["hangul"], "meaningEn": w["meaningEn"],
                "posEn": w["posEn"], "freqMark": w.get("freqMark", ""),
                "exampleKo": ko, "exampleEn": en,
                "frequency": freq, "src": src,
            })
            cur_word = None
        flush("word-without-example")  # 表边界清空，防跨表错位
    flush("word-without-example")
    return entries, anomalies


def main():
    all_entries, all_anomalies = [], []
    for name, freq in (("TOPIK 1.docx", 1), ("TOPIK 2.docx", 2)):
        docx = CUSTOM / name
        if not docx.exists():
            print(f"⚠️ 缺少 {name}，跳过")
            continue
        entries, anomalies = extract(docx, freq, name)
        all_entries += entries
        all_anomalies += anomalies
        print(f"📗 {name}: {len(entries)} 词条 | 异常 {len(anomalies)}")

    # 词组式词条拆分 + 去重（1 级优先）
    seen, deduped = set(), []
    for e in all_entries:
        for sub in expand_group(e):
            if sub["hangul"] in seen:
                continue
            seen.add(sub["hangul"])
            deduped.append(sub)

    # 段落里的方位词组词（不在表格中，手动补全）
    FIXUPS = [
        ("뒤", "back/behind", "noun"), ("옆", "side/next to", "noun"),
        ("위", "top/above/on", "noun"), ("아래", "bottom/below/under", "noun"),
        ("밑", "bottom/under", "noun"), ("안", "inside", "noun"),
        ("속", "inside/interior", "noun"), ("밖", "outside", "noun"),
    ]
    for hangul, meaning, pos in FIXUPS:
        if hangul in seen:
            continue
        seen.add(hangul)
        deduped.append({
            "hangul": hangul, "meaningEn": meaning, "posEn": pos, "freqMark": "",
            "exampleKo": "", "exampleEn": "", "frequency": 1, "src": "TOPIK 1.docx",
        })

    OUT.write_text(json.dumps(deduped, ensure_ascii=False, indent=1), encoding="utf-8")
    ANOMALIES.write_text(json.dumps(all_anomalies, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"🎉 共 {len(deduped)} 词条（去重+词组拆分后）→ {OUT}")
    print("样例:")
    for e in deduped[:8]:
        print(f"  {e['hangul']} | {e['posEn'] or '-'} | {e['meaningEn']} | {e['exampleKo']} | {e['exampleEn']}")
    print(f"异常 {len(all_anomalies)} 条 → {ANOMALIES}")


if __name__ == "__main__":
    main()
