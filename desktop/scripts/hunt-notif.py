"""Search wpndatabase for any handler containing 'translator' or 'internal' or the marker word."""
import sqlite3, os, shutil, tempfile
src = os.path.expandvars(r"%LOCALAPPDATA%\Microsoft\Windows\Notifications\wpndatabase.db")
tmp = os.path.join(tempfile.gettempdir(), "wpn-hunt.db")
shutil.copy2(src, tmp)
conn = sqlite3.connect(f"file:{tmp}?mode=ro", uri=True)
cur = conn.cursor()

# Schema
print("=== Tables ===")
for row in cur.execute("SELECT name FROM sqlite_master WHERE type='table'"):
    print(" ", row[0])

print("\n=== NotificationHandler columns ===")
for row in cur.execute("PRAGMA table_info(NotificationHandler)"):
    print(" ", row)

print("\n=== Recent NotificationHandler entries (any field LIKE %translator% or %internal%) ===")
cur.execute("""
SELECT RecordId, PrimaryId, WNFEventName, HandlerType, ParentId
FROM NotificationHandler
WHERE PrimaryId LIKE '%translator%' OR PrimaryId LIKE '%internal%'
   OR WNFEventName LIKE '%translator%' OR HandlerType LIKE '%translator%'
""")
rows = cur.fetchall()
print(f"  count = {len(rows)}")
for r in rows:
    print(" ", r)

print("\n=== ALL NotificationHandler rows where the app might be ===")
cur.execute("SELECT RecordId, PrimaryId, HandlerType FROM NotificationHandler ORDER BY RecordId DESC LIMIT 5")
for r in cur.fetchall():
    print(" ", r)

# Check WNS subscription / package family table
print("\n=== Notification table columns ===")
for row in cur.execute("PRAGMA table_info(Notification)"):
    print(" ", row)

# Newest 5 with payload preview
print("\n=== Newest 5 Notification rows with payload preview ===")
cur.execute("""
SELECT NotificationHandler.PrimaryId, Notification.ArrivalTime, hex(substr(Notification.Payload, 1, 80))
FROM Notification
JOIN NotificationHandler ON Notification.HandlerId = NotificationHandler.RecordId
ORDER BY Notification.ArrivalTime DESC LIMIT 5
""")
for r in cur.fetchall():
    pid, arrival, payload_hex = r
    print(f"  {pid}  {arrival}")
    if payload_hex:
        # Decode hex
        try:
            decoded = bytes.fromhex(payload_hex).decode('utf-8', errors='replace')
            print(f"    payload: {decoded[:100]}")
        except Exception:
            print(f"    payload-hex: {payload_hex[:80]}")

conn.close()
