import sys

if sys.platform == "win32":
    import colorama
else:
    import uvloop
