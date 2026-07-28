# Troubleshooting Amp Deck

## Open Amp Deck diagnostics

Diagnostics are part of each Amp Deck action's property inspector. There is no standalone Diagnostics option in the Stream Deck menus or on the physical device.

1. Open the **Stream Deck desktop application**.
2. Switch to a profile and page containing an Amp Deck action.
3. In the device preview, click an **Amp Deck action already assigned to a key or encoder**. Selecting the Amp Deck category in the action list is not enough.
4. The action's configuration/property-inspector pane opens automatically beside or below the device preview, depending on the Stream Deck version and available window space.
5. Locate **Amp Deck diagnostics** in the pane.

If no Amp Deck action is assigned yet, drag any Amp Deck action from the action list onto the profile, then select that placed action. If the pane is not visible, maximize or widen the window and select the action again.

## Recommended diagnostic workflow

1. Select **Refresh** to collect the latest local health state.
2. Check **Compatibility preflight** and **Status source**. Thread commands remain disabled until compatibility passes and live status is available.
3. Select **Test connection** to rerun the Amp CLI version, capability, authentication, and response checks.
4. If automatic discovery cannot find the intended Amp installation, choose **Custom absolute path**, enter the full executable path, and select **Save and test**. The existing working setting is kept if the new path fails validation or preflight.
5. Use **Reset** to test and restore automatic executable discovery.
6. If you still need help, select **Copy report**, review the sanitized text, and include it in a GitHub issue.

Amp Deck requires Amp CLI `0.0.1785170481` or newer and fails closed until its capability and authentication preflight
passes. The property inspector shows the current preflight phase or a sanitized, actionable failure. Invalid custom paths never silently fall back.

## Common states

- **Amp CLI executable was not found:** install the Amp CLI and verify `amp --version` works. Stream Deck does not inherit every interactive-shell `PATH`, but Amp Deck checks Amp's default installation and common Homebrew locations.
- **Amp version is unsupported or a required capability is missing:** update the Amp CLI, verify `amp --version`, and run **Test connection** again.
- **Amp authentication is unavailable:** sign in with the Amp CLI, then refresh diagnostics.
- **Schema compatibility — mismatch:** update Amp Deck and the Amp CLI. Controls remain disabled because the live status response does not satisfy the required safety schema.
- **Timeout or transient failure:** verify network access and retry. The diagnostics panel shows the next automatic retry time.
- **Thread commands disabled:** reconnect Amp status and select a thread. Individual commands can remain unavailable while a thread is working, shipping, lacks a connected executor, or is processing another command.

## Requesting support

Use **Copy report** and paste the result into a [GitHub issue](https://github.com/dinsley/ampdeck/issues). The report is bounded and excludes raw snapshots, prompts, command text, thread titles and URLs, executable and repository paths, authentication data, and unrestricted process output. Review the report before posting it publicly.
