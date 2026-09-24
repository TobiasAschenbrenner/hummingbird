import io
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from PIL import Image
from werkzeug.datastructures import FileStorage

from app.articles.uploads import MAX_IMAGE_BYTES, save_image
from app.errors import ValidationError


def image_bytes(image_format="PNG", *, color="red", size=(2, 2), **save_options):
    output = io.BytesIO()
    with Image.new("RGB", size, color=color) as image:
        image.save(output, format=image_format, **save_options)
    return output.getvalue()


class UploadTests(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary_directory.cleanup)
        self.directory = Path(self.temporary_directory.name) / "uploads"

    def save(self, filename, contents=None):
        if contents is None:
            contents = image_bytes()
        image = FileStorage(stream=io.BytesIO(contents), filename=filename)
        return save_image(
            image,
            directory=self.directory,
            allowed_extensions={"png", "jpg", "jpeg", "gif", "webp"},
        )

    def test_creates_directory_and_uses_unique_filenames(self):
        first_contents = image_bytes(color="red")
        second_contents = image_bytes(color="blue")
        first = self.save("../../cover.png", first_contents)
        second = self.save("../../cover.png", second_contents)
        self.assertNotEqual(first, second)
        self.assertEqual(Path(first).name, first)
        self.assertEqual((self.directory / first).read_bytes(), first_contents)
        self.assertEqual((self.directory / second).read_bytes(), second_contents)

    def test_accepts_supported_formats_and_normalizes_extension_case(self):
        for extension, image_format in (
            ("png", "PNG"),
            ("jpg", "JPEG"),
            ("jpeg", "JPEG"),
            ("gif", "GIF"),
            ("webp", "WEBP"),
        ):
            with self.subTest(extension=extension):
                contents = image_bytes(image_format)
                filename = self.save(f"cover.{extension.upper()}", contents)
                self.assertTrue(filename.endswith(f".{extension}"))
                self.assertEqual((self.directory / filename).read_bytes(), contents)

    def test_accepts_animated_images_without_changing_frames(self):
        for image_format in ("GIF", "WEBP", "PNG"):
            with (
                self.subTest(image_format=image_format),
                Image.new("RGB", (2, 2), "blue") as second_frame,
            ):
                contents = image_bytes(
                    image_format,
                    save_all=True,
                    append_images=[second_frame],
                    duration=100,
                )
                filename = self.save(f"cover.{image_format.lower()}", contents)
                with Image.open(self.directory / filename) as saved:
                    self.assertEqual(saved.n_frames, 2)
                self.assertEqual((self.directory / filename).read_bytes(), contents)

    def test_rejects_fake_mismatched_and_unsupported_contents(self):
        for contents in (
            b"",
            b"<html>Not an image</html>",
            image_bytes("JPEG"),
            image_bytes("BMP"),
        ):
            with (
                self.subTest(contents=contents[:16]),
                self.assertRaisesRegex(ValidationError, "valid, undamaged image"),
            ):
                self.save("cover.png", contents)
        self.assertFalse(self.directory.exists())

    def test_rejects_corrupt_and_truncated_images(self):
        for filename, contents in (
            ("cover.png", image_bytes()[:-15]),
            ("cover.jpg", image_bytes("JPEG")[:-20]),
            ("cover.webp", image_bytes("WEBP")[:-10]),
        ):
            with self.subTest(filename=filename), self.assertRaises(ValidationError):
                self.save(filename, contents)
        self.assertFalse(self.directory.exists())

    def test_rejects_animation_with_a_damaged_later_frame(self):
        with Image.new("RGB", (10, 10), "blue") as second_frame:
            contents = image_bytes(
                "GIF",
                size=(10, 10),
                save_all=True,
                append_images=[second_frame],
                duration=100,
            )[:-10]
        with Image.open(io.BytesIO(contents)) as first_frame:
            first_frame.load()
        with self.assertRaises(ValidationError):
            self.save("cover.gif", contents)
        self.assertFalse(self.directory.exists())

    def test_validation_rewinds_stream_and_ignores_client_mime_type(self):
        contents = image_bytes()
        image = FileStorage(
            stream=io.BytesIO(contents), filename="cover.png", content_type="text/plain"
        )
        image.stream.seek(10)
        filename = save_image(
            image, directory=self.directory, allowed_extensions={"png"}
        )
        self.assertEqual((self.directory / filename).read_bytes(), contents)

    def test_image_size_limit_uses_actual_bytes_and_accepts_exact_boundary(self):
        contents = image_bytes().ljust(MAX_IMAGE_BYTES, b"\0")
        filename = self.save("cover.png", contents)
        self.assertEqual((self.directory / filename).stat().st_size, MAX_IMAGE_BYTES)
        oversized = FileStorage(
            stream=io.BytesIO(contents + b"\0"),
            filename="cover.png",
            content_length=1,
        )
        with patch("app.articles.uploads.Image.open") as open_image:
            with self.assertRaisesRegex(ValidationError, "5 MiB or smaller"):
                save_image(
                    oversized, directory=self.directory, allowed_extensions={"png"}
                )
            open_image.assert_not_called()
        self.assertEqual(oversized.stream.tell(), 0)
        self.assertEqual([item.name for item in self.directory.iterdir()], [filename])

    def test_pixel_limit_is_checked_before_decoding_and_accepts_exact_boundary(self):
        oversized = image_bytes(size=(3, 2))
        with patch("app.articles.uploads.MAX_IMAGE_PIXELS", 4):
            filename = self.save("cover.png", image_bytes(size=(2, 2)))
            with patch(
                "PIL.Image.Image.load",
                side_effect=AssertionError("Must reject before decoding"),
            ):
                with self.assertRaisesRegex(ValidationError, "at most 4 pixels"):
                    self.save("cover.png", oversized)
        self.assertEqual([item.name for item in self.directory.iterdir()], [filename])

    def test_animation_frame_and_total_pixel_boundaries(self):
        with (
            Image.new("RGB", (2, 2), "blue") as second,
            Image.new("RGB", (2, 2), "green") as third,
        ):
            for image_format in ("GIF", "WEBP", "PNG"):
                two_frames = image_bytes(
                    image_format, save_all=True, append_images=[second], duration=100
                )
                three_frames = image_bytes(
                    image_format,
                    save_all=True,
                    append_images=[second, third],
                    duration=100,
                )
                for setting, limit, message in (
                    ("MAX_IMAGE_FRAMES", 2, "at most 2 frames"),
                    ("MAX_IMAGE_PIXELS", 8, "at most 8 pixels"),
                ):
                    with (
                        self.subTest(image_format=image_format, setting=setting),
                        patch(f"app.articles.uploads.{setting}", limit),
                    ):
                        self.save(f"cover.{image_format.lower()}", two_frames)
                        before = set(self.directory.iterdir())
                        with self.assertRaisesRegex(ValidationError, message):
                            self.save(f"cover.{image_format.lower()}", three_frames)
                        self.assertEqual(set(self.directory.iterdir()), before)

    def test_decoder_decompression_bomb_errors_are_validation_errors(self):
        contents = image_bytes(size=(3, 2))
        with (
            patch("PIL.Image.MAX_IMAGE_PIXELS", 2),
            self.assertRaisesRegex(ValidationError, "dimensions are too large"),
        ):
            self.save("cover.png", contents)
        self.assertFalse(self.directory.exists())

    def test_rejects_missing_or_unsupported_extension(self):
        for filename in ["", "cover", "cover.html"]:
            with self.subTest(filename=filename), self.assertRaises(ValidationError):
                self.save(filename)
        self.assertFalse(self.directory.exists())

    def test_partial_write_is_removed_on_failure(self):
        image = FileStorage(stream=io.BytesIO(image_bytes()), filename="cover.png")

        def fail_after_writing(output):
            output.write(b"partial content")
            raise OSError("Simulated disk failure")

        with (
            patch.object(image, "save", side_effect=fail_after_writing),
            self.assertRaises(OSError),
        ):
            save_image(image, directory=self.directory, allowed_extensions={"png"})
        self.assertEqual(list(self.directory.iterdir()), [])

    def test_filename_collision_does_not_overwrite_or_remove_existing_image(self):
        with patch("app.articles.uploads.uuid4", return_value=Mock(hex="fixed")):
            original = image_bytes()
            self.save("cover.png", original)
            with self.assertRaises(FileExistsError):
                self.save("cover.png", image_bytes(color="blue"))
        self.assertEqual((self.directory / "fixed.png").read_bytes(), original)
