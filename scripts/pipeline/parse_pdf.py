# -*- coding: utf-8 -*-
"""词表文本启发式解析：data/pdf-books/text/<书slug>.txt → data/pdf-books/extracted/<书slug>.csv
- 词条行：可选编号（1. / 1、/ (1) / ①）+ 韩语词（≤14 字符）+ 可选 [词性] + 中文释义
- 两种排版：同行「가방 [名] 包」；跨行「가방」下一行「[名] 包」
- 例句行：行首 예)/例/예문/→/· 标记，或缩进且包含当前词条的韩语句
- 输出 UTF-8 BOM CSV（Excel 直接打开中文不乱码），列：
  book, page, seq, hangul, pos, meaning_cn, example_ko, example_zh, status, note
  status: 空=正常 | delete=合并时跳过 | new=手工新增（订正工作区）
用法: .venv\\Scripts\\python parse_pdf.py [书slug，缺省=全部]
"""
import csv
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from pdf_common import CONFIG, EXTRACTED, TEXT_DIR, normalize_pos  # noqa: E402

PAGE_MARK = re.compile(r"^===PAGE (\d+)===$")

# 词条行/词形正则需要按书的 max_korean_len 重建 → 统一在 parse_book 里构建
def build_regexes(max_len: int) -> tuple[re.Pattern, re.Pattern, re.Pattern]:
    entry = re.compile(
        r"^\s*(?:"
        r"(?P<num>\d{1,3})[.、.)\s]|"
        r"(?P<cir>[①-⑳])|"
        r"[（(]\s*(?P<num2>\d{1,3})\s*[)）]"
        r")?\s*"
        rf"(?P<korean>[가-힣][가-힣 .~·\-]{{0,{max_len - 1}}}?)\s*"
        r"(?:\[(?P<pos>[^\]\[]+)\])?\s*"
        r"(?P<meaning>[一-鿿][一-鿿，。、！？：;；\s()（）/·~\-（）]{{0,60}})?\s*$"
    )
    meaning_first = re.compile(
        r"^\s*(?P<meaning>[一-鿿][一-鿿\s，。、！？：;；]{{0,20}}?)"
        rf"(?P<korean>[가-힣][가-힣 .~·\-]{{0,{max_len - 1}}})\s*$"
    )
    wordlike = re.compile(rf"^[가-힣 .~·\-]{{1,{max_len}}}$")
    return entry, meaning_first, wordlike

# 噪声：纯页码、课次/章节标题、网址版权
PAGE_NUM_RE = re.compile(r"^\s*\d{1,3}\s*$")
LESSON_RE = re.compile(r"^(제|第)\s*\d+\s*(과|课|天|章|장)", re.IGNORECASE)
URL_RE = re.compile(r"https?://|www\.", re.IGNORECASE)

# 跨行格式：韩语词单独一行，下一行是 [词性] 中文释义
POS_MEANING_RE = re.compile(r"^\s*\[([^\]\[]+)\]\s*(?P<meaning>[一-鿿].*)?\s*$")
# 纯中文释义行（可含数字开头，如 1月）；也用于栏目名噪声判断
PURE_MEANING_RE = re.compile(r"^\s*[\d一-鿿][\d一-鿿，。、！？：;；\s()（）/·~\-]{0,60}$")

# 例句行首标记
DEFAULT_EX_MARKERS = ("예)", "예:", "예 :", "예문", "예문:", "例)", "例:", "例：", "예시", "예）", "例）")

KOREAN_RE = re.compile(r"[가-힣]")
CJK_RE = re.compile(r"[一-鿿]")
SENT_END_RE = re.compile(r"[.。!?！？~…]$")

# 例句韩/中拆分：→ 分隔，或括号中文，或句尾中文
ARROW_SPLIT_RE = re.compile(r"^(?P<ko>.+?)\s*(?:→|=>)\s*(?P<zh>[一-鿿].*)$")
PAREN_SPLIT_RE = re.compile(r"^(?P<ko>.+?)\s*[（(]\s*(?P<zh>[一-鿿][^)]*?)\s*[)）]\s*$")
TAIL_ZH_RE = re.compile(r"^(?P<ko>[가-힣][^一-鿿]*?)[\s，。、]+\s*(?P<zh>[一-鿿][一-鿿，。、！？：;；\s]{0,80})$")


