# -*- coding: utf-8 -*-
"""四源合并 + 去重 + 例句三态判定 → data/pdf-books/extracted/merged.json
优先级（先到先得，PDF 书最优先）：PDF 书 CSV → custom/parsed.json → 延世 1~6 → TOPIK 官方词表
- 去重键：韩语词空白归一化；同词不覆盖主来源，字段缺失回填，来源追加
- 例句三态：视频（mappings.json 命中）> 书例句 > AI（ai-examples.json）> 待AI
用法: .venv\\Scripts\\python merge_vocab.py
"""
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from pdf_common import (  # noqa: E402
    AI_EXAMPLES, DATA, EXTRACTED, MEDIA_MAPPINGS, MERGED_JSON,
    norm_key, normalize_pos, read_csv_robust,
)


def load_video_index() -> dict[str, dict]:
    """mappings.json → {norm_key: {quote, sourceName}}"""
    if not MEDIA_MAPPINGS.exists():
        print("⚠️  缺少 media/mappings.json，视频例句判定跳过")
        return {}
    rows = json.loads(MEDIA_MAPPINGS.read_text(encoding="utf-8"))
    index: dict[str, dict] = {}
    for r in rows:
        h = (r.get("hangul") or "").strip()
        q = (r.get("quote") or "").strip()
        if not h or not q:
            continue
        k = norm_key(h)
        if k not in index:
            index[k] = {"quote": q, "sourceName": r.get("sourceName", "")}
    return index


def load_ai_examples() -> dict[str, dict]:
    if not AI_EXAMPLES.exists():
        return {}
    data = json.loads(AI_EXAMPLES.read_text(encoding="utf-8-sig"))
    return {k: v for k, v in data.items() if k != "_meta" and isinstance(v, dict)}


