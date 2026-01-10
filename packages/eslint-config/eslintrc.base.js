/** @type {import('eslint').Linter.Config} */
module.exports = {
  // Only lint ts/tsx files. Setting up eslint for checking JS files proved too
  // messy.
  ignorePatterns: ["*.js", "*.jsx", "*.mjs", "*.cjs"],
  plugins: [
    "prefer-arrow",
    "eslint-plugin-only-warn",
    "eslint-plugin-import",
    "eslint-plugin-expect-type",
  ],
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/base",
    "plugin:@typescript-eslint/eslint-recommended",
    "prettier",
    "plugin:eslint-comments/recommended",
    "turbo",
    "plugin:eslint-plugin-expect-type/recommended",
  ],
  rules: {
    // All the lint rules here are marked as "error" as opposed to "warning",
    // but it doesn't matter because "eslint-plugin-only-warn" turns them all
    // into warnings.

    //
    // Fix "eslint:recommended"
    //

    // Not sold on original justification.
    "no-ex-assign": "off",

    //
    // Rules that prevent unused code
    //

    "no-unused-vars": "off",
    "@typescript-eslint/no-unused-vars": [
      "error",
      { ignoreRestSiblings: true },
    ],
    "eslint-comments/no-unused-disable": "error",
    "no-useless-rename": "error",
    "object-shorthand": "error",
    "no-constant-condition": "off",
    "@typescript-eslint/no-unnecessary-condition": [
      "error",
      { allowConstantLoopConditions: true },
    ],
    "@typescript-eslint/await-thenable": "error",
    "@typescript-eslint/no-unnecessary-type-assertion": "error",

    //
    // Consistency rules
    //

    "prefer-arrow/prefer-arrow-functions": "error",
    "arrow-body-style": "error",
    curly: "error",
    // The code is easier to follow when you know that a symbol is always
    // defined up above unless this rule is disabled for the line (the case of
    // cyclical references).
    "no-use-before-define": "error",
    // This makes it easier to tell if the return value of a callback is used.
    "@typescript-eslint/no-confusing-void-expression": "error",
    "no-restricted-syntax": [
      "error",
      {
        selector:
          "ImportDeclaration[source.value='react'] :matches(ImportDefaultSpecifier, ImportNamespaceSpecifier)",
        message:
          'For consistency, prefer named imports to `import * as React from "react"`. For types, use `React.*` w/o importing.',
      },
    ],
    // TS will complain if you import a type without the `type` specifier, but
    // it will miss the case when we import a real symbol and then only use it
    // in a typeof expression. That's why we include this rule.
    "@typescript-eslint/consistent-type-imports": [
      "error",
      { prefer: "type-imports" },
    ],
    "import/consistent-type-specifier-style": ["error", "prefer-top-level"],
    "require-await": "error",

    //
    // Misc
    //

    // Reminds to remove temp logs.
    "no-console": "error",
    "@typescript-eslint/no-floating-promises": "error",
  },
};
