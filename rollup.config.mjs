import commonjs from "@rollup/plugin-commonjs";
import nodeResolve from "@rollup/plugin-node-resolve";
import terser from "@rollup/plugin-terser";
import typescript from "@rollup/plugin-typescript";
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
		typescript({
			mapRoot: isWatching ? "./" : undefined,
			tsconfig: "./tsconfig.build.json",
		}),
		nodeResolve({
			browser: false,
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
