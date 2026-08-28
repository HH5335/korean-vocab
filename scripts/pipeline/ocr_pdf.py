# -*- coding: utf-8 -*-
"""扫描版 PDF OCR：渲染页面 → RapidOCR 识别 → 输出与 extract_pdf.py 相同格式的文本
用法: .venv\\Scripts\\python ocr_pdf.py "书slug" [--pages 1-5] [--dpi 200]
- --pages 只处理指定页范围（测试用，如 10-20）
- 输出 data/pdf-books/text/<书slug>.txt（===PAGE n=== 分页，与 parse_pdf.py 兼容）
"""
import argparse
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from pdf_common import PDF_BOOKS, TEXT_DIR  # noqa: E402

PAGE_MARK_RE = re.compile(r"^===PAGE (\d+)===$")


def find_pdf(slug: str) -> Path | None:
    for p in sorted(PDF_BOOKS.glob("*.pdf")):
        if p.stem == slug:
            return p
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("slug", help="PDF 文件名（不含 .pdf 扩展名）")
    ap.add_argument("--pages", type=str, default="", help="页范围，如 10-20（缺省全本）")
    ap.add_argument("--dpi", type=int, default=200, help="渲染分辨率，默认 200")
    args = ap.parse_args()

    pdf = find_pdf(args.slug)
    if pdf is None:
        print(f"⚠️  找不到 {args.slug}.pdf（请核对文件名，与 PDF 完全一致）")
        return

    import pymupdf
    from rapidocr_onnxruntime import RapidOCR

    doc = pymupdf.open(pdf)
    start, end = 1, len(doc)
    if args.pages:
        m = re.match(r"^(\d+)-(\d+)$", args.pages)
        if not m:
            print("⚠️  --pages 格式应为 10-20")
            return
        start, end = int(m.group(1)), min(int(m.group(2)), end)

    engine = RapidOCR()
    print(f"🔍 OCR: {pdf.name}（第 {start}-{end} 页，共 {len(doc)} 页，DPI {args.dpi}）")

    TEXT_DIR.mkdir(parents=True, exist_ok=True)
    lines: list[str] = []
    t0 = time.time()
    empty_pages = 0
    for page_no in range(start, end + 1):
        page = doc[page_no - 1]
        pix = page.get_pixmap(dpi=args.dpi)
        result, _ = engine(pix.tobytes("png"))
        lines.append(f"===PAGE {page_no}===")
        if result:
            for box, text, score in result:
                if text and float(score) >= 0.4:  # 过滤低置信度
                    lines.append(text.strip())
        else:
            empty_pages += 1
        if page_no % 10 == 0 or page_no == end:
            el = time.time() - t0
            done = page_no - start + 1
            print(f"   {page_no}/{end} 页，用时 {el:.0f}s，速度 {el / done:.1f}s/页")

    doc.close()
    out = TEXT_DIR / f"{args.slug}.txt"
    out.write_text("\n".join(lines), encoding="utf-8")
    print(f"✅ 完成：{end - start + 1} 页（空页 {empty_pages}）→ {out}")


if __name__ == "__main__":
    main()
