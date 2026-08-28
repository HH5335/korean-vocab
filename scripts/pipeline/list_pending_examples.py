# -*- coding: utf-8 -*-
"""输出待 AI 生成例句的单词清单（供 Claude 会话分批生成）
用法: .venv\\Scripts\\python list_pending_examples.py [--limit 100] [--book 书slug]
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from pdf_common import MERGED_JSON, read_json_robust  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0, help="只输出前 N 个（0=全部）")
    ap.add_argument("--book", type=str, default="", help="只看某本 PDF 书的词（slug）")
    args = ap.parse_args()

    if not MERGED_JSON.exists():
        print("⚠️  缺少 merged.json，先运行 merge_vocab.py")
        return
    pending = [r for r in read_json_robust(MERGED_JSON) if r["example_src"] == "待AI"]
    if args.book:
        pending = [r for r in pending if r["primary"] == f"pdf:{args.book}"]
    if args.limit:
        pending = pending[: args.limit]

    print(f"待 AI 生成例句：{len(pending)} 个")
    print("hangul | pos | meaning")
    for r in pending:
        print(f"{r['hangul']} | {r['pos']} | {r['meaning_cn'][:40]}")


if __name__ == "__main__":
    main()
