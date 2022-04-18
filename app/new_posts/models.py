from app.extensions.database import db, CRUDMixin

class Articles(db.Model, CRUDMixin):
    id = db.Column(db.Integer, primary_key=True)
    slug = db.Column(db.String(80), unique=True)
    text = db.Column(db.Text)
    description = db.Column(db.String(250))
    title = db.Column(db.String(30))
    category = db.Column(db.String(10))
    created_at = db.Column(db.Date)
    # img_url = db.Column(db.String(250))
    author = db.Column(db.String(80))