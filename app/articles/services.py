import os
from datetime import date

from flask import current_app, request
from flask_login import current_user

from app.articles.models import Article


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
