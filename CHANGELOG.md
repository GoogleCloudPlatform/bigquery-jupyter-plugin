# Changelog

<!-- <START NEW CHANGELOG ENTRY> -->

## 0.1.4

First PyPI release since 0.1.2. 0.1.3 was tagged on GitHub but never reached PyPI, so this release also includes everything in [0.1.3](https://github.com/GoogleCloudPlatform/bigquery-jupyter-plugin/releases/tag/v0.1.3): Workbench usage telemetry and publishing through OSS Exit Gate.

([Full Changelog](https://github.com/GoogleCloudPlatform/bigquery-jupyter-plugin/compare/v0.1.3...c32a6742e7c91431665fbcb945b9712de035f853))

### Merged PRs

- build: emit core metadata 2.4 for OSS Exit Gate [#46](https://github.com/GoogleCloudPlatform/bigquery-jupyter-plugin/pull/46) ([@bcreddy-gcp](https://github.com/bcreddy-gcp), [@Michael-at-Google](https://github.com/Michael-at-Google))

### Contributors to this release

The following people contributed discussions, new ideas, code and documentation contributions, and review.
See [our definition of contributors](https://github-activity.readthedocs.io/en/latest/use/#how-does-this-tool-define-contributions-in-the-reports).

([GitHub contributors page for this release](https://github.com/GoogleCloudPlatform/bigquery-jupyter-plugin/graphs/contributors?from=2026-11-23&to=2026-11-23&type=c))

@bcreddy-gcp ([activity](https://github.com/search?q=repo%3AGoogleCloudPlatform%2Fbigquery-jupyter-plugin+involves%3Abcreddy-gcp+updated%3A2026-11-23..2026-11-23&type=Issues)) | @Michael-at-Google ([activity](https://github.com/search?q=repo%3AGoogleCloudPlatform%2Fbigquery-jupyter-plugin+involves%3AMichael-at-Google+updated%3A2026-11-23..2026-11-23&type=Issues))

<!-- <END NEW CHANGELOG ENTRY> -->

## 0.1.3

([Full Changelog](https://github.com/GoogleCloudPlatform/bigquery-jupyter-plugin/compare/v0.1.2...3d2b9f453a0235fa629f8ae390769ccc33eb648f))

### Merged PRs

- feat: add Workbench usage telemetry [#39](https://github.com/GoogleCloudPlatform/bigquery-jupyter-plugin/pull/39) ([@bcreddy-gcp](https://github.com/bcreddy-gcp), [@Michael-at-Google](https://github.com/Michael-at-Google), [@kevinyang8](https://github.com/kevinyang8))
- chore: migrate PyPI release workflow to OSS Exit Gate [#38](https://github.com/GoogleCloudPlatform/bigquery-jupyter-plugin/pull/38) ([@zarturod](https://github.com/zarturod), [@bcreddy-gcp](https://github.com/bcreddy-gcp))

### Contributors to this release

The following people contributed discussions, new ideas, code and documentation contributions, and review.
See [our definition of contributors](https://github-activity.readthedocs.io/en/latest/use/#how-does-this-tool-define-contributions-in-the-reports).

([GitHub contributors page for this release](https://github.com/GoogleCloudPlatform/bigquery-jupyter-plugin/graphs/contributors?from=2026-09-25&to=2026-11-23&type=c))

@bcreddy-gcp ([activity](https://github.com/search?q=repo%3AGoogleCloudPlatform%2Fbigquery-jupyter-plugin+involves%3Abcreddy-gcp+updated%3A2026-09-25..2026-11-23&type=Issues)) | @kevinyang8 ([activity](https://github.com/search?q=repo%3AGoogleCloudPlatform%2Fbigquery-jupyter-plugin+involves%3Akevinyang8+updated%3A2026-09-25..2026-11-23&type=Issues)) | @Michael-at-Google ([activity](https://github.com/search?q=repo%3AGoogleCloudPlatform%2Fbigquery-jupyter-plugin+involves%3AMichael-at-Google+updated%3A2026-09-25..2026-11-23&type=Issues)) | @zarturod ([activity](https://github.com/search?q=repo%3AGoogleCloudPlatform%2Fbigquery-jupyter-plugin+involves%3Azarturod+updated%3A2026-09-25..2026-11-23&type=Issues))

## 0.1.0

Initial public release of the BigQuery Dataset explorer plugin for JupyterLab 4:
the Dataset explorer side panel, table Details / Schema / Preview, the query
editor (dry-run cost estimate, run, results pagination), and query history.
