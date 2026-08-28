# -*- coding: utf-8 -*-
"""统计 mappings.json 中歌曲/综艺映射数量"""
import json
from collections import Counter

data = json.load(open(r"d:\visual studio code\code\korean-vocab\media\mappings.json", encoding="utf-8"))
c = Counter(x["sourceType"] for x in data)
print("total:", len(data), dict(c))
for t in ("song", "going"):
    q = [x["quote"] for x in data if x["sourceType"] == t]
    uq = set(q)
    print(t, "mappings:", len(q), "unique quotes:", len(uq))
