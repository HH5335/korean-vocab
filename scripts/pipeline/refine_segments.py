# -*- coding: utf-8 -*-
"""
阶段 1.5：转录长片段精确定位
问题：GOING 综艺里 Whisper 会把"一句话 + 长时间音乐/笑声/反应"合成一个长片段
      （如 [0.94s - 36.9s] 只有一句话），导致播放时带上前后句。
方案：对时长超过阈值的片段，单独切出音频，用词级时间戳（word_timestamps）
      重新转录该切片，在切片内定位原句的精确起止，替换原片段时间窗口。
用法（在 pipeline 目录）:
  .venv\\Scripts\\python refine_segments.py [--threshold 5.0] [--dry-run]
输入: media/transcripts/*.json + media/songs|going/*.mp4
输出: 更新 media/transcripts/*.json（原文件备份到 media/transcripts_backup/）
      + refine-report.txt（人审报告）
"""
import argparse
import difflib
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

# HuggingFace 镜像（国内直连会超时）
os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")
# 禁用 Xet 下载协议（hf-mirror 不支持，会 401）
os.environ.setdefault("HF_HUB_DISABLE_XET", "1")

# CUDA DLL 加载路径（同 transcribe.py）
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
TRANS_DIR = MEDIA_DIR / "transcripts"
BACKUP_DIR = MEDIA_DIR / "transcripts_backup"

# 只保留韩文/数字/字母，用于文本匹配（去掉空格标点）
NORM_RE = re.compile(r"[^가-힣0-9a-zA-Z]")


def norm(s: str) -> str:
    return NORM_RE.sub("", s)


def find_media_by_stem(stem: str):
    for sub in ("songs", "going"):
        for ext in (".mp4", ".mp3", ".m4a", ".mkv", ".webm", ".wav", ".flv"):
            p = MEDIA_DIR / sub / f"{stem}{ext}"
            if p.exists():
                return p
    return None


def extract_slice(media: Path, start: float, end: float, wav: Path) -> bool:
    """切出 [start-0.5, end+0.5] 的 16kHz 单声道音频"""
    cmd = [
        "ffmpeg", "-y", "-loglevel", "error",
        "-ss", f"{max(0.0, start - 0.5):.2f}", "-to", f"{end + 0.5:.2f}",
        "-i", str(media), "-vn", "-ac", "1", "-ar", "16000",
        str(wav),
    ]
    r = subprocess.run(cmd, check=False)
    return r.returncode == 0 and wav.exists() and wav.stat().st_size > 1000


def sub_word_span(sub) -> tuple[float, float]:
    """子段的词级起止；无词数据时退回子段起止"""
    ws, we = sub.start, sub.end
    if getattr(sub, "words", None):
        words = [w for w in sub.words if w.word.strip()]
        if words:
            ws, we = words[0].start, words[-1].end
    return ws, we


