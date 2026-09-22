#!/bin/bash

# Fail on any error.
set -e

# Display commands being run.
# WARNING: please only enable 'set -x' if necessary for debugging, and be very
#  careful if you handle credentials (e.g. from Keystore) with 'set -x':
#  statements like "export VAR=$(cat /tmp/keystore/credentials)" will result in
#  the credentials being printed in build logs.
#  Additionally, recursive invocation with credentials as command-line
#  parameters, will print the full command, with credentials, in the build logs.
# set -x

# Code under repo is checked out to ${KOKORO_ARTIFACTS_DIR}/github.
# The final directory name in this path is determined by the scm name specified
# in the job configuration.

export PATH="$HOME/.local/bin:$PATH"

# configure gcloud
gcloud config set project deeplearning-platform
gcloud config set compute/region us-central1

# Install dependencies.
sudo apt-get update
sudo apt-get install -y --no-install-recommends git curl
curl -sL https://deb.nodesource.com/setup_22.x | sudo bash -
sudo apt-get --assume-yes install python3 python3-pip nodejs python3-venv

# Guard against a silent fallback to the distro's (ancient) Node.js: if the
# NodeSource setup above fails, apt installs Ubuntu's default Node, which is too
# old to run the JS build (e.g. rimraf's ESM bin uses top-level await). Fail
# loudly here instead of producing a confusing build error later.
NODE_MAJOR="$(node -v)"
NODE_MAJOR="${NODE_MAJOR#v}"
NODE_MAJOR="${NODE_MAJOR%%.*}"
if [ "${NODE_MAJOR}" -lt 20 ]; then
  echo "ERROR: Node.js v${NODE_MAJOR} installed, but >= 20 is required (expected 22)." >&2
  echo "The NodeSource setup step above likely failed; check the log for it." >&2
  exit 1
fi
echo "Using Node.js $(node -v)."

# Install latest jupyter lab and build.
python3 -m venv latest
source latest/bin/activate
pip install jupyterlab build

# Navigate to repo.
cd "${KOKORO_ARTIFACTS_DIR}/github/bigquery-jupyter-plugin"

# Build the Python packages (wheel + sdist) into dist/. The hatch-jupyter-builder
# hook runs `jlpm build:prod` first, so the wheel bundles the compiled prebuilt
# labextension (including third-party-licenses.json for Help -> Licenses).
python3 -m build
echo "Package built into dist/."

# install the build
pip install dist/*.whl
echo "Package installed from wheel."

# Run Playwright (Galata) integration tests against the installed extension.
cd ./ui-tests
jlpm install
jlpm playwright install
# Installs low-level dependencies required for playwright to launch browsers.
jlpm playwright install-deps
PLAYWRIGHT_JUNIT_OUTPUT_NAME=test-results-latest/sponge_log.xml jlpm playwright test --reporter=junit --output="test-results-latest"
echo "Playwright tests completed."

deactivate
