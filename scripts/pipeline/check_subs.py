# -*- coding: utf-8 -*-
"""检查 GOING 视频截帧里是否有内嵌字幕（中文/韩文），确认 OCR 翻译方案的可行性"""
import sys
from rapidocr_onnxruntime import RapidOCR

FRAMES = [
    r"d:\visual studio code\code\korean-vocab\media\_frame_check\f1s.jpg",
    r"d:\visual studio code\code\korean-vocab\media\_frame_check\f2s.jpg",
    r"d:\visual studio code\code\korean-vocab\media\_frame_check\f3s.jpg",
]

ocr = RapidOCR()
for f in FRAMES:
    result, _ = ocr(f)
    print("=== " + f.split("\\")[-1] + " ===")
    if not result:
        print("  (no text)")
        continue
    for box, text, score in result:
        ys = [p[1] for p in box]
        y = sum(ys) / 4
        print(f"  y={y:.0f} score={score:.2f}  {text}")
