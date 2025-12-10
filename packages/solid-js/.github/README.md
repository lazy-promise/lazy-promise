# Experimental SolidJS bindings for LazyPromise

## Installation

```bash
npm install @lazy-promise/core @lazy-promise/solid-js pipe-function
```

## Usage

Please see JSDocs for the functions in the `src` directory in this package.

For details on LazyPromise, please see [root readme](https://github.com/lazy-promise/lazy-promise).

If you use `eslint-plugin-solid`, add the `pipe` function to `customReactiveFunctions` in ESLint config (it's not a reactive function but `eslint-plugin-solid` doesn't know to correctly interpret what this function does):

```
"solid/reactivity": [
  "warn",
  {
    customReactiveFunctions: ["pipe"],
  },
],
```
