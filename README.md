# Signal K to Prometheus Plugin

Maintained fork of [ieb/signalk-prometheus-exporter](https://github.com/ieb/signalk-prometheus-exporter).

Repository:

`https://github.com/macjl/signalk-prometheus-exporter-macjl`

This plugin exposes a Prometheus scrape endpoint for Signal K data:

`http://localhost:3000/signalk/v1/api/prometheus`

## npm package name

To keep naming consistent with the other public Signal K plugins while avoiding the original package name already taken on npm, future releases are prepared under:

`signalk-prometheus-exporter-macjl`

The Signal K plugin id remains:

`signalk-prometheus-exporter`

## Installation

```sh
npm install --prefix ~/.signalk signalk-prometheus-exporter-macjl
```

## Example output

The Prometheus endpoint contains current values such as:

    # HELP navigation_speedOverGround navigation_speedOverGround
    # TYPE navigation_speedOverGround gauge
    navigation_speedOverGround{context="vessels.urn:mrn:imo:mmsi:227400000",source="Can0.1",signalk_path="navigation.speedOverGround"} 3.155 1765750269678
    # HELP environment_mode environment_mode
    # TYPE environment_mode gauge
    environment_mode{context="vessels.urn:mrn:imo:mmsi:227400000",source="derived-data",signalk_path="environment.mode",value_str="night"} 1 1765750245374
    # HELP navigation_position_longitude navigation_position_longitude
    # TYPE navigation_position_longitude gauge
    navigation_position_longitude{context="vessels.urn:mrn:imo:mmsi:227400000",source="Can0.1",signalk_path="navigation.position"} 17.1383474 1765750269680
    # HELP navigation_position_latitude navigation_position_latitude
    # TYPE navigation_position_latitude gauge
    navigation_position_latitude{context="vessels.urn:mrn:imo:mmsi:227400000",source="Can0.1",signalk_path="navigation.position"} 23.6357923 176575026968

When configured to export all sources, metrics include a `preferred` label:

    navigation_speedOverGround{context="vessels.urn:mrn:imo:mmsi:227400000",source="Can0.1",signalk_path="navigation.speedOverGround",preferred="true"} 3.155 1765750269678
    navigation_speedOverGround{context="vessels.urn:mrn:imo:mmsi:227400000",source="Can0.2",signalk_path="navigation.speedOverGround",preferred="false"} 3.142 1765750269678

The endpoint also exposes an internal exporter session metric:

    # HELP signalk_prometheus_exporter_session_start_time_seconds Unix timestamp in seconds for the current Signal K exporter session; when this value changes, event-driven states received before it should be considered invalid.
    # TYPE signalk_prometheus_exporter_session_start_time_seconds gauge
    signalk_prometheus_exporter_session_start_time_seconds{source="signalk-prometheus-exporter-macjl"} 1789113050.506

Signal K values are still exported from event-driven updates. The plugin does not periodically re-emit all values. The session metric is a validity boundary for alerting rules: after Signal K or the plugin restarts, previous event-driven states should be considered unknown until their source emits them again.

In VictoriaMetrics/MetricsQL, alert rules can use `tlast_over_time()` on event-driven state metrics such as `notifications_*_state` and compare the timestamp of the last state with the latest `signalk_prometheus_exporter_session_start_time_seconds` value. Only states received after the current exporter session started should be considered active. For example, adapt this shape to the notification path and state names you alert on:

```metricsql
tlast_over_time(notifications_anchor_state{value_str="alert"}[24h])
  > scalar(last_over_time(signalk_prometheus_exporter_session_start_time_seconds[24h]))
```

If a standalone plugin restart cannot be distinguished from a full Signal K server restart, the plugin deliberately starts a new session boundary. This fail-closed behavior avoids keeping stale event-driven states active after a restart.

## Notes

- This repository is the maintained fork.
- The npm package name is intentionally distinct from the abandoned upstream package.
- The plugin id stays stable for Signal K compatibility.
- Each exported metric includes the original Signal K path in the `signalk_path` label because Prometheus metric names cannot contain `.`.
