# Making a new release of bigquery_jupyter_plugin

Releases are automated with
[release-please](https://github.com/googleapis/release-please) and published to
`PyPI` via [Trusted Publishing](https://docs.pypi.org/trusted-publishers/). The
manual flow below is kept only as a fallback.

## Automated release (default)

Version and changelog are driven by
[Conventional Commit](https://www.conventionalcommits.org/) messages. While the
project is pre-1.0, `feat:` bumps the minor version, `fix:` bumps the patch
version, and `feat!:`/`BREAKING CHANGE:` also bumps the minor version.

Flow:

1. Land normal PRs to `main` using Conventional Commit titles.
2. The `Release` workflow (`.github/workflows/release.yml`) keeps a single
   **"release PR"** open that bumps the version in `package.json`, updates
   `CHANGELOG.md`, and updates `.release-please-manifest.json`.
3. When you merge that release PR, release-please tags `vX.Y.Z` and creates a
   GitHub Release. The same workflow then builds the wheel + sdist and uploads
   them to PyPI via Trusted Publishing.

To force a specific version (for example, to cut `0.1.0` as the first automated
release), merge a commit whose message contains a `Release-As:` footer:

```text
chore: release 0.1.0

Release-As: 0.1.0
```

### One-time setup

- **PyPI Trusted Publisher.** On the PyPI project page → _Manage → Publishing_,
  add a GitHub publisher with:
  - Owner: `GoogleCloudPlatform`
  - Repository: `bigquery-jupyter-plugin`
  - Workflow filename: `release.yml`
  - Environment: `pypi`
- **GitHub environment.** Create an environment named `pypi` (Settings →
  Environments); optionally add required reviewers to gate each publish.

No tokens or secrets are stored: the workflow requests a short-lived OIDC token
that PyPI exchanges for a project-scoped upload token at publish time.

## Manual release (fallback)

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
