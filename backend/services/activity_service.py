import datetime
from auth import db
from flask import request

PREVIEW_DEDUP_SECONDS = 300  # 5 min – skip duplicate preview logs


def log_activity(owner_id, doc_id, client_id, firebase_path, filename,
                 doc_type, action, client_name="", extra=None):
    now = datetime.datetime.now()

    if action == "preview":
        cutoff = now - datetime.timedelta(seconds=PREVIEW_DEDUP_SECONDS)
        dup = db.activity.find_one({
            "owner_id": owner_id,
            "doc_id":   doc_id,
            "action":   "preview",
            "accessed_at": {"$gte": cutoff}
        })
        if dup:
            return

    entry = {
        "owner_id":      owner_id,
        "doc_id":        doc_id,
        "client_id":     str(client_id),
        "firebase_path": firebase_path,
        "filename":      filename,
        "type":          doc_type,
        "action":        action,
        "client_name":   client_name,
        "accessed_at":   now,
    }
    try:
        entry["ip"] = request.remote_addr or ""
        entry["user_agent"] = (request.headers.get("User-Agent") or "")[:200]
    except RuntimeError:
        pass
    if extra and isinstance(extra, dict):
        entry.update(extra)
    db.activity.insert_one(entry)
