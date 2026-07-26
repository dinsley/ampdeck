import eslint from "@eslint/js";
import prettier from "eslint-config-prettier";
import globals from "globals";
import tseslint from "typescript-eslint";

const typedFiles = ["src/**/*.ts", "test/**/*.ts"];

export default tseslint.config(
	{
		ignores: ["com.daniel-insley.amp-deck.sdPlugin/bin/**"],
	},
	{
		...eslint.configs.recommended,
		files: ["**/*.{js,mjs,cjs}"],
		languageOptions: {
			globals: globals.node,
		},
	},
	...tseslint.configs.recommendedTypeChecked.map((config) => ({
		...config,
		files: typedFiles,
		languageOptions: {
			...config.languageOptions,
			parserOptions: {
				...config.languageOptions?.parserOptions,
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
			},
		},
	})),
	...tseslint.configs.recommended.map((config) => ({
		...config,
		files: ["amp-plugin/**/*.ts"],
	})),
	{
		files: ["test/**/*.ts"],
		rules: {
			"@typescript-eslint/no-floating-promises": "off",
		},
	},
	prettier,
);
