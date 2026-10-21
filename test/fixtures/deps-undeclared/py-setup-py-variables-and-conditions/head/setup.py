from pathlib import Path
from setuptools import setup

INSTALL_REQUIRES = ["numpy >= 1.14", "pandas >= 0.24"]
extras_require = {
    "test": ["pytest-cov"],
    "docs": ["sphinx"],
}

setup(
    name="pkg",
    install_requires=INSTALL_REQUIRES + (
        ["setuptools_scm>=4"] if Path(__file__).with_name(".git").exists() else []
    ),
    extras_require=extras_require,
)
