# -*- coding: utf-8 -*-
"""从 .doc 二进制中直接提取 UTF-16 文本段（Word 导出丢韩语时的兜底方案）
用法: .venv\\Scripts\\python extract_doc.py
输出: data/custom/<文件名>.utf16.txt —— 每行一段可读文本
"""
import re
from pathlib import Path

CUSTOM = Path(__file__).resolve().parents[2] / "data" / "custom"

# 可读字符：ASCII 可见 + 中文 + 韩文
READABLE = re.compile(r"[ -~一-鿿가-힣]+")


def extract(doc_path: Path) -> list[str]:
    raw = doc_path.read_bytes()
    # 整文件按 UTF-16LE 解码（错位的地方会乱，但真实文本段会浮现）
    # 两种字节对齐都试：奇偶错位的文本段互补，合并后去重
    seen = set()
    out: list[str] = []
    for offset in (0, 1):
        decoded = raw[offset:].decode("utf-16-le", errors="ignore")
        for r in READABLE.findall(decoded):
            if len(r) < 3:
                continue
            if not (re.search(r"[가-힣]", r) or re.search(r"[一-鿿]", r)):
                continue
            if r in seen:
                continue
            seen.add(r)
            out.append(r)
    return out


def main():
    for doc in sorted(CUSTOM.glob("*.doc")):
        runs = extract(doc)
        out = doc.with_suffix(".utf16.txt")
        out.write_text("\n".join(runs), encoding="utf-8")
        hangul = sum(len(re.findall(r"[가-힣]", r)) for r in runs)
        print(f"✅ {doc.name}: {len(runs)} 个文本段，含韩语 {hangul} 字符 → {out.name}")


if __name__ == "__main__":
    main()
