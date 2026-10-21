import typing as t

if t.TYPE_CHECKING:
    import typing_extensions as te

has_simplejson = False
try:
    import simplejson as json

    has_simplejson = True
except ImportError:
    import json

if has_simplejson:
    from simplejson import JSONDecodeError

try:
    from urllib3.contrib import pyopenssl
except ImportError:
    pyopenssl = None
else:
    import OpenSSL
