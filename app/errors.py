from flask import render_template


class ValidationError(ValueError):
    """An expected input error that can be safely shown to the user."""


class ConflictError(ValidationError):
    """A submitted change is based on an outdated version of a record."""


def handle_csrf_error(error):
    return render_template("errors/csrf.html"), 400
