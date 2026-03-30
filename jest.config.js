/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'jsdom',
  testMatch: ['**/tests/**/*.test.js', '**/*.test.js'],
  collectCoverageFrom: [
    'game.js',
    'functions.js',
    '!node_modules/'
  ],
  coverageDirectory: 'coverage',
  verbose: true,
};
