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
    navigation_position_longitude{context="vessels.urn:mrn:imo:mmsi:227400000",source="Can0.1",signalk_path="navigation.position.longitude"} 17.1383474 1765750269680
    # HELP navigation_position_latitude navigation_position_latitude
    # TYPE navigation_position_latitude gauge
    navigation_position_latitude{context="vessels.urn:mrn:imo:mmsi:227400000",source="Can0.1",signalk_path="navigation.position.latitude"} 23.6357923 176575026968

## Notes

- This repository is the maintained fork.
- The npm package name is intentionally distinct from the abandoned upstream package.
- The plugin id stays stable for Signal K compatibility.
- Each exported metric includes the original Signal K path in the `signalk_path` label because Prometheus metric names cannot contain `.`.
