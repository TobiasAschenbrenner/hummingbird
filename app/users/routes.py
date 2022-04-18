from flask import Blueprint, render_template, request, current_app, redirect, url_for
from werkzeug.security import check_password_hash
from .services.create_users import create_users
from app.new_posts.models import Articles
from app.users.models import Users
from flask_login import login_user, logout_user

blueprint = Blueprint('users', __name__)

@blueprint.get('/')
def index():
    page_number = request.args.get('page', 1, type=int)
    blog_posts_pagination = Articles.query.order_by(Articles.id.desc()).paginate(page_number, current_app.config['BLOG_POSTS_PER_PAGE'])
    return render_template('blog_posts/index.html', blog_posts_pagination=blog_posts_pagination)


@blueprint.post('/')
def post_register_or_login():
  page_number = request.args.get('page', 1, type=int)
  blog_posts_pagination = Articles.query.order_by(Articles.id.desc()).paginate(page_number, current_app.config['BLOG_POSTS_PER_PAGE'])

  # Login form
  if all([
    request.form.get('login_email'),
    request.form.get('login_password')
  ]):
    try:
      user = Users.query.filter_by(email=request.form.get('login_email')).first()

      if not user:
        raise Exception ('Invalid email or password!')
      elif not check_password_hash(user.password, request.form.get('login_password')):
        raise Exception ('Invalid email or password!')

      login_user(user)
      return redirect(url_for('blog_posts.index'))
    
    except Exception as error_message:
      error = error_message or 'An error occurred while logging in. Please verify your email and password.'
      current_app.logger.info(f'Error logging in: {error}')
      return render_template('blog_posts/index.html', blog_posts_pagination=blog_posts_pagination, error=error) 
  
  # Register form
  elif all([
    request.form.get('register_name'),
    request.form.get('register_email'),
    request.form.get('register_password'),
    request.form.get('register_confirmPassword'),
  ]):
    try:
      if request.form.get('register_password') != request.form.get('register_confirmPassword'):
        raise Exception ('The password confirmation must match the password!')
        
      elif Users.query.filter_by(email=request.form.get('register_email')).first():
        raise Exception ('The email address is already registered!')

      elif len(request.form.get('register_password')) < 8:
        raise Exception ('The password must be at least 8 characters long!')

      user = create_users(request.form)
      login_user(user)
      return redirect(url_for('blog_posts.index'))
    
    except Exception as error_message:
      error = error_message or 'An error occurred while creating a user. Please make sure to enter valid data.'
      current_app.logger.info(f'Error creating a user: {error}')
      return render_template('blog_posts/index.html', blog_posts_pagination=blog_posts_pagination, error=error)

  else:
    return render_template('blog_posts/index.html', blog_posts_pagination=blog_posts_pagination, error='Please fill out all fields!')


@blueprint.get('/logout')
def logout():
  page_number = request.args.get('page', 1, type=int)
  blog_posts_pagination = Articles.query.order_by(Articles.id.desc()).paginate(page_number, current_app.config['BLOG_POSTS_PER_PAGE'])

  logout_user()
  return redirect(url_for('blog_posts.index'))