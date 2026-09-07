import logging
from pathlib import Path
from uuid import uuid4

from app.errors import ValidationError

logger = logging.getLogger(__name__)


def save_image(image, *, directory, allowed_extensions):
    if image is None or not image.filename:
        raise ValidationError("Please choose an image.")
    extension = Path(image.filename).suffix.lstrip(".").lower()
    if extension not in allowed_extensions:
        formats = ", ".join(sorted(allowed_extensions))
        raise ValidationError(f"Unsupported image extension. Choose one of: {formats}.")

    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    filename = f"{uuid4().hex}.{extension}"
    destination = directory / filename
    created = False
    try:
        with destination.open("xb") as output:
            created = True
            image.save(output)
    except Exception:
        if created:
            remove_image(filename, directory=directory)
        raise
    return filename


def remove_image(filename, *, directory):
    if Path(filename).name != filename or filename in {".", ".."}:
        raise ValueError("Expected an image filename without a directory.")
    try:
        (Path(directory) / filename).unlink(missing_ok=True)
    except OSError:
        # Cleanup must not hide the database or upload error that triggered it.
        logger.exception("Unable to remove uploaded image %s", filename)
