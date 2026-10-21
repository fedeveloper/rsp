import os

import boto3
import httpx
import requests

x = requests.get("u")  # type: ignore
y = 1  # noqa: E501
REGION = os.getenv("AWS_REGION")
