# Contributing to Amp Deck

Contributing requires Node.js 24 or newer. Clone the project, install dependencies, build, and link the plugin:

```shell
git clone https://github.com/dinsley/ampdeck.git
cd ampdeck
npm ci
npm run build
npx streamdeck link com.dinsley.ampdeck.sdPlugin
```

Run the full project check:

```shell
npm run check
```

`npm run check` covers formatting, linting, types, tests, the production bundle, and Stream Deck validation.

For hardware testing, link once and start watch mode:

```shell
npx streamdeck link com.dinsley.ampdeck.sdPlugin
npm run watch
```

Useful development commands:

| Command                    | Purpose                                                        |
| -------------------------- | -------------------------------------------------------------- |
| `npm run build`            | Build the production plugin bundle.                            |
| `npm run docs:screenshots` | Regenerate the README screenshots from the real SVG templates. |
| `npm run pack`             | Build a local `.streamDeckPlugin` installer in `dist`.         |
| `npm test`                 | Run the Node.js test suite.                                    |
| `npm run lint`             | Run type-aware Oxlint with zero warnings allowed.              |
| `npm run typecheck`        | Type-check without emitting files.                             |
| `npm run format`           | Format the repository with Prettier.                           |
| `npm run validate`         | Validate the plugin manifest, assets, and layouts.             |

Remove the development link with:

```shell
npx streamdeck unlink com.dinsley.ampdeck
```

## Create a release

1. Update `version` in `package.json` using `MAJOR.MINOR.PATCH`.
2. Update `Version` in `com.dinsley.ampdeck.sdPlugin/manifest.json` to the
   matching four-part value, `MAJOR.MINOR.PATCH.0`.
3. Run the full check:

   ```shell
   npm run check
   ```

4. Commit and push the version changes.
5. Create and push the matching tag:

   ```shell
   git tag vMAJOR.MINOR.PATCH
   git push origin vMAJOR.MINOR.PATCH
   ```

The tag starts the `Release` workflow. It confirms that the tag matches
`package.json`, runs the full check, builds the Stream Deck plugin, writes a
SHA-256 checksum, and generates a build provenance attestation. GitHub release
notes are generated automatically, and the release is published after every
step passes.

## Security

Please report security concerns according to [SECURITY.md](./SECURITY.md).
