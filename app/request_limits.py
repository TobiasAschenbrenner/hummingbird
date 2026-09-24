from flask import current_app, render_template, request
from werkzeug.exceptions import LengthRequired, RequestEntityTooLarge


def enforce_request_size():
    if request.method not in {"POST", "PUT", "PATCH", "DELETE"}:
        return
    content_length = request.content_length
    # Werkzeug 2.1 cannot enforce its body limit on unknown-length streams.
    if content_length is None and request.environ.get("wsgi.input_terminated"):
        raise LengthRequired()
    if (
        content_length is not None
        and content_length > current_app.config["MAX_CONTENT_LENGTH"]
    ):
        raise RequestEntityTooLarge()


def handle_request_size_error(error):
    return render_template(
        "errors/request_size.html",
        error_code=error.code,
        request_limit_mib=current_app.config["MAX_CONTENT_LENGTH"] / (1024 * 1024),
    ), error.code
