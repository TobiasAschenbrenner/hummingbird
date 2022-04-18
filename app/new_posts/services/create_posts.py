from app.new_posts.models import Articles
from datetime import date

def create_posts(form_data):
    # Create a new post record
    post = Articles(
        author=form_data.get('author'),
        title=form_data.get('title'),
        category=form_data.get('category'),
        # img_url=
        description=form_data.get('description'),
        text=form_data.get('text'),
        created_at=date.today(),
        slug=form_data.get('title').replace(' ', '-').lower()
    )
    post.save()