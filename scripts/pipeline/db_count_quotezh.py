# -*- coding: utf-8 -*-
"""查看 quoteZh 填充进度"""
import sqlite3

conn = sqlite3.connect(r"d:\visual studio code\code\korean-vocab\server\prisma\dev.db", timeout=10)
n = conn.execute("SELECT COUNT(*) FROM MediaMapping WHERE quoteZh IS NOT NULL").fetchone()[0]
t = conn.execute("SELECT COUNT(*) FROM MediaMapping").fetchone()[0]
g = conn.execute("SELECT COUNT(*) FROM MediaMapping WHERE sourceType='going' AND quoteZh IS NOT NULL").fetchone()[0]
s = conn.execute("SELECT COUNT(*) FROM MediaMapping WHERE sourceType='song' AND quoteZh IS NOT NULL").fetchone()[0]
print(f"quoteZh 已填: {n} / {t}（going {g}，song {s}）")
conn.close()
