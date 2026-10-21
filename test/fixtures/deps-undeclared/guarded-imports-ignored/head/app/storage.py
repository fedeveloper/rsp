from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from mypy_boto3_s3 import S3Client

try:
    import ujson as json
except ImportError:
    import json


def save():
    return None
