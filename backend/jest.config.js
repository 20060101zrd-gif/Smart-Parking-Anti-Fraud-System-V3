module.exports = {
  testEnvironment: 'node',
  roots: ['../tests/unit'],
  testMatch: ['**/*.test.js'],
  verbose: true,
  collectCoverageFrom: ['src/**/*.js', '!src/data/sqlite.client.js'],
  coverageDirectory: '../tests/reports/coverage',
};