def load_config() -> dict:
    if CONFIG.exists():
        try:
            return json.loads(CONFIG.read_text(encoding="utf-8-sig"))
        except json.JSONDecodeError:
            print(f"⚠️  {CONFIG} 不是合法 JSON，按空配置处理")
    return {}


def is_noise(line: str) -> bool:
    s = line.strip()
    return bool(PAGE_NUM_RE.match(s) or LESSON_RE.match(s) or URL_RE.search(s))


def split_example(text: str) -> tuple[str, str]:
    """例句 → (韩语, 中文翻译)；拆不出则翻译为空"""
    s = text.strip()
    m = ARROW_SPLIT_RE.match(s) or PAREN_SPLIT_RE.match(s) or TAIL_ZH_RE.match(s)
    if m:
        return m.group("ko").strip(), m.group("zh").strip()
    return s, ""


def word_in_sentence(head: str, sent: str) -> bool:
    """例句是否包含当前词条（词形变化宽松匹配：공부하다 可匹配 공부해요?）"""
    if head in sent:
        return True
    if head.endswith("다") and len(head) >= 4:
        return head[:-1] in sent
    return False


def find_repeated_lines(lines: list[str]) -> set[str]:
    """连续多页重复出现的行 → 疑似页眉页脚；重复的纯中文行 → 疑似栏目名（如 知识补充）"""
    from collections import Counter

    cnt = Counter(s.strip() for s in lines if s.strip())
    headers = {k for k, v in cnt.items() if v >= 5 and len(k) < 40}
    # 纯中文且重复 ≥3 次 → 栏目名噪声
    headers |= {k for k, v in cnt.items()
                if v >= 3 and not KOREAN_RE.search(k) and PURE_MEANING_RE.match(k)}
    return headers


def parse_book(txt_path: Path, cfg: dict) -> list[dict]:
    lines = txt_path.read_text(encoding="utf-8").splitlines()
    headers = find_repeated_lines(lines)
    ex_markers = tuple(cfg.get("example_markers", ())) + DEFAULT_EX_MARKERS
    skip_patterns = [re.compile(p) for p in cfg.get("skip_line_patterns", [])]
    max_len = int(cfg.get("max_korean_len", 14))
    entry_re, meaning_first_re, wordlike_re = build_regexes(max_len)

    entries: list[dict] = []
    cur = None  # 当前词条
    page = 0
    ignored_sentence_lines = 0
    unclassified_short = 0
    seq = 0

    def flush():
        nonlocal cur, seq
        if cur is not None:
            if cur["meaning_cn"] or cur["pos"]:
                seq += 1
                cur["seq"] = seq
                entries.append(cur)
            else:
                # 词条没有释义也没有词性 → 整条存疑
                cur["seq"] = seq + 1
                cur["note"] = (cur["note"] + "；" if cur["note"] else "") + "存疑:无释义"
                seq += 1
                entries.append(cur)
            cur = None

    i = 0
    while i < len(lines):
        line = lines[i].rstrip("﻿")
        pm = PAGE_MARK.match(line.strip())
        if pm:
            page = int(pm.group(1))
            i += 1
            continue
        s = line.strip()
        if not s or s in headers or is_noise(s):
            i += 1
            continue
        if any(p.search(s) for p in skip_patterns):
            i += 1
            continue

        # 词条行？标准格式（韩语在前）或释义在前格式（很气愤화내다）
        korean = pos = meaning = None
        em = entry_re.match(line)
        if em:
            korean, pos, meaning = em.group("korean").strip(), normalize_pos(em.group("pos")), (em.group("meaning") or "").strip()
        elif cfg.get("meaning_first", True):
            mf = meaning_first_re.match(line)
            if mf:
                korean, meaning = mf.group("korean").strip(), mf.group("meaning").strip()
        if korean is not None:
            # 词尾句号：有释义 → 去句号保留（词组类词条）；无释义 → 是句子不是词，跳过
            if korean.endswith("."):
                korean = korean.rstrip(".")
                if not meaning:
                    ignored_sentence_lines += 1
                    i += 1
                    continue
            # 同行没有释义 → 看下一行是否是 [词性] 释义 / 纯中文释义
            if not meaning:
                if i + 1 < len(lines):
                    nxt = lines[i + 1].strip()
                    pm2 = POS_MEANING_RE.match(nxt)
                    if pm2:
                        pos = pos or normalize_pos(pm2.group(1))
                        meaning = (pm2.group("meaning") or "").strip()
                        if meaning:
                            i += 1
                    elif PURE_MEANING_RE.match(nxt):
                        meaning = nxt
                        i += 1
            flush()
            cur = {"book": txt_path.stem, "page": page, "seq": 0, "hangul": korean,
                   "pos": pos or "", "meaning_cn": meaning, "example_ko": "",
                   "example_zh": "", "status": "", "note": ""}
            i += 1
            continue

        # 释义在前跨行格式：中文释义一行，下一行是韩语词（如 眼睛 / 눈）
        if not KOREAN_RE.search(s) and PURE_MEANING_RE.match(s) and i + 1 < len(lines):
            j = i + 1
            while j < len(lines) and PAGE_MARK.match(lines[j].strip()):
                j += 1  # 跳过页码标记
            if j < len(lines):
                nxt = lines[j].strip()
                if wordlike_re.match(nxt):
                    flush()
                    cur = {"book": txt_path.stem, "page": page, "seq": 0, "hangul": nxt,
                           "pos": "", "meaning_cn": s, "example_ko": "",
                           "example_zh": "", "status": "", "note": ""}
                    i = j + 1
                    continue

        # 例句行？挂在当前词条下
        is_marked = s.startswith(ex_markers)
        has_korean = bool(KOREAN_RE.search(s))
        if cur is not None and has_korean and (
            is_marked or (line != line.lstrip() and SENT_END_RE.search(s) and word_in_sentence(cur["hangul"], s))
        ):
            ko, zh = split_example(s)
            if cur["example_ko"]:
                cur["example_ko"] += " " + ko
                if zh:
                    cur["example_zh"] = (cur["example_zh"] + "；" if cur["example_zh"] else "") + zh
            else:
                cur["example_ko"], cur["example_zh"] = ko, zh
            i += 1
            continue

        # 无法归类：含韩语的行
        if has_korean:
            if wordlike_re.match(s):
                # 疑似漏掉的短词条（词条样但没匹配上）→ 记 note
                unclassified_short += 1
                note = f"未识别:{s[:40]}"
                if cur is not None and note not in (cur["note"] or ""):
                    cur["note"] = (cur["note"] + "；" if cur["note"] else "") + note
            else:
                ignored_sentence_lines += 1
        i += 1

    flush()
    return entries, {"ignored_sentence_lines": ignored_sentence_lines,
                     "unclassified_short": unclassified_short,
                     "headers": len(headers)}


