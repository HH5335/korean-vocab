# -*- coding: utf-8 -*-
"""GPU 诊断：验证 CUDA DLL + Whisper 模型 + 试转录 20 秒
用法: .venv\\Scripts\\python check_gpu.py [媒体文件路径]
"""
import os
import sys
import time
from pathlib import Path

os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")
os.environ.setdefault("HF_HUB_DISABLE_XET", "1")

_nvidia_root = Path(sys.prefix) / "Lib" / "site-packages" / "nvidia"
_dll_dirs = []
for _pkg in ("cudnn", "cublas", "cuda_nvrtc"):
    _bin = _nvidia_root / _pkg / "bin"
    if _bin.exists():
        _dll_dirs.append(str(_bin))
        try:
            os.add_dll_directory(str(_bin))
        except OSError:
            pass
if _dll_dirs:
    os.environ["PATH"] = os.pathsep.join(_dll_dirs) + os.pathsep + os.environ.get("PATH", "")

from faster_whisper import WhisperModel  # noqa: E402

target = sys.argv[1] if len(sys.argv) > 1 else None
if target:
    print(f"🎯 试转录: {target}（前 20 秒）")
else:
    print("🎯 仅测试模型加载（不带参数时）")

t0 = time.time()
model = WhisperModel("large-v3", device="cuda", compute_type="float16")
print(f"✅ CUDA 模型加载成功，耗时 {time.time()-t0:.1f} 秒")

if target:
    segments, info = model.transcribe(target, language="ko", vad_filter=True, condition_on_previous_text=False)
    print(f"   检测语言: {info.language} ({info.language_probability:.2f})")
    t1 = time.time()
    count = 0
    for seg in segments:
        print(f"   [{seg.start:6.1f} → {seg.end:6.1f}] {seg.text.strip()}")
        count += 1
        if seg.end > 20:
            break
    print(f"✅ 试转录 OK：{count} 段，耗时 {time.time()-t1:.1f} 秒")
