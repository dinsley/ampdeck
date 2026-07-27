# Amp Deck privacy

Amp Deck does not collect analytics or telemetry, display advertising, or communicate with a service operated by the Amp Deck developer.

## Data the plugin uses

Amp Deck invokes the Amp CLI already installed and authenticated on your computer. It reads the active thread information returned by that CLI, including thread identifiers, titles, project names, URLs, activity state, executor availability, update times, and display-cost information.

Thread information and usage costs are held in memory while the plugin is running. Amp Deck stores only the selected Show Puck variation and the thread identifier and timestamps needed to restore in-progress shipping state in Stream Deck settings. Shipping state expires automatically if work does not begin and is removed after the workflow finishes.

Amp Deck does not read or store your Amp access token. Commands sent through Review, Ship, or Archive use the permissions and authentication of your local Amp CLI. Data handled by Amp and Stream Deck is subject to their respective privacy terms.

## Network access

Amp Deck does not connect directly to a service operated by the Amp Deck developer. It invokes the local Amp CLI, which communicates with Amp when it lists threads, retrieves usage information, or performs a requested thread action. The Open Thread action may ask Stream Deck to open an allowlisted `https://ampcode.com/threads/...` URL in your browser.

## Contact

For privacy questions, open an issue in the [Amp Deck repository](https://github.com/dinsley/ampdeck/issues).
