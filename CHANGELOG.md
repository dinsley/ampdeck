# Changelog

All notable changes to Amp Deck are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- An animated Stream Deck+ showcase covering ready, hold, sent, working, shipping, and completed states.
- A supported-devices note, including the Stream Deck+ testing scope and future CORSAIR GALLEON 100 SD goal.
- A standalone contribution guide and GitHub funding configuration.

### Changed

- Refined the README layout, installation steps, device artwork, attribution, and release links.
- Simplified generated documentation assets to the transparent Puck artwork and animated device showcase.
- Removed the duplicated project name from generated GitHub release names.

## [0.1.0] - 2026-07-27

### Added

- Stream Deck+ encoder displays for active Amp threads, shared thread selection, status, executor availability, update time, and usage cost.
- Open, Review, Ship, and Archive actions with hold-to-confirm behavior and guarded command dispatch.
- An optional Show Puck action with 138 bundled variations.
- Cross-platform Amp CLI discovery for macOS, Windows, and Linux development environments.
- Automated checks, Stream Deck validation, release packaging, checksums, and build provenance where supported.

### Security

- Restricted thread links to HTTPS URLs on `ampcode.com`.
- Disabled commands when Amp data is invalid or the selected thread state makes an action unsafe.

[Unreleased]: https://github.com/dinsley/ampdeck/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/dinsley/ampdeck/releases/tag/v0.1.0
