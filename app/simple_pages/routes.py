from flask import Blueprint, render_template
from app.new_posts.models import Articles

blueprint = Blueprint('simple_pages', __name__)

@blueprint.route('/<slug>')
def blog_posts(slug):
    blog_post = Articles.query.filter_by(slug=slug).first_or_404()
    return render_template('simple_pages/show.html', blog_post=blog_post)
    