class Legend:
    """A legend.

    Example::

        def make(parent, handles):
            return Legend(parent, handles)
    """

    @property
    def title(self):
        return self._title

    def __init__(self, parent, handles, loc=None):
        self._title = ""
