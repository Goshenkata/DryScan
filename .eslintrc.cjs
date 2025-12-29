module.exports = {
  root: true,
  env: {
    es2022: true,
    node: true,
  },
  ignorePatterns: ["**/dist/**", "**/coverage/**", "**/node_modules/**"],
  overrides: [
    {
      files: ["**/*.ts", "**/*.tsx"],
      parser: "@typescript-eslint/parser",
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
      plugins: ["@typescript-eslint"],
      extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended"],
      rules: {},
    },
    {
      files: ["**/*.mjs"],
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
      env: {
        node: true,
        es2022: true,
      },
    },
  ],
};
