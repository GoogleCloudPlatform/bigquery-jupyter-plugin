# Integration tests (Galata / Playwright)

End-to-end UI tests for the BigQuery JupyterLab plugin, built on
[Galata](https://github.com/jupyterlab/jupyterlab/tree/main/galata).

The tests are smoke-level and require **no** BigQuery credentials: they verify
that the server extension is reachable, the frontend extension activates and
registers its commands, and the Dataset explorer / query editor UI renders.

## Running locally

From the repository root, build and install the extension into your environment
first:

```bash
jlpm build
pip install -e .
```

Then, from this directory:

```bash
jlpm install
jlpm playwright install chromium
jlpm test
```

`jlpm test` starts a JupyterLab server (via `jupyter_server_test_config.py`) and
runs the Playwright tests against it. Use `jlpm test:update` to refresh
screenshot snapshots if any are added later.
