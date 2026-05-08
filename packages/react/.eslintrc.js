/** @type {import('eslint').Linter.Config} */
module.exports = {
  root: true,
  extends: ["@repo/eslint-config/eslintrc.base.js"],
  parserOptions: {
    project: true,
    tsconfigRootDir: __dirname,
  },
  ignorePatterns: ["build/"],
};
