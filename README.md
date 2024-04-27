# bigquery_jupyter_plugin

BigQuery JupyterLab Plugin

This extension provides extensions to JupyterLab for working with BigQuery.

## Requirements

- JupyterLab >= 4.0.0

## Install

To install the extension, execute:

```bash
pip install bigquery_jupyter_plugin
```

## Uninstall

To remove the extension, execute:

```bash
pip uninstall bigquery_jupyter_plugin
```

## Troubleshoot

To check if the server extension is enabled:

```bash
jupyter server extension list
```

## Contributing

### Installing from your local repo/branch

```bash
pip install -e ".[test]"
```

### Testing the extension

#### Server tests

This extension is using [Pytest](https://docs.pytest.org/) for Python code testing.

Install test dependencies (needed only once):

```sh
pip install -e ".[test]"
```

To execute them, run:

```sh
pytest -vv -r ap --cov bigquery_jupyter_plugin
```

### Packaging the extension

See [RELEASE](RELEASE.md)
