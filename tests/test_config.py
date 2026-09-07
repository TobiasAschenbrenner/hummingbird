import unittest

from app.config import load_config


class ConfigTests(unittest.TestCase):
    def test_overrides_and_legacy_postgresql_url(self):
        config = load_config(
            {
                "SQLALCHEMY_DATABASE_URI": "postgres://localhost/hummingbird_test",
                "SECRET_KEY": "test-only",
                "TESTING": True,
            }
        )
        self.assertEqual(
            config["SQLALCHEMY_DATABASE_URI"], "postgresql://localhost/hummingbird_test"
        )

    def test_missing_settings_fail_clearly(self):
        with self.assertRaisesRegex(RuntimeError, "DATABASE_URL is missing"):
            load_config({"SQLALCHEMY_DATABASE_URI": None, "SECRET_KEY": "test-only"})
        for secret in [None, "", "replace-with-a-generated-secret"]:
            with (
                self.subTest(secret=secret),
                self.assertRaisesRegex(RuntimeError, "SECRET_KEY is missing"),
            ):
                load_config(
                    {
                        "SQLALCHEMY_DATABASE_URI": "postgresql://localhost/hummingbird_test",
                        "SECRET_KEY": secret,
                    }
                )