def main():
    cfg = load_config()
    slugs = [sys.argv[1]] if len(sys.argv) > 1 else [p.stem for p in sorted(TEXT_DIR.glob("*.txt"))]
    if not slugs:
        print(f"⚠️  {TEXT_DIR} 下没有文本，先运行 extract_pdf.py（并确认 PDF 已放入 data/pdf-books/）。")
        return

    EXTRACTED.mkdir(parents=True, exist_ok=True)
    COLUMNS = ["book", "page", "seq", "hangul", "pos", "meaning_cn",
               "example_ko", "example_zh", "status", "note"]

    for slug in slugs:
        txt_path = TEXT_DIR / f"{slug}.txt"
        if not txt_path.exists():
            print(f"⚠️  缺少 {txt_path}，跳过")
            continue
        book_cfg = cfg.get(slug, {})
        entries, stats = parse_book(txt_path, book_cfg)
        out = EXTRACTED / f"{slug}.csv"
        with out.open("w", encoding="utf-8-sig", newline="") as f:
            w = csv.writer(f)
            w.writerow(COLUMNS)
            for e in entries:
                w.writerow([e[c] for c in COLUMNS])
        with_ex = sum(1 for e in entries if e["example_ko"])
        print(f"✅ {slug}: 解析 {len(entries)} 条（含例句 {with_ex} 条）→ {out}")
        print(f"   ├ 忽略的长句/课文行 {stats['ignored_sentence_lines']} | 疑似漏词条 {stats['unclassified_short']} | 页眉页脚 {stats['headers']}")
        if entries:
            print("   └ 样例: " + " | ".join(f"{e['hangul']} {e['pos']} {e['meaning_cn'][:20]}" for e in entries[:3]))


if __name__ == "__main__":
    main()
