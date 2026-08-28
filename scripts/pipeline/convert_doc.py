# -*- coding: utf-8 -*-
"""把 data/custom 下的 .doc 词表转成 UTF-8 文本（借助本机 Word，延迟绑定）
用法: .venv\\Scripts\\python convert_doc.py
"""
from pathlib import Path

import win32com.client as win32

CUSTOM = Path(__file__).resolve().parents[2] / "data" / "custom"


def main():
    word = win32.DispatchEx("Word.Application")
    try:
        word.Visible = False
        word.DisplayAlerts = 0
        files = list(CUSTOM.glob("*.doc"))
        if not files:
            print("❌ data/custom 下没有 .doc 文件")
            return
        for doc_file in files:
            out = doc_file.with_suffix(".txt")
            doc = word.Documents.Open(str(doc_file), ReadOnly=True)
            doc.SaveAs2(str(out), FileFormat=7)  # 7 = wdFormatUnicodeText
            doc.Close(False)
            print(f"✅ {doc_file.name} → {out.name} ({out.stat().st_size / 1024:.0f} KB)")
    finally:
        try:
            word.Quit()
        except Exception:
            pass


if __name__ == "__main__":
    main()
