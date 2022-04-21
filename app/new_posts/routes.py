from flask import Blueprint, render_template, request, current_app
from .services.create_posts import create_posts
from app.new_posts.models import Articles
from flask_login import login_required
from app.users.models import Users


blueprint = Blueprint('new_posts', __name__)

@blueprint.get('/new-post')
@login_required
def get_new_posts():
    return render_template('new_posts/new.html')

@blueprint.post('/new-post')
def post_new_posts():
    try:
        if not all([
            request.form.get('title'),
            request.form.get('description'),
            request.form.get('category'),
            request.form.get('text'),
            request.files['file']
        ]):
            raise Exception ('Please fill out all fields!')

        create_posts(request.form)
        page_number = request.args.get('page', 1, type=int)
        blog_posts_pagination = Articles.query.order_by(Articles.id.desc()).paginate(page_number, current_app.config['BLOG_POSTS_PER_PAGE'])
        users = Users.query.all()
        return render_template('blog_posts/index.html', users=users, blog_posts_pagination=blog_posts_pagination)

    except Exception as error_message:
        error = error_message or 'An error occurred while posting your article! Please make sure to enter valid data!'
        current_app.logger.info(f'Error creating an article: {error}')
        
        return render_template('new_posts/new.html', error=error)
    