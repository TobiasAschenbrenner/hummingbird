from flask import Blueprint, current_app, render_template, request
from flask_login import login_required

from app.articles.models import Article
from app.articles.services import create_article
from app.users.models import User

blueprint = Blueprint("articles", __name__)


@blueprint.route("/")
def index():
    page_number = request.args.get("page", 1, type=int)
    blog_posts_pagination = Article.query.order_by(Article.id.desc()).paginate(
        page_number, current_app.config["BLOG_POSTS_PER_PAGE"]
    )
    users = User.query.all()
    return render_template(
        "articles/index.html", users=users, blog_posts_pagination=blog_posts_pagination
    )


@blueprint.get("/new-post")
@login_required
def new_article():
    return render_template("articles/create.html")


@blueprint.post("/new-post")
@login_required
def submit_article():
    try:
        if not all(
            [
                request.form.get("title"),
                request.form.get("description"),
                request.form.get("category"),
                request.form.get("text"),
                request.files["file"],
            ]
        ):
            raise Exception("Please fill out all fields!")

        create_article(request.form)
        page_number = request.args.get("page", 1, type=int)
        blog_posts_pagination = Article.query.order_by(Article.id.desc()).paginate(
            page_number, current_app.config["BLOG_POSTS_PER_PAGE"]
        )
        users = User.query.all()
        return render_template(
            "articles/index.html",
            users=users,
            blog_posts_pagination=blog_posts_pagination,
        )

    except Exception as error_message:
        error = (
            error_message
            or "An error occurred while posting your article! Please make sure to enter valid data!"
        )
        current_app.logger.info(f"Error creating an article: {error}")

        return render_template("articles/create.html", error=error)


@blueprint.route("/<slug>")
def detail(slug):
    blog_post = Article.query.filter_by(slug=slug).first_or_404()
    return render_template("articles/detail.html", blog_post=blog_post)
