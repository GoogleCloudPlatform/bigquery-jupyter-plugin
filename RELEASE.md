# Making a new release of bigquery_jupyter_plugin

The extension is published to PyPI through Google's OSS Exit Gate. Releases are
staged in the Exit Gate's Artifact Registry repository, and the Exit Gate
publishes them to PyPI.

> **Don't upload to PyPI directly.** A version that doesn't come through the
> Exit Gate is flagged as an unauthorized ("bypass") release and alerts the
> owning team. Direct uploads are for emergencies only, such as a critical
> security fix when the Exit Gate is down.

There are two ways to release:

- **Automated** (recommended): run the Jupyter Releaser workflows in GitHub
  Actions. Needs the one-time setup below.
- **Manual**: build locally and stage the release yourself. Only accounts listed
  as builders in the project's Exit Gate configuration can do this.

## Automated releases with the Jupyter Releaser

This repo is set up for the [Jupyter Releaser](https://jupyter-releaser.readthedocs.io/)
via three GitHub Actions workflows:

- **Check Release** (`check-release.yml`) — runs on every PR/push to `main`; does a
  full dry run of the release (build, changelog, links, wheel contents) and uploads
  the built `dist/` as an artifact. Never publishes.
- **Step 1: Prep Release** (`prep-release.yml`) — manual. Bumps the version
  (`hatch version`), regenerates `CHANGELOG.md` from labeled PRs, tags, and opens a
  **draft** GitHub release.
- **Step 2: Publish Release** (`publish-release.yml`) — manual. Rebuilds from the tag,
  stages the wheel and sdist in the Exit Gate's Artifact Registry, triggers the
  Exit Gate release, then finalizes the GitHub release.

To cut a release: Actions → run **Step 1** (pick the version) → review the draft
changelog → run **Step 2** (paste the draft release URL).

If Step 2 fails after its "Populate Release" step has already attached the
built files to the draft release, re-running Step 2 won't rebuild them, and the
"Stage package" step fails. Finish that release manually (below) instead.

### One-time setup (requires repo admin + PyPI owner)

- **`release` GitHub Environment** — the publish job runs in it. Limit its
  deployment branches to `main`, the only branch the Exit Gate accepts releases
  from.
- **Release push** — nothing to configure. Both steps push with the workflow's
  `GITHUB_TOKEN`, which works while `main` has no branch protection blocking it.
  If that changes, push with a GitHub App token instead.
- **Exit Gate access** — nothing to configure in GitHub. The workflow signs in to
  Google Cloud with Workload Identity Federation, and the Exit Gate project
  configuration allows `publish-release.yml` on `main` and on tags to publish.
  No PyPI token is stored in the repo.
- **PyPI trusted publisher** — on PyPI, add a Google Cloud
  [trusted publisher](https://docs.pypi.org/trusted-publishers/adding-a-publisher/#google-cloud)
  for `bigquery-jupyter-plugin` with the service account
  `bigquery-jupyter-plugin-py@oss-exit-gate-prod.iam.gserviceaccount.com`
  (leave "Subject" blank). The Exit Gate uses it to publish.

The package isn't published to npm.

## Manual release

### Prerequisites

Install the tools for building and staging:

```bash
pip install build hatch twine keyring keyrings.google-artifactregistry-auth
```

Sign in to Google Cloud with an account that's an Exit Gate builder for this
project:

```bash
gcloud auth application-default login
```

### Bump the version

Every release needs a new version number, set with `hatch`. See the docs on
[hatch-nodejs-version](https://github.com/agoose77/hatch-nodejs-version#semver)
for details.

```bash
hatch version <new-version>
```

### Build

Clean up all the development files from your local repo before building the
package:

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

### Stage the release

Optionally, remove anything left in the staging repository from earlier builds,
so only this release gets published:

```bash
gcloud artifacts packages delete bigquery-jupyter-plugin \
  --project=oss-exit-gate-prod \
  --repository=bigquery-jupyter-plugin--pypi \
  --location=us \
  --quiet
```

Upload both files to the Exit Gate's Artifact Registry repository:

```bash
python -m twine upload \
  --repository-url https://us-python.pkg.dev/oss-exit-gate-prod/bigquery-jupyter-plugin--pypi \
  dist/bigquery_jupyter_plugin-*
```

### Trigger the release

Write a manifest that publishes everything staged, and upload it. The upload
starts the release:

```bash
echo '{"publish_all": true}' > manifest.json
gcloud storage cp manifest.json \
  "gs://oss-exit-gate-prod-projects-bucket/bigquery-jupyter-plugin/pypi/manifests/manifest-<new-version>-$(date +%s).json"
```

The Exit Gate emails the project's notification list when the release starts
and when it finishes or fails.
