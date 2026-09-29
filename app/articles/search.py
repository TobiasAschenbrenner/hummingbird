from sqlalchemy import func, literal_column

from app.articles.models import article_search_vector
from app.errors import ValidationError

MAX_SEARCH_LENGTH = 200


def validate_search_query(query):
    if len(query) > MAX_SEARCH_LENGTH:
        raise ValidationError(f"Search must be at most {MAX_SEARCH_LENGTH} characters.")
    if "\x00" in query:
        raise ValidationError("Search contains an unsupported character.")


def article_matches_search(query):
    terms = func.plainto_tsquery(literal_column("'simple'::regconfig"), query)
    return article_search_vector.bool_op("@@")(terms)
