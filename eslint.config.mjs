import nextPlugin from "@next/eslint-plugin-next";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

// React Compiler rules from eslint-plugin-react-hooks 7. They report 30
// places (set state in an effect, refs read during render) in 26 files, 11 of
// which open pull requests change. They warn until those places are fixed
// (SLN-308); rules-of-hooks and the Next rules block as usual.
const reactCompilerRules = Object.fromEntries(
  Object.entries(reactHooks.configs["recommended-latest"].rules)
    .filter(([rule]) => rule !== "react-hooks/rules-of-hooks" && rule !== "react-hooks/exhaustive-deps")
    .map(([rule]) => [rule, "warn"]),
);

const VENDOR_RULE = "Only src/lib/reader/engines/foliate/ may import foliate-js: use the ReaderEngine interface";

/** @type {import("eslint").Linter.Config[]} */
const eslintConfig = [
  {
    ignores: [
      "node_modules/",
      ".next/",
      "src/lib/db/migrations/",
      "**/*.test.ts",
      // foliate-js, vendored as published (VENDORED.md there)
      "src/vendor/",
    ],
  },
  ...tseslint.configs.recommended,
  {
    plugins: { "react-hooks": reactHooks, "@next/next": nextPlugin },
    rules: {
      ...reactHooks.configs["recommended-latest"].rules,
      ...reactCompilerRules,
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
    },
  },
  {
    linterOptions: {
      reportUnusedDisableDirectives: "warn",
      reportUnusedInlineConfigs: "off",
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-empty-object-type": "off",
    },
  },
  // Only the foliate adapter may reach the vendored engine; everything else
  // talks to ReaderEngine (src/lib/reader/engine.ts). Dynamic imports too.
  {
    files: ["src/**/*.{ts,tsx,js,mjs}"],
    ignores: ["src/lib/reader/engines/foliate/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [{ group: ["**/vendor/foliate-js", "**/vendor/foliate-js/**"], message: VENDOR_RULE }] },
      ],
      "no-restricted-syntax": [
        "error",
        { selector: "ImportExpression[source.value=/vendor\\/foliate-js/]", message: VENDOR_RULE },
      ],
    },
  },
];

export default eslintConfig;
