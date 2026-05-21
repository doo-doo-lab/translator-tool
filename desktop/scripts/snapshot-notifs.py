"""
Snapshot Windows Notification database — list handler_ids that have notifications.
Used to compare pre/post SRS tick to see if 翻译工具 notification fired with correct AUMI.
"""
import sqlite3, os, sys, shutil, tempfile

src = os.path.expandvars(r"%LOCALAPPDATA%\Microsoft\Windows\Notifications\wpndatabase.db")

# Copy because Windows holds an exclusive lock
tmp = os.path.join(tempfile.gettempdir(), "wpn-snapshot.db")
try:
    shutil.copy2(src, tmp)
except PermissionError:
    # Try with SQLite URI immutable mode
    pass

conn = sqlite3.connect(f"file:{tmp}?mode=ro", uri=True)
cur = conn.cursor()

# List notification handlers and their notification counts
print("=== HandlerId distribution ===")
cur.execute("""
SELECT NotificationHandler.PrimaryId, COUNT(Notification.[Order]) AS cnt
FROM NotificationHandler
LEFT JOIN Notification ON NotificationHandler.RecordId = Notification.HandlerId
GROUP BY NotificationHandler.PrimaryId
ORDER BY cnt DESC, NotificationHandler.PrimaryId
""")
for pid, cnt in cur.fetchall():
    marker = "  <--" if (pid and "translator-tool" in pid) else ""
    print(f"  {cnt:4d}  {pid}{marker}")

print("\n=== Newest 8 Notifications ===")
cur.execute("""
SELECT NotificationHandler.PrimaryId, Notification.ArrivalTime
FROM Notification
JOIN NotificationHandler ON Notification.HandlerId = NotificationHandler.RecordId
ORDER BY Notification.ArrivalTime DESC LIMIT 8
""")
for pid, arrival in cur.fetchall():
    print(f"  arrived={arrival}  handler={pid}")

conn.close()