def main():
    merged: dict[str, dict] = {}
    conflicts: list[dict] = []
    order = 0
    stats = {"pdf": 0, "custom": 0, "yonsei": 0, "topik": 0}

    def put(hangul: str, meaning: str, pos: str | None, primary: str, source_label: str,
            ref: dict | None = None, note: str = "", example_ko: str = "", example_zh: str = ""):
        """先到先得：已存在的 key 不覆盖，来源追加，主字段缺失回填，释义冲突记录"""
        nonlocal order
        key = norm_key(hangul)
        rec = merged.get(key)
        if rec is None:
            order += 1
            merged[key] = {
                "key": key, "hangul": hangul.strip(), "pos": pos or "", "meaning_cn": meaning or "",
                "sources": [source_label], "primary": primary, "ref": ref or {},
                "order": order, "example_ko": example_ko, "example_zh": example_zh,
                "example_src": "", "note": note,
            }
            return
        # 回填缺失字段
        if not rec["meaning_cn"] and meaning:
            rec["meaning_cn"] = meaning
        if not rec["pos"] and pos:
            rec["pos"] = pos
        if not rec["example_ko"] and example_ko:
            rec["example_ko"], rec["example_zh"] = example_ko, example_zh
        if source_label not in rec["sources"]:
            rec["sources"].append(source_label)
        # 释义冲突（主来源有释义且不同）
        if rec["meaning_cn"] and meaning and meaning != rec["meaning_cn"]:
            conflicts.append({
                "key": key, "hangul": rec["hangul"],
                "primary": rec["primary"], "primary_meaning": rec["meaning_cn"],
                "other_source": source_label, "other_meaning": meaning,
            })

    # ---------- 0. TOPIK 1/2级新词表（最高优先：重复词以新词表为准） ----------
    parsed = DATA / "custom" / "parsed.json"
    topik12_entries: list[dict] = []
    if parsed.exists():
        topik12_entries = [
            e for e in json.loads(parsed.read_text(encoding="utf-8"))
            if e.get("book") == "TOPIK 初级词表"
        ]
    for e in topik12_entries:
        put(e["hangul"], e.get("meaningCn", ""), normalize_pos(e.get("pos")),
            "topik12", "TOPIK 1/2级词表(新)",
            example_ko=e.get("exampleKo", ""), example_zh=e.get("exampleZh", ""))
    stats["topik12"] = len(topik12_entries)
    print(f"🆕 TOPIK 1/2级词表(新): {stats['topik12']} 词")

    # ---------- 1. PDF 书（最优先） ----------
    for csv_path in sorted(EXTRACTED.glob("*.csv")):
        book = csv_path.stem
        rows = read_csv_robust(csv_path)
        if not rows:
            continue
        header = rows[0]
        idx = {name: header.index(name) for name in ("hangul", "pos", "meaning_cn", "example_ko", "example_zh", "status", "page", "seq", "note")}
        cnt = 0
        for r in rows[1:]:
            if not r or not r[0]:
                continue
            hangul = r[idx["hangul"]].strip()
            if not hangul:
                continue
            if r[idx["status"]].strip().lower() == "delete":
                continue
            put(
                hangul,
                r[idx["meaning_cn"]].strip(),
                normalize_pos(r[idx["pos"]].strip()),
                f"pdf:{book}", book,
                ref={"page": r[idx["page"]].strip(), "seq": r[idx["seq"]].strip()},
                note=r[idx["note"]].strip(),
                example_ko=r[idx["example_ko"]].strip(),
                example_zh=r[idx["example_zh"]].strip(),
            )
            cnt += 1
        stats["pdf"] += cnt
        print(f"📗 {book}: {cnt} 词")

    # ---------- 2. custom/parsed.json（人工校对过的 TOPIK 词表；初级词条已在第 0 步处理） ----------
    if parsed.exists():
        custom_entries = [
            e for e in json.loads(parsed.read_text(encoding="utf-8"))
            if e.get("book") != "TOPIK 初级词表"
        ]
        for e in custom_entries:
            put(e["hangul"], e.get("meaningCn", ""), normalize_pos(e.get("pos")),
                "custom", e.get("book") or "custom",
                example_ko=e.get("exampleKo", ""), example_zh=e.get("exampleZh", ""))
        stats["custom"] = len(custom_entries)
        print(f"📕 custom/parsed.json: {stats['custom']} 词")

    # ---------- 3. 延世 1~6 ----------
    for vol in range(1, 7):
        p = DATA / f"yonsei-vol-{vol}.csv"
        if not p.exists():
            print(f"⚠️  缺少 {p.name}，跳过")
            continue
        rows = read_csv_robust(p)
        header = rows[0]
        idx = {name: header.index(name) for name in ("korean", "chinese", "english", "pos", "pos_zh", "chapter", "unit")}
        cnt = 0
        for r in rows[1:]:
            if not r or not r[0]:
                continue
            hangul = r[idx["korean"]].strip()
            if not hangul:
                continue
            meaning = r[idx["chinese"]].strip() or r[idx["english"]].strip() or "(待补充释义)"
            put(hangul, meaning,
                normalize_pos(r[idx["pos"]].strip()) or normalize_pos(r[idx["pos_zh"]].strip()),
                f"yonsei:{vol}", f"延世韩国语 {vol}",
                ref={"chapter": r[idx["chapter"]].strip(), "unit": r[idx["unit"]].strip()})
            cnt += 1
        stats["yonsei"] += cnt
        print(f"📘 延世韩国语 {vol}: {cnt} 词")

    # ---------- 4. TOPIK 官方词表（释义为韩语 explanation） ----------
    topik = DATA / "topik-results.tsv"
    if topik.exists():
        rows = [line.split("\t") for line in topik.read_text(encoding="utf-8-sig").splitlines()]
        header = rows[0]
        idx = {name: header.index(name) for name in ("word", "explanation", "part_of_speech", "rank", "nikl_level", "topik_level")}
        cnt = 0
        for r in rows[1:]:
            if not r or not r[0]:
                continue
            hangul = r[idx["word"]].strip()
            if not hangul:
                continue
            lvl = r[idx["topik_level"]].strip() or r[idx["nikl_level"]].strip()
            if lvl in ("A", "초급"):
                continue  # 初级已被新 1/2级词表替换，官方韩语释义不再进入汇总
            label = f"TOPIK 官方词表({lvl})" if lvl else "TOPIK 官方词表"
            put(hangul, r[idx["explanation"]].strip() or "(待补充释义)",
                normalize_pos(r[idx["part_of_speech"]].strip()), "topik", label,
                ref={"rank": r[idx["rank"]].strip()},
                note="韩语释义")
            cnt += 1
        stats["topik"] = cnt
        print(f"📙 TOPIK 官方词表: {cnt} 词")

    # ---------- 例句三态判定（视频 > 书 > AI > 待AI） ----------
    video = load_video_index()
    ai = load_ai_examples()
    counts = {"视频": 0, "书": 0, "AI": 0, "待AI": 0}
    for rec in merged.values():
        if rec["key"] in video:
            v = video[rec["key"]]
            rec["example_ko"] = v["quote"]
            rec["example_zh"] = ""
            rec["example_src"] = "视频"
            rec["note"] = (rec["note"] + "；" if rec["note"] else "") + f"视频:{v['sourceName']}"
        elif rec["example_ko"]:
            rec["example_src"] = "书"
        elif rec["key"] in ai:
            rec["example_ko"] = ai[rec["key"]]["ko"]
            rec["example_zh"] = ai[rec["key"]].get("zh", "")
            rec["example_src"] = "AI"
        else:
            rec["example_src"] = "待AI"
        counts[rec["example_src"]] += 1

    MERGED_JSON.write_text(
        json.dumps(list(merged.values()), ensure_ascii=False, indent=1), encoding="utf-8")

    print("\n" + "=" * 60)
    print(f"🎉 合并完成 → {MERGED_JSON}")
    print(f"   总词数 {len(merged)}（PDF {stats['pdf']} + custom {stats['custom']} + 延世 {stats['yonsei']} + TOPIK {stats['topik']}）")
    print(f"   释义冲突 {len(conflicts)} 组")
    print(f"   例句: 视频 {counts['视频']} | 书 {counts['书']} | AI {counts['AI']} | 待AI {counts['待AI']}")
    (EXTRACTED / "conflicts.json").write_text(
        json.dumps(conflicts, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
