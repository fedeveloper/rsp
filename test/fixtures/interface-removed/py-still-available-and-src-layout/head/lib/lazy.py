def __getattr__(name):
    return lambda: 1
