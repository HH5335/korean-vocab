# -*- coding: utf-8 -*-
"""PDF 词表流水线公共模块：路径常量、韩语归一化、词性映射、CSV/JSON 稳健读取"""
import csv
import io
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]  # korean-vocab/
DATA = ROOT / "data"
PDF_BOOKS = DATA / "pdf-books"
TEXT_DIR = PDF_BOOKS / "text"
EXTRACTED = PDF_BOOKS / "extracted"
CONFIG = PDF_BOOKS / "config.json"

MEDIA_MAPPINGS = ROOT / "media" / "mappings.json"
AI_EXAMPLES = EXTRACTED / "ai-examples.json"
MERGED_JSON = EXTRACTED / "merged.json"

# ---------- 去重键：仅空白归一化（strip + 内部空白折叠为单空格） ----------
def norm_key(hangul: str) -> str:
    return " ".join(hangul.split())


# ---------- 词性归一化：教材/词典常见写法 → 统一 [xx] 形式 ----------
POS_MAP = {
    "명사": "[名]", "名词": "[名]", "名": "[名]",
    "동사": "[动]", "动词": "[动]", "动": "[动]",
    "형용사": "[形]", "形容词": "[形]", "形": "[形]",
    "부사": "[副]", "副词": "[副]", "副": "[副]",
    "감탄사": "[感]", "叹词": "[感]", "感叹词": "[感]", "感": "[感]",
    "대명사": "[代]", "代词": "[代]", "代": "[代]",
    "수사": "[数]", "数词": "[数]", "数": "[数]",
    "관형사": "[冠]", "冠形词": "[冠]", "冠": "[冠]",
    "접사": "[缀]", "词缀": "[缀]", "缀": "[缀]",
    "조사": "[助]", "助词": "[助]", "助": "[助]",
    "의존명사": "[依存名]", "依存名词": "[依存名]", "依存名": "[依存名]",
    "표현": "[词组]", "惯用语": "[词组]", "词组": "[词组]", "表达": "[词组]",
    "连": "[连]",
}


def normalize_pos(raw: str | None) -> str | None:
    """把任意词性写法归一化；映射不到的保留原文（去首尾空白），空返回 None"""
    if not raw:
        return None
    s = raw.strip().strip("[]（）()")
    if not s:
        return None
    if s in POS_MAP:
        return POS_MAP[s]
    return f"[{s}]"


# ---------- CSV 稳健读取（utf-8-sig → utf-8 → gbk 回退，防 Excel 另存 ANSI） ----------
def read_csv_robust(path: Path) -> list[list[str]]:
    raw = path.read_bytes()
    for enc in ("utf-8-sig", "utf-8", "gbk"):
        try:
            text = raw.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    else:
        text = raw.decode("utf-8", errors="replace")
    return [row for row in csv.reader(io.StringIO(text))]


def read_json_robust(path: Path) -> dict | list:
    text = path.read_text(encoding="utf-8-sig")
    return json.loads(text)
