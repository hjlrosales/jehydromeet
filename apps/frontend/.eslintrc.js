module.exports = {
  root: false,
  extends: [
    'next/core-web-vitals',
    '../../.eslintrc.js',
  ],
  rules: {
    // Allow `any` in DOM event handlers
    '@typescript-eslint/no-explicit-any': 'off',
  },
};
