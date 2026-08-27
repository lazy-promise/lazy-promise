/** @type {import('eslint').Linter.Config} */
module.exports = {
  root: true,
  extends: ["@repo/eslint-config/eslintrc.base.js"],
  parserOptions: {
    // These two props tell typescript-eslint to use tsconfig from the same
    // directory as this file.
    project: true,
    tsconfigRootDir: __dirname,
  },
  ignorePatterns: ["build/"],
};
