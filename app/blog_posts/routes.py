from flask import Blueprint, render_template, request, current_app
from app.new_posts.models import Articles

blueprint = Blueprint('blog_posts', __name__)

@blueprint.route('/')	
def index():
    page_number = request.args.get('page', 1, type=int)
    blog_posts_pagination = Articles.query.order_by(Articles.id.desc()).paginate(page_number, current_app.config['BLOG_POSTS_PER_PAGE'])
    return render_template('blog_posts/index.html', blog_posts_pagination=blog_posts_pagination)
    