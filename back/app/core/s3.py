"""S3/MinIO client for attachment storage.

boto3 is synchronous — call these helpers via ``asyncio.to_thread`` from
async request handlers.
"""

import boto3
from botocore.client import Config

from app.core.logging import get_logger
from app.settings import get_settings

logger = get_logger("s3")


def get_s3_client():
    """Return a configured boto3 S3 client (MinIO-compatible)."""
    settings = get_settings()
    return boto3.client(
        "s3",
        endpoint_url=settings.S3_ENDPOINT_URL,
        aws_access_key_id=settings.S3_ACCESS_KEY,
        aws_secret_access_key=settings.S3_SECRET_KEY,
        region_name=settings.S3_REGION,
        config=Config(signature_version="s3v4"),
    )


def ensure_buckets_exist() -> None:
    """Create the application bucket if missing (idempotent, called at startup)."""
    settings = get_settings()
    client = get_s3_client()
    existing = {b["Name"] for b in client.list_buckets().get("Buckets", [])}
    if settings.S3_BUCKET_NAME not in existing:
        client.create_bucket(Bucket=settings.S3_BUCKET_NAME)
        logger.info("s3_bucket_created", bucket=settings.S3_BUCKET_NAME)
