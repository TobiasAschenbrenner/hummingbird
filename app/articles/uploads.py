import logging
from pathlib import Path
from uuid import uuid4

from PIL import Image, ImageSequence

from app.errors import ValidationError

logger = logging.getLogger(__name__)
IMAGE_FORMATS = {
    "png": "PNG",
    "jpg": "JPEG",
    "jpeg": "JPEG",
    "gif": "GIF",
    "webp": "WEBP",
}


def validate_image(image, *, extension):
    formats = [IMAGE_FORMATS[extension]]
    try:
        image.stream.seek(0)
        with Image.open(image.stream, formats=formats) as decoded:
            if decoded.width * decoded.height > Image.MAX_IMAGE_PIXELS:
                raise Image.DecompressionBombError("Image dimensions are too large")
            decoded.verify()
        image.stream.seek(0)
        with Image.open(image.stream, formats=formats) as decoded:
            for frame in ImageSequence.Iterator(decoded):
                frame.load()
    except (
        OSError,
        ValueError,
        SyntaxError,
        EOFError,
        Image.DecompressionBombError,
    ) as error:
        raise ValidationError(
            "Please choose a valid, undamaged image matching its file extension."
        ) from error
    finally:
        image.stream.seek(0)


def save_image(image, *, directory, allowed_extensions):
    if image is None or not image.filename:
        raise ValidationError("Please choose an image.")
    extension = Path(image.filename).suffix.lstrip(".").lower()
    if extension not in allowed_extensions or extension not in IMAGE_FORMATS:
        formats = ", ".join(sorted(allowed_extensions))
        raise ValidationError(f"Unsupported image extension. Choose one of: {formats}.")
    validate_image(image, extension=extension)

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
