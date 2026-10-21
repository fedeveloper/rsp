import os

home = os.getenv("HOME")
sha = os.environ["GITHUB_SHA"]
os.environ["MY_VAR"] = "1"
