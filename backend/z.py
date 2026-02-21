from auth import db
# db.documents.delete_many({})
# db.activity.delete_many({})
db.documents.drop()
db.activity.drop()
db.clents.drop()
print("Done")