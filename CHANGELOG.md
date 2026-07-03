# Changelog

## 0.2.0 - 2026-07-03

- Add a source export policy option with preferred-only and all-sources modes.
- Add a `preferred` metric label when all sources are exported.

## 0.1.7 - 2026-07-03

- Use the Signal K subscription manager for delta subscriptions.

## 0.1.6 - 2026-07-03

- Add the original Signal K path as a `signalk_path` metric label.

## 0.1.5 - 2026-07-02

- Add Signal K App Store screenshot metadata.
- Include a Prometheus query screenshot in the published package.
- Add release notes for published package versions.

## 0.1.4 - 2026-07-02

- Maintain the fork under the `signalk-prometheus-exporter-macjl` package name.
- Add automated Signal K plugin CI coverage across supported Node.js platforms.
- Replace legacy development tooling with maintained StandardJS linting.
- Add tests for Prometheus metric rendering, filtering, label escaping, and lifecycle cleanup.
- Document the Prometheus scrape endpoint and example output.
