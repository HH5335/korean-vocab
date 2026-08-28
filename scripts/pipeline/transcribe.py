# -*- coding: utf-8 -*-
"""
阶段 1：媒体文件 → 带时间戳的韩语转录 JSON
用法（在 pipeline 目录）:
  .venv\\Scripts\\python transcribe.py [--model large-v3] [--device auto]
输出: media/transcripts/<文件名>.json
  [{ "start": 0.0, "end": 4.2, "text": "기분 기분 기분이 좋아져" }, ...]
"""
import argparse
import json
import os
import sys
import time
from pathlib import Path

# HuggingFace 镜像（国内直连会超时）
os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")
# 禁用 Xet 下载协议（hf-mirror 不支持，会 401）
os.environ.setdefault("HF_HUB_DISABLE_XET", "1")

# CUDA DLL 加载路径（pip 装的 nvidia-cudnn/cublas 位于 site-packages/nvidia/*/bin）
# 双保险：add_dll_directory + 注入 PATH（ctranslate2 的 LoadLibrary 走 PATH 搜索）
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

PROJECT_ROOT = Path(__file__).resolve().parents[2]
MEDIA_DIR = PROJECT_ROOT / "media"
OUT_DIR = MEDIA_DIR / "transcripts"

MEDIA_TYPES = {".mp4", ".mp3", ".m4a", ".mkv", ".webm", ".wav", ".flv"}


def extract_audio(media_path: Path, wav_path: Path):
    """ffmpeg 提取 16kHz 单声道 wav（Whisper 标准输入）"""
    import subprocess

    cmd = [
        "ffmpeg", "-y", "-loglevel", "error",
        "-i", str(media_path),
        "-ac", "1", "-ar", "16000",
        str(wav_path),
    ]
    subprocess.run(cmd, check=True)


def main():
    parser = argparse.ArgumentParser(description="媒体 → 韩语转录")
    parser.add_argument("--model", default="large-v3", help="Whisper 模型名（large-v3/medium/small）")
    parser.add_argument("--device", default="auto", help="auto/cuda/cpu")
    parser.add_argument("--files", nargs="*", help="指定文件；缺省扫描 media/songs 和 media/going")
    parser.add_argument("--max-minutes", type=int, default=0, help="只转录前 N 分钟（调试用，0=全部）")
    parser.add_argument("--no-vad", action="store_true", help="关闭语音检测（歌曲带背景音乐时用）")
    parser.add_argument("--force", action="store_true", help="已有转录也重新生成")
    args = parser.parse_args()

    # 收集输入文件
    files: list[Path] = []
    if args.files:
        files = [Path(f).resolve() for f in args.files]
    else:
        for sub in ("songs", "going"):
            d = MEDIA_DIR / sub
            if d.is_dir():
                files += sorted(p for p in d.iterdir() if p.suffix.lower() in MEDIA_TYPES)
    if not files:
        print("❌ 没有找到媒体文件（请放入 media/songs 或 media/going）")
        sys.exit(1)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    print(f"🎯 待转录 {len(files)} 个文件")

    from faster_whisper import WhisperModel

    print(f"⏳ 加载模型 {args.model}（首次会自动下载约 3GB，请耐心等待）...")
    model = WhisperModel(args.model, device=args.device, compute_type="float16")

    for i, media in enumerate(files, 1):
        out_json = OUT_DIR / f"{media.stem}.json"
        if not args.force and out_json.exists() and out_json.stat().st_size > 10:
            print(f"[{i}/{len(files)}] ⏭ 已存在转录: {out_json.name}")
            continue

        wav = OUT_DIR / f"{media.stem}.wav"
        print(f"[{i}/{len(files)}] 🎬 {media.name}")
        print(f"  → 提取音频...")
        extract_audio(media, wav)

        print(f"  → Whisper 转录中（语言: ko）...")
        t0 = time.time()
        segments, info = model.transcribe(
            str(wav),
            language="ko",
            beam_size=5,
            vad_filter=not args.no_vad,
            vad_parameters={"min_silence_duration_ms": 500},
            condition_on_previous_text=False,
        )
        results = []
        for seg in segments:
            text = seg.text.strip()
            if not text:
                continue
            if args.max_minutes and seg.end > args.max_minutes * 60:
                break
            results.append({"start": round(seg.start, 2), "end": round(seg.end, 2), "text": text})
        elapsed = time.time() - t0

        out_json.write_text(
            json.dumps(results, ensure_ascii=False, indent=1), encoding="utf-8"
        )
        wav.unlink(missing_ok=True)  # 转录完删除大 wav
        print(f"  ✅ {len(results)} 段，耗时 {elapsed/60:.1f} 分钟 → {out_json.name}")

    print("\n🎉 转录全部完成！接下来运行 match_words.py 做词表匹配")


if __name__ == "__main__":
    main()
