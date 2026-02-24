from auth import db
# db.documents.delete_many({})
# db.activity.delete_many({})
db.clients.drop()
db.activity.drop()
print("Done")