import sqlite3, os, datetime
db_path = os.path.expandvars(r"%APPDATA%\desktop\data.db")
conn = sqlite3.connect(db_path)
cur = conn.cursor()

# Match JS new Date().toISOString() format: 2026-05-16T05:42:00.000Z
now = datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S.") + f"{datetime.datetime.utcnow().microsecond // 1000:03d}Z"
print(f"now (JS-style): {now}")

cur.execute("""
  SELECT id, word, review_count, next_review FROM wordbook
  WHERE next_review IS NOT NULL AND next_review <= ?
""", (now,))
rows = cur.fetchall()
print(f"due rows ({len(rows)}):")
for r in rows:
    print(" ", r)

# All rows
cur.execute("SELECT id, word, review_count, next_review FROM wordbook")
all_rows = cur.fetchall()
print(f"\nall rows ({len(all_rows)}):")
for r in all_rows:
    print(" ", r)
conn.close()
