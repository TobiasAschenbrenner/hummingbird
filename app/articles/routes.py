from flask import Blueprint, current_app, redirect, render_template, request, url_for
from flask_login import login_required, login_user
from werkzeug.security import check_password_hash

from app.articles.models import Article
from app.articles.services import create_article
from app.users.models import User
from app.users.services import register_user

blueprint = Blueprint("blog_posts", __name__)

from flask import Blueprint, render_template, request, current_app
from .services import create_article
from app.articles.models import Article
from flask_login import login_required
from app.users.models import User


from flask import Blueprint, render_template, request, current_app, redirect, url_for
from werkzeug.security import check_password_hash
from app.users.services import register_user
from app.articles.models import Article
from app.users.models import User
from flask_login import login_user, logout_user

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


@blueprint.post("/<slug>")
def post_register_or_login(slug):
    blog_post = Article.query.filter_by(slug=slug).first_or_404()
    page_number = request.args.get("page", 1, type=int)
    blog_posts_pagination = Article.query.order_by(Article.id.desc()).paginate(
        page_number, current_app.config["BLOG_POSTS_PER_PAGE"]
    )

    # Login form
    if all([request.form.get("login_email"), request.form.get("login_password")]):
        try:
            user = User.query.filter_by(email=request.form.get("login_email")).first()

            if not user:
                raise Exception("Invalid email or password!")
            elif not check_password_hash(
                user.password_hash, request.form.get("login_password")
            ):
                raise Exception("Invalid email or password!")

            login_user(user)
            return redirect(url_for("articles.index"))

        except Exception as error_message:
            error = (
                error_message
                or "An error occurred while logging in. Please verify your email and password."
            )
            current_app.logger.info(f"Error logging in: {error}")
            return render_template(
                "articles/detail.html", blog_post=blog_post, error=error
            )

    # Register form
    elif all(
        [
            request.form.get("register_name"),
            request.form.get("register_email"),
            request.form.get("register_password"),
            request.form.get("register_confirmPassword"),
        ]
    ):
        try:
            if request.form.get("register_password") != request.form.get(
                "register_confirmPassword"
            ):
                raise Exception("The password confirmation must match the password!")

            elif User.query.filter_by(email=request.form.get("register_email")).first():
                raise Exception("The email address is already registered!")

            elif len(request.form.get("register_password")) < 8:
                raise Exception("The password must be at least 8 characters long!")

            user = register_user(request.form)
            login_user(user)
            return redirect(url_for("articles.index"))

        except Exception as error_message:
            error = (
                error_message
                or "An error occurred while creating a user. Please make sure to enter valid data."
            )
            current_app.logger.info(f"Error creating a user: {error}")
            return render_template(
                "articles/detail.html", blog_post=blog_post, error=error
            )

    else:
        return render_template(
            "articles/detail.html",
            blog_post=blog_post,
            error="Please fill out all fields!",
        )
