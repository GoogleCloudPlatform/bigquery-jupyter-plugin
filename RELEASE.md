# Making a new release of bigquery_jupyter_plugin

The extension can be published to `PyPI` manually.

## Manual release

### Python package

This extension is distributed as a Python package.

The packaging setup is defined in the `pyproject.toml` file.

## Prerequisites

Install the `hatch` and `twine` tools for packaging and uploading (respectively):

```bash
pip install build twine hatch
```

Everytime you manually create a new release, you must bump the version number
using the `hatch` tool.

By default this will create a tag.

See the docs on [hatch-nodejs-version](https://github.com/agoose77/hatch-nodejs-version#semver) for details.

```bash
hatch version <new-version>
```

## Packaging

Clean up all the development files from your local repo before building the package:

```bash
git clean -dfX
```

To create a Python source package (`.tar.gz`) in the `dist/` directory, do:

```bash
python -m build --sdist
```

Then to upload the package to PyPI, do:

```bash
python -m twine upload dist/bigquery_jupyter_plugin-*.tar.gz
```
