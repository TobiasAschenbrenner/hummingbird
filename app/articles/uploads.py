import logging
from io import SEEK_END
from pathlib import Path
from uuid import uuid4

from PIL import Image, ImageSequence

from app.errors import ValidationError

logger = logging.getLogger(__name__)
MAX_IMAGE_BYTES = 5 * 1024 * 1024
MAX_IMAGE_PIXELS = 20_000_000
MAX_IMAGE_FRAMES = 100
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
        image.stream.seek(0, SEEK_END)
        if image.stream.tell() > MAX_IMAGE_BYTES:
            raise ValidationError(
                f"Image must be {MAX_IMAGE_BYTES / (1024 * 1024):g} MiB or smaller."
            )
        image.stream.seek(0)
        with Image.open(image.stream, formats=formats) as decoded:
            validate_pixel_count(decoded.width * decoded.height)
            decoded.verify()
        image.stream.seek(0)
        with Image.open(image.stream, formats=formats) as decoded:
            total_pixels = 0
            for frame_number, frame in enumerate(
                ImageSequence.Iterator(decoded), start=1
            ):
                if frame_number > MAX_IMAGE_FRAMES:
                    raise ValidationError(
                        f"Animated images must have at most {MAX_IMAGE_FRAMES} frames."
                    )
                total_pixels += frame.width * frame.height
                validate_pixel_count(total_pixels)
                frame.load()
    except ValidationError:
        raise
    except Image.DecompressionBombError as error:
        raise ValidationError(
            "Image dimensions are too large. Choose a smaller image."
        ) from error
    except (
        OSError,
        ValueError,
        SyntaxError,
        EOFError,
    ) as error:
        raise ValidationError(
            "Please choose a valid, undamaged image matching its file extension."
        ) from error
    finally:
        image.stream.seek(0)


def validate_pixel_count(total_pixels):
    if total_pixels > MAX_IMAGE_PIXELS:
        raise ValidationError(
            f"Image must contain at most {MAX_IMAGE_PIXELS:,} pixels in total, "
            "counting all animation frames. Choose a smaller image."
        )


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
