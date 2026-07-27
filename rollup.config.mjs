import commonjs from "@rollup/plugin-commonjs";
import nodeResolve from "@rollup/plugin-node-resolve";
import swc from "@rollup/plugin-swc";
import terser from "@rollup/plugin-terser";
import { rmSync } from "node:fs";
import path from "node:path";
import url from "node:url";

const isWatching = !!process.env.ROLLUP_WATCH;
const sdPlugin = "com.dinsley.ampdeck.sdPlugin";

/**
 * @type {import('rollup').RollupOptions}
 */
const config = {
	input: "src/plugin.ts",
	output: {
		file: `${sdPlugin}/bin/plugin.js`,
		sourcemap: isWatching,
		sourcemapPathTransform: (relativeSourcePath, sourcemapPath) => {
			return url.pathToFileURL(path.resolve(path.dirname(sourcemapPath), relativeSourcePath)).href;
		},
	},
	plugins: [
		{
			name: "clean-production-output",
			buildStart() {
				if (isWatching) return;
				for (const fileName of ["plugin.js", "plugin.js.map", "package.json"]) {
					rmSync(path.resolve(sdPlugin, "bin", fileName), { force: true });
				}
			},
		},
		{
			name: "svg-as-string",
			transform(source, id) {
				if (id.endsWith(".svg")) {
					return { code: `export default ${JSON.stringify(source)};`, map: null };
				}
			},
		},
		{
			name: "watch-externals",
			buildStart: function () {
				this.addWatchFile(`${sdPlugin}/manifest.json`);
				this.addWatchFile(`${sdPlugin}/layouts`);
			},
		},
		swc({
			swc: {
				jsc: {
					parser: { syntax: "typescript" },
					target: "es2024",
				},
				sourceMaps: isWatching,
			},
		}),
		nodeResolve({
			browser: false,
			extensions: [".mjs", ".js", ".json", ".node", ".ts"],
			exportConditions: ["node"],
			preferBuiltins: true,
		}),
		commonjs(),
		!isWatching && terser(),
		{
			name: "emit-module-package-file",
			generateBundle() {
				this.emitFile({ fileName: "package.json", source: `{ "type": "module" }`, type: "asset" });
			},
		},
	],
};

export default config;
