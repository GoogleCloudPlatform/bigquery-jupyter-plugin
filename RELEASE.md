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

Build both the wheel (`.whl`) and the source distribution (`.tar.gz`) into the
`dist/` directory:

```bash
python -m build
```

> **Publish the wheel, not just the sdist.** This is a prebuilt (source)
> JupyterLab extension: the wheel bundles the compiled labextension assets
> (under `share/jupyter/labextensions/`), so `pip install` works with no Node.js
> toolchain. The sdist contains only source, so installing from it alone would
> require building the frontend at install time.

Then upload both artifacts to PyPI:

```bash
python -m twine upload dist/bigquery_jupyter_plugin-*
```
