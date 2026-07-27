# Amp Deck

Amp Deck turns a Stream Deck into a compact command center for [Amp](https://ampcode.com/). Follow active threads from the Stream Deck+ touch strip, choose the thread you want to control, open it in a browser, and send guarded review, shipping, or archive commands without leaving your desk.

> [!NOTE]
> Amp Deck is currently an early, source-distributed release. This repository does not currently include packaged release downloads.

## What it does

- Shows unarchived Amp threads and their live state on the four Stream Deck+ encoders.
- Prioritizes shipping and working threads while keeping every visible thread in reach.
- Shares one selected thread across the status display and all thread command keys.
- Displays the selected thread's project, title, activity, executor state, last update, and usage cost when available.
- Adds deliberate hold-to-confirm controls for review, shipping, and archive operations.
- Includes an optional Show Puck key with 138 bundled variations.

Amp Deck reads thread data and sends commands through the Amp CLI running under your desktop user account. There is no separate Amp Deck account, token field, or pairing service.

## Requirements

### To use the plugin

- A **Stream Deck+** for the four-encoder Thread Status display. Keypad actions can also be placed on Stream Deck devices with keys.
- **Stream Deck 7.1 or newer**.
- **macOS 12 or newer**, or **Windows 10 or newer**.
- A current [Amp CLI](https://ampcode.com/manual) installation, signed in to your Amp account.
- At least one unarchived Amp thread to display.

### To build from source

- **Node.js 24 or newer**.
- npm (included with Node.js).

## Install from source

Until packaged releases are available, link a local build into Stream Deck:

```shell
git clone https://github.com/dinsley/ampdeck.git
cd ampdeck
npm ci
npm run build
npx streamdeck link com.daniel-insley.amp-deck.sdPlugin
```

The link command registers the plugin directory with the Stream Deck app. If Amp Deck does not appear immediately, restart the Stream Deck app or run:

```shell
npx streamdeck restart com.daniel-insley.amp-deck
```

To remove the development link later:

```shell
npx streamdeck unlink com.daniel-insley.amp-deck
```

## Connect Amp

Amp Deck uses the same local credentials as the Amp CLI, so setup is simply:

1. Install Amp and make sure the `amp` command is available.
2. Sign in from a terminal:

   ```shell
   amp login
   ```

3. Confirm that Amp can see your threads:

   ```shell
   amp top
   ```

4. Open Stream Deck, find **Amp Deck** in the action list, and add the actions you want to a profile.
5. For the complete status surface, place **Thread Status** in **all four Stream Deck+ encoder slots** on the same page. Each encoder renders its slice of one continuous display.

No additional device-to-Amp pairing is required. Amp Deck first looks for the standard Amp installation at `~/.amp/bin/amp` (or `~/.amp/bin/amp.exe` on Windows), then falls back to `amp` on the Stream Deck app's `PATH`.

## Actions and controls

All thread controls target the thread selected on the **Thread Status** action. Thread commands are intentionally unavailable while the selected thread is actively working or while the live Amp connection is offline.

| Action             | Device control                 | Behavior                                                                                                                                                                                                                                   |
| ------------------ | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Thread Status**  | Rotate an encoder              | Move through unarchived threads and select the newly displayed thread. Threads are ordered by attention: shipping first, then working, then the rest.                                                                                      |
| **Thread Status**  | Press an encoder               | Select the thread currently shown.                                                                                                                                                                                                         |
| **Thread Status**  | Tap the touch strip            | Keep the displayed thread selected.                                                                                                                                                                                                        |
| **Thread Status**  | Long-press the touch strip     | Open the displayed thread on `ampcode.com`.                                                                                                                                                                                                |
| **Open Thread**    | Press the key                  | Open the selected thread in the default browser.                                                                                                                                                                                           |
| **Review Thread**  | Hold for 1 second              | Continue the selected thread with a focused request to review current changes, fix high-confidence issues, and report risks. Requires a connected executor; a 10-second shared cooldown prevents accidental or conflicting commands.       |
| **Ship Thread**    | Hold for 2 seconds             | Continue the selected thread with a guarded request to run the repository's configured shipping workflow. Requires a connected executor; the command adds the permanent `shipping` label while Amp Deck tracks active shipping separately. |
| **Archive Thread** | Hold for 1.5 seconds           | Archive the selected thread through the Amp CLI.                                                                                                                                                                                           |
| **Show Puck**      | Press the key                  | Advance to the next bundled variation.                                                                                                                                                                                                     |
| **Show Puck**      | Hold for at least 0.75 seconds | Choose a different bundled variation at random.                                                                                                                                                                                            |

The command keys show hold progress and brief success, sent, unavailable, or error feedback. Releasing a command key before its hold completes cancels the operation.

### Reading Thread Status

The touch-strip display reports one of four primary states:

- **WORKING** — Amp is actively processing the thread.
- **IDLE** — a live executor is connected and ready for another command.
- **DONE** — the current turn completed and no live executor is connected.
- **SHIPPING** — a shipping command was just accepted or a labeled shipping workflow is actively working. The permanent label alone does not leave a completed thread in this state.

The display also shows the thread's position in the attention-ordered list, elapsed time in the current state, relative update time, executor availability, and selected-thread usage cost. Usage is supplementary; the rest of the controls continue to work if cost data cannot be loaded.

## Suggested layout

On a Stream Deck+ page:

1. Fill all four encoder slots with **Thread Status**.
2. Put **Open Thread**, **Review Thread**, **Ship Thread**, and **Archive Thread** on keys above the display.
3. Rotate any encoder to choose a thread. The key labels update to reflect that shared selection.
4. Check the selected title before holding a command key. Changing the selection while holding cancels the command.

## Troubleshooting

### The display says `AMP CLI OFFLINE` or keeps reconnecting

Run `amp top` in a terminal. If it cannot connect, update or sign in to Amp and try again:

```shell
amp update
amp login
amp top
```

Amp Deck retries the status stream automatically every few seconds. If `amp top` works but the plugin remains offline, restart Amp Deck from the repository:

```shell
npx streamdeck restart com.daniel-insley.amp-deck
```

### The display says `NO ACTIVE THREADS`

Amp is connected, but there are no unarchived threads in the live inventory. Create or unarchive a thread, then allow the display a moment to refresh.

### A command key says `UNAVAILABLE`

Make sure:

- a thread is selected;
- the Amp connection is live;
- the selected thread is not currently working;
- for **Review Thread** and **Ship Thread**, that Amp reports a connected executor; and
- the thread is not actively shipping.

Commands also stay unavailable briefly while a previous request is being sent or cooling down.

### Amp works in a terminal but not in Stream Deck

Desktop apps can inherit a different `PATH` from terminal shells. The standard `~/.amp/bin/amp` installation is detected directly. If Amp is installed elsewhere, make it available to GUI applications or reinstall it in the standard location, then restart Stream Deck.

### A command shows an error alert

Try the equivalent operation in the Amp CLI to expose authentication, permissions, or connectivity errors. Review and Ship continue a thread in detached execute mode, so any repository approvals or clarification requests appear in that Amp thread rather than in Stream Deck.

Amp Deck waits for Amp's streamed user-message acknowledgement before showing `SENT`. An accepted command can still fail later; those nonzero exits are recorded in the plugin log.

### Review or Ship is unavailable on a completed local thread

`amp threads continue <id>` does not restore the original checkout when a local thread's executor has disconnected: it uses the caller's current directory, and the CLI has no supported project or working-directory override. A packaged Stream Deck plugin therefore cannot safely continue that thread without risking work in the wrong repository. Amp Deck fails closed by requiring an executor that Amp already reports as connected. Reconnect the original runner or continue the thread from a terminal in the intended checkout. Archive remains available because it is a server-side thread operation and does not execute repository tools.

For development builds, plugin logs are written under the linked `.sdPlugin` directory's `logs` folder. The Stream Deck app's plugin logs can provide the underlying CLI or rendering error.

## Platform notes

- Amp Deck runs locally through Stream Deck's bundled Node.js runtime; installing Node.js is only necessary for source builds.
- Opening a thread uses the operating system's default browser and accepts only HTTPS thread URLs on `ampcode.com`.
- Review and Ship can cause an Amp agent to edit files or interact with repository workflows. They use conservative prompts, but the selected thread's normal Amp permissions and project guidance still apply.
- Review and Ship use a hidden detached CLI process with piped output so Amp Deck can verify acceptance and report immediate errors. Amp Deck drains both output streams while the plugin is running. Native process survival after Stream Deck forcibly terminates or upgrades the plugin remains operating-system and host dependent; check the Amp thread before retrying an interrupted command.
- Amp's live `top --stream-jsonl` status schema is experimental. Amp Deck validates its command-safety fields strictly and disables controls on a mismatch until a valid snapshot arrives. Shipping-label restart recovery is best effort because the current CLI search returns at most 100 matching threads; immediate dispatch tracking remains authoritative during the current plugin session.
- Archive changes the thread's server-side archive state immediately after the hold completes.
- Amp Deck does not store an Amp API key of its own. Authentication remains managed by the Amp CLI.

## Development

Install dependencies and run the complete project check:

```shell
npm ci
npm run check
```

`npm run check` verifies formatting, linting, types, tests, the production bundle, and the Stream Deck manifest/layouts.

For local hardware iteration, link the plugin once and start watch mode:

```shell
npx streamdeck link com.daniel-insley.amp-deck.sdPlugin
npm run watch
```

Watch mode rebuilds changed TypeScript and restarts `com.daniel-insley.amp-deck` in Stream Deck. Other useful commands are:

| Command             | Purpose                                                                           |
| ------------------- | --------------------------------------------------------------------------------- |
| `npm run build`     | Create the production plugin bundle in `com.daniel-insley.amp-deck.sdPlugin/bin`. |
| `npm test`          | Run the Node.js test suite.                                                       |
| `npm run lint`      | Run ESLint with zero warnings allowed.                                            |
| `npm run typecheck` | Type-check without emitting files.                                                |
| `npm run format`    | Format the repository with Prettier.                                              |
| `npm run validate`  | Validate the plugin manifest, assets, and layouts with the Stream Deck CLI.       |

## Releases

The plugin version is maintained in `com.daniel-insley.amp-deck.sdPlugin/manifest.json`. Before preparing a release, maintainers should update that four-part version, run `npm run check`, and then use the Stream Deck CLI packaging flow only after confirming the artwork, naming, signing, and distribution permissions for the intended channel:

```shell
npx streamdeck pack com.daniel-insley.amp-deck.sdPlugin
```

Packaging or publishing is not part of the normal build and should not be performed without maintainer approval.

## Project status

Amp Deck is an independent, early-stage project. Amp and Stream Deck behavior may evolve, so keep the Amp CLI and Stream Deck app current and report reproducible issues with operating system, Stream Deck version, Amp CLI version, and relevant plugin log messages.
