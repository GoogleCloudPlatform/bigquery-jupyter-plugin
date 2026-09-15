const jestJupyterLab = require('@jupyterlab/testutils/lib/jest-config');

const esModules = [
  '@codemirror',
  '@jupyter/ydoc',
  '@jupyterlab/',
  '@lumino/',
  'lib0',
  'nanoid',
  'vscode-ws-jsonrpc',
  'y-protocols',
  'y-websocket',
  'yjs'
].join('|');

const baseConfig = jestJupyterLab(__dirname);

module.exports = {
  ...baseConfig,
  automock: false,
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/**/*.spec.{ts,tsx}',
    '!src/**/.ipynb_checkpoints/*'
  ],
  coverageReporters: ['lcov', 'text'],
  reporters: ['default'],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  testRegex: '\\.spec\\.tsx?$',
  // ui-tests/*.spec.ts are Galata/Playwright integration tests, not jest.
  testPathIgnorePatterns: ['/lib/', '/node_modules/', '<rootDir>/ui-tests/'],
  // Don't scan build output / the venv / compiled lib / ui-tests (avoids Haste
  // collisions and keeps jest to the unit suite).
  modulePathIgnorePatterns: [
    '<rootDir>/bigquery_jupyter_plugin/labextension/',
    '<rootDir>/.venv/',
    '<rootDir>/lib/',
    '<rootDir>/ui-tests/'
  ],
  transformIgnorePatterns: [`/node_modules/(?!${esModules}).+`]
};
