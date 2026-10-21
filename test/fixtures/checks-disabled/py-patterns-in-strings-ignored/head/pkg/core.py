def run():
    """Run once.

    Do not add # type: ignore here, and never @pytest.mark.skip a test.
    """
    hint = "use the @pytest.mark.skip or @pytest.mark.skipif decorators"
    other = 'pytest.skip("x")  # noqa'
    import json  # noqa: F401
    return hint, other
