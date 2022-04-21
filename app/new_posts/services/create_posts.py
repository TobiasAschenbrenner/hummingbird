from app.new_posts.models import Articles
from datetime import date
from flask_login import current_user
from werkzeug.utils import secure_filename
import os
from flask import request, current_app

def create_posts(form_data):

    # Saving the uploads
    file = request.files['file']
    filename = file.filename
    path = os.path.join(app.instance_path, 'uploads', filename)
    file.save(path)

    # Create a new post record
    post = Articles(
        title=form_data.get('title'),
        category=form_data.get('category'),
        img_url=filename,
        description=form_data.get('description'),
        text=form_data.get('text'),
        created_at=date.today(),
        slug=form_data.get('title').replace(' ', '-').lower(),
        author_id=current_user.id
    )
    post.save()