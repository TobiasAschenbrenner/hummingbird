from app.articles.models import Article
from datetime import date
from flask_login import current_user
from werkzeug.utils import secure_filename
import os
from flask import request, current_app


def create_article(form_data):

    os.makedirs(current_app.config["UPLOADS_PATH"], exist_ok=True)

    # Saving the uploads
    file = request.files["file"]
    filename = file.filename
    path = os.path.join(current_app.config["UPLOADS_PATH"], filename)
    file.save(path)

    # Create a new post record
    post = Article(
        title=form_data.get("title"),
        category=form_data.get("category"),
        image_filename=filename,
        description=form_data.get("description"),
        body=form_data.get("text"),
        created_at=date.today(),
        slug=form_data.get("title").replace(" ", "-").lower(),
        author_id=current_user.id,
    )
    post.save()
