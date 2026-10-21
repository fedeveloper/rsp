class Legend:
    """A legend.

    Example::

        def make(parent, handles, labels=None):
            return Legend(parent, handles)
    """

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)

    @property
    def title(self):
        return self._title

    @title.setter
    def title(self, value):
        self._title = value

    def __init__(self, parent, handles, loc=None):
        self._title = ""
