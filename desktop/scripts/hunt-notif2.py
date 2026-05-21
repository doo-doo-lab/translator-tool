"""Find ANY NotificationHandler entry created in the last 10 minutes — see if the SRS notification registered ANYWHERE."""
import sqlite3, os, shutil, tempfile, datetime
src = os.path.expandvars(r"%LOCALAPPDATA%\Microsoft\Windows\Notifications\wpndatabase.db")
tmp = os.path.join(tempfile.gettempdir(), "wpn-hunt2.db")
shutil.copy2(src, tmp)
conn = sqlite3.connect(f"file:{tmp}?mode=ro", uri=True)
cur = conn.cursor()

print("=== ALL NotificationHandler ordered by ModifiedTime DESC ===")
cur.execute("SELECT RecordId, PrimaryId, HandlerType, CreatedTime, ModifiedTime FROM NotificationHandler ORDER BY ModifiedTime DESC LIMIT 15")
for r in cur.fetchall():
    print(f"  RecordId={r[0]:4d} type={r[2]:<25} created={r[3]} modified={r[4]}")
    print(f"           PrimaryId={r[1]}")

print("\n=== Notification rows for newest 5 handlers ===")
cur.execute("""
SELECT NotificationHandler.PrimaryId, Notification.Type, Notification.ArrivalTime, length(Notification.Payload)
FROM Notification
JOIN NotificationHandler ON Notification.HandlerId = NotificationHandler.RecordId
ORDER BY Notification.ArrivalTime DESC LIMIT 15
""")
for r in cur.fetchall():
    handler, ntype, arrival, plen = r
    # Windows FILETIME → unix
    if arrival:
        try:
            # FILETIME 100ns since 1601-01-01
            arrival_dt = datetime.datetime(1601,1,1) + datetime.timedelta(microseconds=arrival/10)
            arrival_str = arrival_dt.strftime("%Y-%m-%d %H:%M:%S")
        except:
            arrival_str = str(arrival)
    else:
        arrival_str = "(none)"
    print(f"  {arrival_str}  {ntype:<10} payload_len={plen}  handler={handler}")
conn.close()
