module.exports = {
  root: false,
  extends: ['../../.eslintrc.js'],
  env: {
    node: true,
    browser: false,
  },
  rules: {
    '@typescript-eslint/no-explicit-any': 'off',
  },
};
