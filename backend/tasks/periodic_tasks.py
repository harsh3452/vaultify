"""
Periodic (Celery Beat) tasks for Vaultify.

Runs on a schedule to retry documents that are stuck in "pending" or "failed"
status because the AI was unreachable at the time of initial processing.
"""
import datetime
try:
    from backend.celery_app import celery
except ModuleNotFoundError:
    from celery_app import celery
from auth import db


@celery.task(bind=True)
def retry_stuck_documents(self):
    """Beat task — retry all pending/failed docs where AI is now reachable.

    Runs every 5 minutes via Celery Beat (configured in celery_app.py).
    Enqueues a reanalyze_document task for each stuck doc so the AI
    pipeline picks them up asynchronously.
    """
    try:
        from backend.tasks.reanalyze_tasks import reanalyze_document
    except ModuleNotFoundError:
        from tasks.reanalyze_tasks import reanalyze_document

    enqueued = 0
    # Find all clients that have a pending folder with stuck documents
    pending_clients = list(db.clients.find({"name": "Unsorted_Pending"}))

    for client in pending_clients:
        owner_id = client.get("owner_id")
        if not owner_id:
            continue

        stuck_docs = [
            d for d in client.get("documents", [])
            if d.get("status") in ("pending", "failed", "queued")
            and not d.get("deleted_at")
        ]

        for doc in stuck_docs:
            doc_id = doc.get("doc_id")
            try:
                # Enqueue a fresh reanalyze task
                task = reanalyze_document.apply_async(
                    args=[owner_id, doc_id],
                    queue="ai",
                )
                # Update doc status to requeued and attach new task id
                db.clients.update_one(
                    {"_id": client["_id"], "documents.doc_id": doc_id},
                    {
                        "$set": {
                            "documents.$.status": "queued",
                            "documents.$.processing_task": task.id,
                            "documents.$.queued_at": datetime.datetime.now(),
                        },
                    },
                )
                enqueued += 1
                print(f"    🔄 Beat: re-enqueued {doc_id} for {owner_id}")
            except Exception as e:
                print(f"    ⚠️ Beat: failed to re-enqueue {doc_id}: {e}")

    print(f"    ✅ Beat: retry_stuck_documents — enqueued {enqueued} docs")
    return {"enqueued": enqueued}