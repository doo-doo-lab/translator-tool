import sqlite3
import os
import datetime
import time

db_path = os.path.expandvars(r"%APPDATA%\desktop\data.db")
print("DB:", db_path)

conn = sqlite3.connect(db_path)
cur = conn.cursor()

# 5 min in the past → definitely due
past = (datetime.datetime.utcnow() - datetime.timedelta(minutes=5)).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
marker = "AUMI_marker_" + str(int(time.time()))

cur.execute("""
  INSERT INTO wordbook (word, phonetic, definition, translation, source_sentence, review_count, next_review)
  VALUES (?, ?, ?, ?, ?, ?, ?)
""", (marker, "/test/", "AUMI verification", "AUMI 验证", "srs test", 0, past))
inserted_id = cur.lastrowid
conn.commit()
print(f"inserted id={inserted_id} word={marker} next_review={past}")

cur.execute("""
  SELECT id, word, review_count, next_review FROM wordbook
  WHERE next_review IS NOT NULL AND next_review <= datetime('now')
""")
rows = cur.fetchall()
print(f"due rows ({len(rows)}):")
for r in rows:
    print(" ", r)

conn.close()
