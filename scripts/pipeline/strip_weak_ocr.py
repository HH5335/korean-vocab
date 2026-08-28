# -*- coding: utf-8 -*-
"""把 ocr-report.txt 里弱证据（❓）句子的 quoteZh 清掉，只保留强证据（✅）翻译"""
import json
import sqlite3
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
MEDIA_DIR = PROJECT_ROOT / "media"
DB_PATH = PROJECT_ROOT / "server" / "prisma" / "dev.db"
MAPPINGS_JSON = MEDIA_DIR / "mappings.json"

weak_quotes = set()
for line in (MEDIA_DIR / "ocr-report.txt").read_text(encoding="utf-8").splitlines():
    if line.startswith("❓"):
        parts = line.split(" | ")
        if len(parts) >= 3:
            weak_quotes.add(parts[1])
print(f"🗑️ 弱证据句子: {len(weak_quotes)} 句")

conn = sqlite3.connect(DB_PATH, timeout=15)
conn.execute("PRAGMA busy_timeout=15000")
n = 0
for q in weak_quotes:
    cur = conn.execute(
        "UPDATE MediaMapping SET quoteZh=NULL WHERE sourceType='going' AND quote=?", (q,)
    )
    n += cur.rowcount
conn.commit()
conn.close()
print(f"数据库清理: {n} 条映射的 quoteZh 已清空")

data = json.loads(MAPPINGS_JSON.read_text(encoding="utf-8"))
m = 0
for x in data:
    if x["sourceType"] == "going" and x.get("quote") in weak_quotes and x.get("quoteZh"):
        x["quoteZh"] = None
        m += 1
MAPPINGS_JSON.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
print(f"mappings.json 清理: {m} 条")

left = sqlite3.connect(DB_PATH).execute(
    "SELECT COUNT(*) FROM MediaMapping WHERE quoteZh IS NOT NULL"
).fetchone()[0]
print(f"剩余有效翻译映射: {left}")