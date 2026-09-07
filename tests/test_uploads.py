import io
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from werkzeug.datastructures import FileStorage

from app.articles.uploads import save_image
from app.errors import ValidationError


class UploadTests(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary_directory.cleanup)
        self.directory = Path(self.temporary_directory.name) / "uploads"

    def save(self, filename, contents=b"image content"):
        image = FileStorage(stream=io.BytesIO(contents), filename=filename)
        return save_image(
            image, directory=self.directory, allowed_extensions={"png", "webp"}
        )

    def test_creates_directory_and_uses_unique_filenames(self):
        first = self.save("../../cover.png", b"first")
        second = self.save("../../cover.png", b"second")
        self.assertNotEqual(first, second)
        self.assertEqual(Path(first).name, first)
        self.assertEqual((self.directory / first).read_bytes(), b"first")
        self.assertEqual((self.directory / second).read_bytes(), b"second")

    def test_accepts_webp_and_normalizes_extension_case(self):
        filename = self.save("cover.WEBP")
        self.assertTrue(filename.endswith(".webp"))

    def test_rejects_missing_or_unsupported_extension(self):
        for filename in ["", "cover", "cover.html"]:
            with self.subTest(filename=filename), self.assertRaises(ValidationError):
                self.save(filename)
        self.assertFalse(self.directory.exists())

    def test_partial_write_is_removed_on_failure(self):
        image = Mock(filename="cover.png")

        def fail_after_writing(output):
            output.write(b"partial content")
            raise OSError("Simulated disk failure")

        image.save.side_effect = fail_after_writing
        with self.assertRaises(OSError):
            save_image(image, directory=self.directory, allowed_extensions={"png"})
        self.assertEqual(list(self.directory.iterdir()), [])

    def test_filename_collision_does_not_overwrite_or_remove_existing_image(self):
        with patch("app.articles.uploads.uuid4", return_value=Mock(hex="fixed")):
            self.save("cover.png", b"original")
            with self.assertRaises(FileExistsError):
                self.save("cover.png", b"replacement")
        self.assertEqual((self.directory / "fixed.png").read_bytes(), b"original")