def main():
    parser = argparse.ArgumentParser(description="长片段精确定位")
    parser.add_argument("--threshold", type=float, default=5.0, help="超过多少秒的片段需要精确定位")
    parser.add_argument("--device", default="auto")
    parser.add_argument("--model", default="large-v3")
    parser.add_argument("--dry-run", action="store_true", help="只列候选片段，不转录不写文件")
    args = parser.parse_args()

    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    report_lines = []
    refined_total = 0
    failed_total = 0

    trans_files = sorted(TRANS_DIR.glob("*.json"))
    print(f"🎯 检查 {len(trans_files)} 个转录文件（阈值 {args.threshold}s）")

    if not args.dry_run:
        from faster_whisper import WhisperModel

        print(f"⏳ 加载模型 {args.model} ...")
        model = WhisperModel(args.model, device=args.device, compute_type="float16")

    for tj in trans_files:
        segs = json.loads(tj.read_text(encoding="utf-8"))
        media = find_media_by_stem(tj.stem)
        if media is None:
            print(f"⚠️ {tj.name}: 找不到对应媒体文件，跳过")
            continue

        candidates = [s for s in segs if (s["end"] - s["start"]) > args.threshold]
        print(f"\n📄 {tj.name}: {len(segs)} 段，候选 {len(candidates)} 段")
        if not candidates:
            continue

        if args.dry_run:
            for s in candidates:
                print(f"  [{s['start']:.1f}s - {s['end']:.1f}s] ({s['end'] - s['start']:.1f}s) {s['text'][:50]}")
            continue

        # 备份原转录
        backup = BACKUP_DIR / tj.name
        if not backup.exists():
            shutil.copy2(tj, backup)

        new_segs = []
        changed = 0
        for s in segs:
            dur = s["end"] - s["start"]
            if dur <= args.threshold:
                new_segs.append(s)
                continue

            orig_n = norm(s["text"])
            if len(orig_n) < 3:
                # 文本太短无法可靠匹配，保持原样
                new_segs.append(s)
                report_lines.append(f"跳过（文本太短）| {tj.stem} | {s['start']:.1f}-{s['end']:.1f} | {s['text']}")
                continue

            wav = BACKUP_DIR / "_slice.wav"
            if not extract_slice(media, s["start"], s["end"], wav):
                new_segs.append(s)
                failed_total += 1
                report_lines.append(f"失败（切片失败）| {tj.stem} | {s['start']:.1f}-{s['end']:.1f} | {s['text']}")
                continue

            try:
                sub_segs, _info = model.transcribe(
                    str(wav),
                    language="ko",
                    beam_size=5,
                    word_timestamps=True,
                    vad_filter=True,
                    vad_parameters={"min_silence_duration_ms": 300},
                    condition_on_previous_text=False,
                )
                subs = list(sub_segs)
            except Exception as e:
                subs = []
                print(f"  ⚠️ 切片转录异常: {e}")
            finally:
                wav.unlink(missing_ok=True)

            # 在切片子段中找覆盖原句的连续区间（标准化文本匹配 + 模糊兜底）
            sub_norms = [norm(x.text) for x in subs if x.text.strip()]
            usable = [x for x in subs if x.text.strip()]
            best = None  # (ratio, i, j)
            for i in range(len(usable)):
                acc = ""
                for j in range(i, min(len(usable), i + 6)):
                    acc += sub_norms[j]
                    if len(acc) > len(orig_n) + 25:
                        break
                    ratio = difflib.SequenceMatcher(None, orig_n, acc).ratio()
                    if orig_n in acc:
                        ratio = max(ratio, 0.99)
                    if best is None or ratio > best[0]:
                        best = (ratio, i, j)
                    if orig_n in acc:
                        break
                if best and best[0] >= 0.99 and best[0] > 0:
                    break

            if not usable or best is None or best[0] < 0.9:
                new_segs.append(s)
                failed_total += 1
                report_lines.append(
                    f"失败（未定位）| {tj.stem} | {s['start']:.1f}-{s['end']:.1f} | {s['text']} | 切片段数 {len(usable)}"
                )
                continue

            _r, i, j = best
            run = usable[i : j + 1]
            ws, we = sub_word_span(run[0])
            for k in range(1, len(run)):
                _w2s, w2e = sub_word_span(run[k])
                we = w2e
            offset = s["start"] - 0.5
            ws += offset
            we += offset
            span = we - ws

            if span <= 9.0 or len(run) == 1:
                # 原句区间紧（含多子段合并），用原文本 + 精确起止替换
                new_segs.append({"start": round(ws, 2), "end": round(we, 2), "text": s["text"]})
            else:
                # 多句相距较远：逐子段拆开（文本用子段自己的）
                for x in run:
                    x_ws, x_we = sub_word_span(x)
                    x_ws += offset
                    x_we += offset
                    new_segs.append({"start": round(x_ws, 2), "end": round(x_we, 2), "text": x.text.strip()})

            changed += 1
            refined_total += 1
            report_lines.append(
                f"✅ {tj.stem} | {s['start']:.1f}-{s['end']:.1f} ({dur:.1f}s) → {ws:.1f}-{we:.1f} ({span:.1f}s) | {s['text'][:60]}"
            )
            print(f"  ✅ [{s['start']:.1f}-{s['end']:.1f}] ({dur:.1f}s) → [{ws:.1f}-{we:.1f}] ({span:.1f}s) {s['text'][:50]}")

        if changed:
            new_segs.sort(key=lambda x: x["start"])
            tj.write_text(json.dumps(new_segs, ensure_ascii=False, indent=1), encoding="utf-8")
            print(f"  💾 {tj.name}: 精确定位 {changed} 段，已写回（原文件备份在 transcripts_backup/）")

    report_path = BACKUP_DIR / "refine-report.txt"
    report_path.write_text("\n".join(report_lines) or "（无）", encoding="utf-8")
    print(f"\n🎉 完成：精确定位 {refined_total} 段，失败/跳过 {failed_total} 段")
    print(f"   报告: {report_path}")


if __name__ == "__main__":
    main()
