from setuptools import setup

import pkg._min_dependencies as min_deps

setup(name="pkg", install_requires=min_deps.tag_to_packages["install"])
