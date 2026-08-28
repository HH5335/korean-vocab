# -*- coding: utf-8 -*-
"""分析 custom 词表解析率：词性分布 / 韩语行数 / 被丢弃的行样例"""
import re
from pathlib import Path

from extract_doc import extract

CUSTOM = Path(__file__).resolve().parents[2] / "data" / "custom"


def main():
    for name in ("topik3级单词.doc", "topik4级单词.doc"):
        runs = extract(CUSTOM / name)
        pos_dist: dict[str, int] = {}
        kor_lines = 0
        dropped = []
        i = 0
        while i < len(runs) - 1:
            line = runs[i].strip()
            if re.match(r"^[가-힣]", line) and not line.startswith("["):
                kor_lines += 1
                nxt = runs[i + 1].strip()
                pm = re.match(r"^\[([^\]]+)\]", nxt)
                if pm:
                    pos_dist[pm.group(1)] = pos_dist.get(pm.group(1), 0) + 1
                else:
                    dropped.append((line[:20], nxt[:30]))
            i += 1
        print(f"--- {name} ---")
        print(f"韩语行数: {kor_lines}")
        print(f"词性分布: {pos_dist}")
        print(f"未匹配到词性的样例 {len(dropped)} 个:")
        for d in dropped[:6]:
            print(f"  {d[0]} → 下一行: {d[1]}")


if __name__ == "__main__":
    main()
