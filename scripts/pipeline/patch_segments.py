# -*- coding: utf-8 -*-
"""
人工订正：基于 slice-inspect.txt 的词级时间戳，为 refine 失败/未改善的
长片段设置精确起止窗口（只含目标句）。保留原句文本不变。
用法（在 pipeline 目录）:
  .venv\\Scripts\\python patch_segments.py
"""
import json
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
TRANS_DIR = PROJECT_ROOT / "media" / "transcripts"

# (转录文件名, 原片段 start, 订正后 start, 订正后 end)
CORRECTIONS = [
    # EP.27
    ("2020 EP.27 (捉迷藏 1)", 1332.0, 1434.6, 1437.0),  # 오래 기다리셨죠?（기다리다，起点为 refine 后值）
    ("2020 EP.27 (捉迷藏 1)", 1708.1, 1724.9, 1725.7),  # 고생하셨습니다（고생하다，起点为 refine 后值）
    ("2020 EP.27 (捉迷藏 1)", 751.3, 768.4, 771.6),     # 우리 알려줘.（알리다）
    ("2020 EP.27 (捉迷藏 1)", 860.7, 878.2, 880.1),     # 메모 봤거든?（메모）
    ("2020 EP.27 (捉迷藏 1)", 305.5, 305.0, 306.7),     # 나가볼까?（나가다）
    ("2020 EP.27 (捉迷藏 1)", 1104.7, 1113.2, 1114.5),  # 정한이 형 입구로...（입구）
    ("2020 EP.27 (捉迷藏 1)", 205.2, 213.1, 215.3),     # 아 이런 거 하지 마.（말다）
    ("2020 EP.27 (捉迷藏 1)", 617.4, 619.6, 624.8),     # 회사 왔어, 회사도 있어（회사）
    ("2020 EP.27 (捉迷藏 1)", 1261.7, 1266.3, 1268.9),  # 이거 어떻게 꺼지? 불 끄고 싶어.（불）
    # 已 refine 过但窗口仍虚胖，按词级时间戳重订（起点是 refine 后的值）
    ("2020 EP.27 (捉迷藏 1)", 1147.2, 1153.8, 1155.1),  # 미안하고 고마워요（미안하다）
    # EP.45
    ("2020 EP.45 TTT 2 (超现实主义 Ver.)", 955.8, 1015.6, 1016.9),   # 형은 일어났다...（일어나다）
    ("2020 EP.45 TTT 2 (超现实主义 Ver.)", 822.9, 849.6, 853.0),     # 내 어깨 퐁 들어가지（어깨）
    ("2020 EP.45 TTT 2 (超现实主义 Ver.)", 305.6, 324.1, 325.0),     # 같이 불어 빨리 불어（불다）
    ("2020 EP.45 TTT 2 (超现实主义 Ver.)", 1819.9, 1830.7, 1833.2),  # 아 이쪽으로 탔어야 되는구나（이쪽）
    ("2020 EP.45 TTT 2 (超现实主义 Ver.)", 925.0, 931.1, 932.5),     # 야 친구.（친구）
    ("2020 EP.45 TTT 2 (超现实主义 Ver.)", 765.5, 773.2, 775.7),     # 야 야 눈 마주쳤잖아（눈，起点为 refine 后值）
]


def main():
    for stem, orig_start, new_start, new_end in CORRECTIONS:
        tj = TRANS_DIR / f"{stem}.json"
        segs = json.loads(tj.read_text(encoding="utf-8"))
        hit = None
        for s in segs:
            if abs(s["start"] - orig_start) < 0.3:
                hit = s
                break
        if hit is None:
            print(f"⚠️ 未找到 {stem} @ {orig_start}")
            continue
        old = f"{hit['start']}-{hit['end']}"
        hit["start"] = round(new_start, 2)
        hit["end"] = round(new_end, 2)
        tj.write_text(json.dumps(segs, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"✅ {stem} | {old} → {hit['start']}-{hit['end']} ({hit['end'] - hit['start']:.1f}s) | {hit['text'][:40]}")

    print("\n🎉 订正完成")


if __name__ == "__main__":
    main()
