# Amp Deck

Amp Deck puts your active [Amp](https://ampcode.com/) threads on a Stream Deck+. Choose a thread from the touch strip, see whether it is working or ready, open it in your browser, and send common follow-up commands without returning to the terminal.

![Recommended Amp Deck layout on Stream Deck+](./docs/images/recommended-layout.png)

## What you can do

- See active, unarchived threads reported by Amp and their live state on the Stream Deck+ touch strip.
- Rotate any encoder to choose a thread; all Amp Deck keys follow the same selection.
- Open the selected thread in your default browser.
- Ask the selected thread to review changes or run its repository's shipping workflow.
- Archive a finished thread.
- Use hold-to-confirm for commands that can change code or thread state.
- Optionally add a Show Puck key with 138 bundled variations.

Amp Deck talks to the Amp CLI already installed on your computer. It does not need a separate account, API key, token, or pairing step.

Amp Deck uses Amp's experimental live thread inventory (`amp top --stream-jsonl`). Keep Amp up to date; if that schema changes incompatibly, Amp Deck fails closed and disables thread commands until it receives a valid snapshot.

## Before you start

You will need:

- a **Stream Deck+** for the complete four-encoder status display;
- **Stream Deck 7.1 or newer**;
- **macOS 13.5 or newer**, or **Windows 10 or newer**;
- the current [Amp CLI](https://ampcode.com/manual), signed in to your Amp account.

Show Puck works on Stream Deck devices without encoders. Thread Status and the shared thread selection used by Open, Review, Ship, and Archive require Stream Deck+.

## Supported platforms

- macOS 13.5 or newer
- Windows 10 or newer

## Install Amp Deck

1. Open the [latest Amp Deck release](https://github.com/dinsley/ampdeck/releases/latest).
2. Download `com.dinsley.ampdeck.streamDeckPlugin`.
3. Open the downloaded file and approve the installation in Stream Deck.
4. Confirm that **Amp Deck** appears in the Stream Deck action list.

If you prefer to build the plugin yourself, see [For contributors](#for-contributors).

## Set up your Stream Deck

1. Sign in to Amp and verify that it can list your threads:

   ```shell
   amp login
   amp top
   ```

2. Open the Stream Deck app and find **Amp Deck** in the action list.
3. Add **Thread Status** to all four encoder slots on one Stream Deck+ page. The four slots join into one continuous display.
4. Add **Open Thread**, **Review Thread**, **Ship Thread**, and **Archive Thread** to the keys above the display.
5. Rotate any encoder to choose a thread. The title shown on each command key updates with the shared selection.

Amp Deck uses the Amp CLI and account already available on your computer. There is no separate sign-in step inside Stream Deck.

## Use the plugin

### Choose and open a thread

The Thread Status display is the center of the plugin:

| Control                    | What it does                                                                                          |
| -------------------------- | ----------------------------------------------------------------------------------------------------- |
| Rotate any encoder         | Browse active threads and select the thread now on screen. Shipping and working threads appear first. |
| Press any encoder          | Keep the visible thread selected.                                                                     |
| Tap the touch strip        | Keep the visible thread selected.                                                                     |
| Long-press the touch strip | Open the visible thread on `ampcode.com`.                                                             |
| Press **Open Thread**      | Open the selected thread in your default browser.                                                     |

### Run a thread action

Review, Ship, and Archive are deliberately harder to trigger by accident. Hold the key until its progress bar completes; releasing early cancels the action.

| Action             | How to use    | What it asks Amp to do                                                              |
| ------------------ | ------------- | ----------------------------------------------------------------------------------- |
| **Review Thread**  | Hold the key  | Review the current changes, fix high-confidence issues, and report remaining risks. |
| **Ship Thread**    | Hold the key  | Follow the repository's configured shipping workflow with guarded instructions.     |
| **Archive Thread** | Hold the key  | Archive the selected thread.                                                        |
| **Show Puck**      | Press or hold | Press for the next bundled variation, or hold to choose one at random.              |

Review and Ship require a connected executor. Thread commands are unavailable while the selected thread is working, shipping, offline, or handling another command. After a command is sent, the controls pause briefly to prevent accidental duplicates.

## Understand the thread states

![Idle, Working, Shipping, and Done thread states](./docs/images/thread-states.png)

- **IDLE** — a live executor is connected and ready for another command.
- **WORKING** — Amp is actively planning or using tools in the thread.
- **SHIPPING** — a shipping command was accepted and its workflow is active.
- **DONE** — the current turn finished and no live executor is connected.

The display also shows the thread's project, title, place in the attention-ordered list, time in the current state, latest update, executor availability, and usage cost when available. Missing cost data does not disable the rest of the plugin.

## Understand action feedback

![Ready, holding, busy, sent, unavailable, and error action states](./docs/images/action-feedback.png)

- A progress bar means the key is waiting for the hold to complete.
- **BUSY** means the request is being sent or another command is still cooling down.
- **SENT** means Amp accepted a Review or Ship request. The work may continue in the thread.
- **DONE** means a local action such as Open or Archive completed.
- **UNAVAILABLE** means the action is not safe to run in the current thread state.
- **ERROR** means the immediate action failed; check the Amp thread and plugin log before trying again.

Changing the selected thread while holding a command cancels the command.

## Show Puck

![Four examples from the bundled Puck gallery](./docs/images/puck-gallery.png)

Show Puck is an optional key for adding a little personality to your Stream Deck. Press it to advance to the next variation, or hold it to choose a different variation at random. The key briefly displays the variation's number and name.

## Troubleshooting

### The display says `AMP CLI OFFLINE`

Check Amp from a terminal:

```shell
amp update
amp login
amp top
```

Amp Deck reconnects automatically every few seconds. If `amp top` works but the display remains offline, restart the plugin:

```shell
npx streamdeck restart com.dinsley.ampdeck
```

### The display says `NO ACTIVE THREADS`

Amp is connected, but `amp top` currently reports no active threads. Start or continue an unarchived thread, then give the display a moment to refresh.

### A command says `UNAVAILABLE`

Check that:

- a thread is selected;
- Amp is online;
- the thread is not currently working or shipping;
- Review and Ship have a connected executor; and
- another command is not already in progress.

### Amp works in a terminal but not in Stream Deck

Stream Deck may not see commands installed in a custom terminal location. If Amp is installed somewhere unusual, reinstall it in the standard location or make it available to desktop applications, then restart Stream Deck.

### Review or Ship is unavailable on a completed local thread

Amp Deck enables Review and Ship only when Amp reports that the thread's executor is connected. This ensures the command continues in the correct project. Reconnect the original runner, or continue the thread from a terminal opened in the intended repository. Archive remains available.

### A command shows `ERROR`

Open the Amp thread to look for an approval, clarification request, or error. You can also try the same action from the Amp CLI to reveal authentication, permission, or connection problems.

Development builds write logs inside the linked `.sdPlugin` directory's `logs` folder.

## Safety and privacy

- Authentication stays with the local Amp CLI; Amp Deck does not store its own API key.
- Amp Deck does not include analytics, telemetry, advertising, or a developer-operated network service.
- Thread links are opened only when they are HTTPS URLs on `ampcode.com`.
- Review and Ship can edit files or interact with repository workflows under the selected thread's normal permissions and project guidance.
- Archive changes the thread's server-side archive state as soon as the hold completes.
- If Stream Deck closes while a command is running, check the Amp thread before trying again.

See the complete [Amp Deck privacy statement](./PRIVACY.md).

## Credits and attribution

All bundled Puck images, the Puck icon, other Amp-derived iconography, and the design tokens used to reflect the Amp / Amp Code visual language are attributed to **Amp / Amp Code**.

Amp, Amp Code, Puck, their associated artwork and icons, and their visual design language belong to their respective owners. Amp Deck is an independent project and is not affiliated with or endorsed by Amp / Amp Code.

## License

Amp Deck's original code and documentation are available under the [MIT License](./LICENSE).

The MIT License does not apply to bundled third-party software, Puck artwork, Amp-derived iconography, trademarks, or design elements. Those materials remain subject to their respective owners' rights and the notices below.

## For contributors

Building Amp Deck requires Node.js 24 or newer. Clone the project, install its dependencies, build it, and link it to Stream Deck:

```shell
git clone https://github.com/dinsley/ampdeck.git
cd ampdeck
npm ci
npm run build
npx streamdeck link com.dinsley.ampdeck.sdPlugin
```

Then run the complete project check:

```shell
npm run check
```

`npm run check` verifies formatting, linting, types, tests, the production bundle, and the Stream Deck manifest and layouts.

For local hardware iteration, link the plugin once and start watch mode:

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
| `npm run verify:notices`   | Confirm bundled dependencies appear in third-party notices.    |
| `npm run verify:versions`  | Confirm package and Stream Deck versions match.                |
| `npm run validate`         | Validate the plugin manifest, assets, and layouts.             |

To remove the development link:

```shell
npx streamdeck unlink com.dinsley.ampdeck
```

To prepare a GitHub release, update the version in `package.json` and the four-part
version in `manifest.json`, commit the change, and push a matching
`vMAJOR.MINOR.PATCH` tag. The release workflow runs the complete project check,
packages the plugin, generates a checksum and build provenance attestation, and
assembles the release as a draft before publishing the installer.

Please report security concerns according to [SECURITY.md](./SECURITY.md).

## Third-party notices

Amp Deck bundles the following third-party runtime software:

- `@elgato/streamdeck` 2.1.0 — Copyright (c) Corsair Memory Inc.
- `@elgato/schemas` 0.4.15 — Copyright (c) 2023 Corsair Memory Inc.
- `@elgato/utils` 0.4.5 — Copyright (c) Corsair Memory Inc.
- `entities` 8.0.0 — Copyright (c) Felix Böhm.
- `zod` 3.25.76 — Copyright (c) 2025 Colin McDonnell.
- `ws` 8.21.1 — Copyright (c) 2011 Einar Otto Stangvik; Copyright (c) 2013 Arnout Kazemier and contributors; Copyright (c) 2016 Luigi Pinca and contributors.

<details>
<summary>MIT license used by the Elgato packages, zod, and ws</summary>

Copyright (c) Corsair Memory Inc.<br>
Copyright (c) 2023 Corsair Memory Inc.<br>
Copyright (c) 2025 Colin McDonnell<br>
Copyright (c) 2011 Einar Otto Stangvik <einaros@gmail.com><br>
Copyright (c) 2013 Arnout Kazemier and contributors<br>
Copyright (c) 2016 Luigi Pinca and contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

</details>

<details>
<summary>BSD 2-Clause license used by entities</summary>

Copyright (c) Felix Böhm<br>
All rights reserved.

Redistribution and use in source and binary forms, with or without modification,
are permitted provided that the following conditions are met:

Redistributions of source code must retain the above copyright notice, this list
of conditions and the following disclaimer.

Redistributions in binary form must reproduce the above copyright notice, this
list of conditions and the following disclaimer in the documentation and/or
other materials provided with the distribution.

THIS IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY
EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR
ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON
ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS,
EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

</details>
