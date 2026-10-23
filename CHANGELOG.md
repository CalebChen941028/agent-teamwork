# Changelog

All notable changes to this project will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-10-23

### Fixed
- **C1**: `verifyCommand` failure now sets `verifyPassed = false`, correctly increments `openGaps`, adds high-severity audit findings, and fixes the critical bug where conclusion text falsely claimed "终局验收命令通过" on failure.
- **C2**: Superseded milestones that failed prior to replanning are now flagged as `superseded: true` and excluded from `openGaps` and final findings.
- **C3**: Error output truncation now combines stdout and stderr and takes the tail 2000 characters to preserve assertion stack traces.
- **C4**: Adversarial challenger now produces structured JSON `{ foundIssue: boolean, evidence: string }`, ensuring that statements like "找不到实证" do not trigger false critic re-evaluations.
- **C5**: Re-instantiated critic, challenger, and reworker agents with fresh context per milestone to prevent long-context anchor bias.
- **C6**: Rework instructions now explicitly supply the `allowedPaths` of the items being reworked to enforce file modification boundaries.
- **C7**: Parallel milestone item dispatch now uses `Promise.allSettled` with automatic heavy-model retry, and validates `integrityMode` and `teamProfile` enums.
- **C8**: Removed duplicate entries in `notCovered`.

### Added
- Bilingual Scoping Interview Guide (`protocol/scoping-interview.md`).
- Multi-agent adapter templates for Claude Code, OpenCode, Codex, and Generic assistants.
- Comprehensive unit tests in `tests/teamwork.test.mjs`.
