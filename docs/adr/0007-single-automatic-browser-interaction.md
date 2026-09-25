# Use one automatic browser interaction path

Status: Accepted

Date: 2026-09-25

## Context

The product previously supported both automatic browser operation and a separate manual
submission workflow. Keeping both required separate model and connector setup, browser-turn
protocol, launcher flow, configuration, and troubleshooting. Browser-only and Full harness already
express the product's meaningful capability distinction: whether ChatGPT can call local Codex tools.

## Decision

Remove the manual Zero Risk workflow. Browser-only and Full harness both use automatic browser
operation; Full harness additionally provides local Codex tools through MCP. Preserve ordinary user
controls over browser pages, including inspection, navigation, and explicit close or cancellation.

When loading an older configuration, retain saved automatic app and tunnel values when available.
If its interaction mode was manual, ignore manual-only app and tunnel values and use the native
defaults, leaving the tunnel unset. Remove obsolete mode and manual-only fields when writing the
normalized configuration.

## Consequences

There is one browser interaction model to configure, document, and support. Browser-only and Full
harness remain separate choices only for local-tool capability. Existing automatic installations
keep their app and tunnel settings; old manual-only settings are not reused.
