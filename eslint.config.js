import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  { ignores: ["dist/", "src-tauri/", "vendor/", "node_modules/", "release.local/"] },
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // react-hooks v7 的 React Compiler 系新规则存量 32 处，先 warn，
      // 随 P3 组件重构清零后升 error；经典 rules-of-hooks 保持 error
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/purity": "warn",
      // P2-1 API 层迁移后存量已清零，升 error 硬门禁；
      // 仅 Book.id 类型分裂桥接点保留 3 处定点豁免（P3 统一后删除）
      "@typescript-eslint/no-explicit-any": "error",
      "no-console": ["error", { allow: ["warn", "error"] }],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-empty": ["error", { allowEmptyCatch: false }],
    },
  },
  prettier,
);
