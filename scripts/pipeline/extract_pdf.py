# -*- coding: utf-8 -*-
"""PDF 文本提取：data/pdf-books/*.pdf → data/pdf-books/text/<书slug>.txt + text_stats.json
- 逐页提取文本层，页间插 ===PAGE n=== 标记
- 统计每本页数/总字符/韩文字符/有文本页数，疑似扫描版（无文本层）醒目警告
用法: .venv\\Scripts\\python extract_pdf.py
"""
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from pdf_common import PDF_BOOKS, TEXT_DIR  # noqa: E402

HANGUL_RE = re.compile(r"[가-힣]")


def slugify(name: str) -> str:
    """文件名（去扩展名）做 slug，保留中韩文字符"""
    for ch in '\\/:*?"<>|':
        name = name.replace(ch, "_")
    return name.strip() or "book"


def extract_one(pdf_path: Path) -> dict:
    import pymupdf

    doc = pymupdf.open(pdf_path)
    lines: list[str] = []
    stats = {"file": pdf_path.name, "slug": slugify(pdf_path.stem), "pages": len(doc),
             "total_chars": 0, "hangul_chars": 0, "pages_with_text": 0, "status": "text"}
    for i, page in enumerate(doc):
        text = page.get_text("text")
        hangul = len(HANGUL_RE.findall(text))
        stats["total_chars"] += len(text)
        stats["hangul_chars"] += hangul
        if text.strip():
            stats["pages_with_text"] += 1
        lines.append(f"===PAGE {i + 1}===")
        lines.append(text.rstrip())
    doc.close()

    # 扫描版判定
    if stats["hangul_chars"] == 0 and stats["total_chars"] < 200:
        stats["status"] = "empty"
    elif stats["hangul_chars"] < 100 or (stats["pages"] and stats["pages_with_text"] / stats["pages"] < 0.3):
        stats["status"] = "scanned-suspect"

    out = TEXT_DIR / f"{stats['slug']}.txt"
    out.write_text("\n".join(lines), encoding="utf-8")
    return stats


def main():
    pdfs = sorted(PDF_BOOKS.glob("*.pdf"))
    if not pdfs:
        print(f"⚠️  {PDF_BOOKS} 下没有 PDF 文件，请把韩语书 PDF 放进去后重跑。")
        return

    TEXT_DIR.mkdir(parents=True, exist_ok=True)
    all_stats = []
    print("📄 提取 PDF 文本层：\n")
    for p in pdfs:
        s = extract_one(p)
        all_stats.append(s)
        flag = {"text": "✅", "scanned-suspect": "⚠️ ", "empty": "❌"}[s["status"]]
        print(f"  {flag} {s['file']} → text/{s['slug']}.txt")
        print(f"     页数 {s['pages']} | 总字符 {s['total_chars']} | 韩文字符 {s['hangul_chars']} | 有文本页 {s['pages_with_text']}/{s['pages']}")

    print()
    suspects = [s for s in all_stats if s["status"] != "text"]
    if suspects:
        print("=" * 72)
        print("🚨 警告：以下 PDF 疑似扫描版（无文本层），提取不到词表内容：")
        for s in suspects:
            print(f"   - {s['file']}（韩文字符 {s['hangul_chars']}）")
        print("   请确认 PDF 中的文字能否用鼠标选中复制；扫描图片版需要 OCR，不在本次范围。")
        print("=" * 72)

    (TEXT_DIR / "text_stats.json").write_text(
        json.dumps(all_stats, ensure_ascii=False, indent=2), encoding="utf-8"
    )


if __name__ == "__main__":
    main()
