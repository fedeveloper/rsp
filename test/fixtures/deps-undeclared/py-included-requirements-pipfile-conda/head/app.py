import httpx
import numpy as np
import requests
import scipy
import tenacity
from rich import print


def get(url):
    return requests.get(url, timeout=5)
