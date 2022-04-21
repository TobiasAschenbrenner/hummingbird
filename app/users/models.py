from app.extensions.database import db, CRUDMixin
from flask_login import UserMixin

class Users(db.Model, CRUDMixin, UserMixin):
  id = db.Column(db.Integer, primary_key = True)
  username = db.Column(db.String(80))
  email = db.Column(db.String(120), index = True, unique = True)
  password = db.Column(db.String(250))
  articles = db.relationship('Articles', backref='articles', lazy=True)

from app.new_posts.models import Articles