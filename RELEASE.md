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

## Automated releases with the Jupyter Releaser

This repo is set up for the [Jupyter Releaser](https://jupyter-releaser.readthedocs.io/)
via three GitHub Actions workflows:

- **Check Release** (`check-release.yml`) — runs on every PR/push to `main`; does a
  full dry run of the release (build, changelog, links, wheel contents) and uploads
  the built `dist/` as an artifact. Never publishes.
- **Step 1: Prep Release** (`prep-release.yml`) — manual. Bumps the version
  (`hatch version`), regenerates `CHANGELOG.md` from labeled PRs, tags, and opens a
  **draft** GitHub release.
- **Step 2: Publish Release** (`publish-release.yml`) — manual. Rebuilds from the tag
  and publishes to PyPI, then finalizes the GitHub release.

To cut a release: Actions → run **Step 1** (pick the version) → review the draft
changelog → run **Step 2** (paste the draft release URL).

### One-time repo/PyPI setup (requires repo admin + PyPI admin)

- **`release` GitHub Environment** — the publish job runs in it.
- **GitHub App for the release push** — set the `APP_ID` repo _variable_ and the
  `APP_PRIVATE_KEY` repo _secret_ (an app with `contents: write` to push the
  version-bump commit/tag past branch protection). Or swap the app-token step in
  `publish-release.yml` for `secrets.GITHUB_TOKEN` if branch protection permits.
- **PyPI auth** — either:
  - set the `PYPI_TOKEN` repo secret (token path; matches the current manual
    release under the shared `vertex-ai-workbench-team` account), **or**
  - configure PyPI [Trusted Publishing](https://docs.pypi.org/trusted-publishers/)
    for `bigquery_jupyter_plugin` (owner `GoogleCloudPlatform`, repo
    `bigquery-jupyter-plugin`, workflow `publish-release.yml`, environment
    `release`) and remove `PYPI_TOKEN` from `publish-release.yml`.
- **npm (optional)** — only if also publishing the frontend to npm: set `NPM_TOKEN`.
  For a PyPI-only release, skip the npm publish step via the **steps_to_skip** input.
