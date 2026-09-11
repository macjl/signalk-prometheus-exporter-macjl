const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')

const pluginFactory = require('../index')

const sessionStartMetricName = 'signalk_prometheus_exporter_session_start_time_seconds'

function isoNow (offsetMs = 0) {
  return new Date(Date.now() + offsetMs).toISOString()
}

function metricLines (body, name) {
  return body.split('\n').filter(line => line.startsWith(name + '{'))
}

function metricValue (body, name) {
  const line = metricLines(body, name)[0]
  assert.ok(line, `${name} metric was not emitted`)
  return Number(line.slice(line.lastIndexOf(' ') + 1))
}

function createHarness () {
  const signalk = new EventEmitter()
  const subscriptions = []
  const app = {
    selfId: 'urn:mrn:imo:mmsi:123456789',
    signalk,
    subscriptionmanager: {
      subscribe (subscription, unsubscribes, errorCallback, callback) {
        const item = { subscription, errorCallback, callback, closed: false }
        subscriptions.push(item)
        unsubscribes.push(() => {
          item.closed = true
        })
      }
    }
  }

  const plugin = pluginFactory(app)
  let metricsHandler
  const router = {
    get (path, handler) {
      if (path === '/prometheus') {
        metricsHandler = handler
      }
      return this
    }
  }

  plugin.signalKApiRoutes(router)

  function renderMetrics () {
    const response = {
      contentType: undefined,
      body: undefined,
      type (value) {
        this.contentType = value
      },
      send (value) {
        this.body = value
      }
    }

    metricsHandler({}, response, () => {})
    return response
  }

  function emitDelta (delta, subscriptionIndex = 0) {
    const subscription = subscriptions[subscriptionIndex]
    if (subscription && !subscription.closed) {
      subscription.callback(delta)
    }
  }

  return { app, plugin, renderMetrics, signalk, emitDelta, subscriptions }
}

test('exports numeric and string values for self context', () => {
  const { plugin, renderMetrics, emitDelta } = createHarness()

  plugin.start({ selfOrAll: 'Self', maxAge: 600 })

  emitDelta({
    context: 'vessels.self',
    updates: [
      {
        $source: 'nav.can0',
        timestamp: isoNow(),
        values: [
          { path: 'navigation.speedOverGround', value: 3.14 },
          { path: 'environment.mode', value: 'night' }
        ]
      }
    ]
  })

  const response = renderMetrics()
  assert.equal(response.contentType, 'text/plain; version=0.0.4; charset=utf-8')
  assert.match(response.body, /navigation_speedOverGround\{context="vessels\.urn:mrn:imo:mmsi:123456789",source="nav\.can0",signalk_path="navigation\.speedOverGround"\} 3\.14 /)
  assert.match(response.body, /environment_mode\{context="vessels\.urn:mrn:imo:mmsi:123456789",source="nav\.can0",signalk_path="environment\.mode",value_str="night"\} 1 /)
})

test('filters out other vessels when configured for self only', () => {
  const { plugin, renderMetrics, emitDelta } = createHarness()

  plugin.start({ selfOrAll: 'Self', maxAge: 600 })

  emitDelta({
    context: 'vessels.urn:mrn:imo:mmsi:999999999',
    updates: [
      {
        $source: 'remote.ais',
        timestamp: isoNow(),
        values: [{ path: 'navigation.speedOverGround', value: 7.2 }]
      }
    ]
  })

  const response = renderMetrics()
  assert.doesNotMatch(response.body, /navigation_speedOverGround/)
})

test('includes all vessels when configured for all', () => {
  const { plugin, renderMetrics, emitDelta } = createHarness()

  plugin.start({ selfOrAll: 'All', maxAge: 600 })

  emitDelta({
    context: 'vessels.urn:mrn:imo:mmsi:999999999',
    updates: [
      {
        $source: 'remote.ais',
        timestamp: isoNow(),
        values: [{ path: 'navigation.speedOverGround', value: 7.2 }]
      }
    ]
  })

  const response = renderMetrics()
  assert.match(response.body, /context="vessels\.urn:mrn:imo:mmsi:999999999"/)
})

test('applies whitelist filtering', () => {
  const { plugin, renderMetrics, emitDelta } = createHarness()

  plugin.start({
    selfOrAll: 'Self',
    blackOrWhite: 'White',
    blackOrWhitelist: ['navigation.speedOverGround']
  })

  emitDelta({
    context: 'vessels.self',
    updates: [
      {
        $source: 'nav.can0',
        timestamp: isoNow(),
        values: [
          { path: 'navigation.speedOverGround', value: 3.14 },
          { path: 'environment.mode', value: 'night' }
        ]
      }
    ]
  })

  const response = renderMetrics()
  assert.match(response.body, /navigation_speedOverGround/)
  assert.doesNotMatch(response.body, /environment_mode/)
})

test('replaces stale string state instead of exporting both old and new values', () => {
  const { plugin, renderMetrics, emitDelta } = createHarness()

  plugin.start({ selfOrAll: 'Self', maxAge: 600 })

  emitDelta({
    context: 'vessels.self',
    updates: [
      {
        $source: 'derived-data',
        timestamp: isoNow(),
        values: [{ path: 'environment.mode', value: 'night' }]
      }
    ]
  })

  emitDelta({
    context: 'vessels.self',
    updates: [
      {
        $source: 'derived-data',
        timestamp: isoNow(1000),
        values: [{ path: 'environment.mode', value: 'day' }]
      }
    ]
  })

  const response = renderMetrics()
  assert.match(response.body, /value_str="day"/)
  assert.doesNotMatch(response.body, /value_str="night"/)
})

test('uses per-update source and escapes label values in metrics output', () => {
  const { plugin, renderMetrics, emitDelta } = createHarness()

  plugin.start({ selfOrAll: 'Self', maxAge: 600 })

  emitDelta({
    context: 'vessels.self',
    updates: [
      {
        $source: 'nav."can0"',
        timestamp: isoNow(),
        values: [{ path: 'navigation.speedOverGround', value: 3.14 }]
      },
      {
        $source: 'derived\nsource',
        timestamp: isoNow(1000),
        values: [{ path: 'environment.mode', value: 'night"watch' }]
      }
    ]
  })

  const response = renderMetrics()
  assert.match(response.body, /source="nav\.\\"can0\\""/)
  assert.match(response.body, /signalk_path="navigation\.speedOverGround"/)
  assert.match(response.body, /source="derived\\nsource",signalk_path="environment\.mode",value_str="night\\"watch"/)
})

test('keeps original Signal K path when metric name is normalized', () => {
  const { plugin, renderMetrics, emitDelta } = createHarness()

  plugin.start({ selfOrAll: 'Self', maxAge: 600 })

  emitDelta({
    context: 'vessels.self',
    updates: [
      {
        $source: 'nav.can0',
        timestamp: isoNow(),
        values: [{ path: 'custom.path-with-dash', value: 12 }]
      }
    ]
  })

  const response = renderMetrics()
  assert.match(response.body, /custom_path_with_dash\{context="vessels\.urn:mrn:imo:mmsi:123456789",source="nav\.can0",signalk_path="custom\.path-with-dash"\} 12 /)
})

test('keeps object root Signal K path when metric value is flattened', () => {
  const { plugin, renderMetrics, emitDelta } = createHarness()

  plugin.start({ selfOrAll: 'Self', maxAge: 600 })

  emitDelta({
    context: 'vessels.self',
    updates: [
      {
        $source: 'nav.can0',
        timestamp: isoNow(),
        values: [
          {
            path: 'navigation.position',
            value: {
              longitude: -4.2,
              latitude: 48.1
            }
          }
        ]
      }
    ]
  })

  const response = renderMetrics()
  assert.match(response.body, /navigation_position_longitude\{context="vessels\.urn:mrn:imo:mmsi:123456789",source="nav\.can0",signalk_path="navigation\.position"\} -4\.2 /)
  assert.match(response.body, /navigation_position_latitude\{context="vessels\.urn:mrn:imo:mmsi:123456789",source="nav\.can0",signalk_path="navigation\.position"\} 48\.1 /)
})

test('emits session start metric at initialization', () => {
  const { plugin, renderMetrics } = createHarness()

  plugin.start({ selfOrAll: 'Self', maxAge: 600 })

  const response = renderMetrics()
  assert.match(response.body, new RegExp(`# HELP ${sessionStartMetricName} .*invalid`))
  assert.match(response.body, new RegExp(`# TYPE ${sessionStartMetricName} gauge`))

  const lines = metricLines(response.body, sessionStartMetricName)
  assert.equal(lines.length, 1)
  assert.match(lines[0], new RegExp(`^${sessionStartMetricName}\\{source="signalk-prometheus-exporter-macjl"\\} \\d+(\\.\\d+)?$`))
})

test('starts a newer session after reset', async () => {
  const { plugin, renderMetrics } = createHarness()

  plugin.start({ selfOrAll: 'Self', maxAge: 600 })
  const first = metricValue(renderMetrics().body, sessionStartMetricName)

  plugin.stop()
  await new Promise(resolve => setTimeout(resolve, 5))
  plugin.start({ selfOrAll: 'Self', maxAge: 600 })
  const second = metricValue(renderMetrics().body, sessionStartMetricName)

  assert.ok(second > first)
})

test('session start metric has no unbounded labels', () => {
  const { plugin, renderMetrics } = createHarness()

  plugin.start({ selfOrAll: 'All', maxAge: 600, sourcePolicy: 'all' })

  const line = metricLines(renderMetrics().body, sessionStartMetricName)[0]
  assert.ok(line)
  assert.equal(line.match(/\{([^}]*)\}/)[1], 'source="signalk-prometheus-exporter-macjl"')
})

test('keeps notification metrics unchanged', () => {
  const { plugin, renderMetrics, emitDelta } = createHarness()

  plugin.start({ selfOrAll: 'Self', maxAge: 600 })

  emitDelta({
    context: 'vessels.self',
    updates: [
      {
        $source: 'notifications.provider',
        timestamp: isoNow(),
        values: [
          {
            path: 'notifications.anchor',
            value: {
              state: 'alert',
              message: 'Anchor alarm'
            }
          }
        ]
      }
    ]
  })

  const response = renderMetrics()
  assert.match(response.body, /notifications_anchor_state\{context="vessels\.urn:mrn:imo:mmsi:123456789",source="notifications\.provider",signalk_path="notifications\.anchor",value_str="alert"\} 1 /)
  assert.match(response.body, /notifications_anchor_message\{context="vessels\.urn:mrn:imo:mmsi:123456789",source="notifications\.provider",signalk_path="notifications\.anchor",value_str="Anchor alarm"\} 1 /)
})

test('ignores empty Signal K paths', () => {
  const { plugin, renderMetrics, emitDelta } = createHarness()

  plugin.start({ selfOrAll: 'All', maxAge: 600, sourcePolicy: 'all' })

  emitDelta({
    context: 'vessels.urn:mrn:imo:mmsi:227406160',
    updates: [
      {
        $source: 'SpeedAndCurrent',
        timestamp: isoNow(),
        values: [
          { path: '', value: 0 },
          { value: 1 }
        ]
      }
    ]
  }, 1)

  const response = renderMetrics()
  assert.doesNotMatch(response.body, /^\{/m)
  assert.doesNotMatch(response.body, /SpeedAndCurrent/)
})

test('prunes stale values while processing deltas', () => {
  const { plugin, renderMetrics, emitDelta } = createHarness()

  plugin.start({ selfOrAll: 'Self', maxAge: 1 })

  emitDelta({
    context: 'vessels.self',
    updates: [
      {
        $source: 'nav.can0',
        timestamp: isoNow(-31000),
        values: [{ path: 'navigation.speedOverGround', value: 1 }]
      }
    ]
  })

  emitDelta({
    context: 'vessels.self',
    updates: [
      {
        $source: 'nav.can0',
        timestamp: isoNow(),
        values: [{ path: 'navigation.courseOverGroundTrue', value: 2 }]
      }
    ]
  })

  const response = renderMetrics()
  assert.doesNotMatch(response.body, /navigation_speedOverGround/)
  assert.match(response.body, /navigation_courseOverGroundTrue/)
})

test('stop unsubscribes from delta events', () => {
  const { plugin, renderMetrics, emitDelta } = createHarness()

  plugin.start({ selfOrAll: 'Self', maxAge: 600 })
  plugin.stop()

  emitDelta({
    context: 'vessels.self',
    updates: [
      {
        $source: 'nav.can0',
        timestamp: isoNow(),
        values: [{ path: 'navigation.speedOverGround', value: 3.14 }]
      }
    ]
  })

  const response = renderMetrics()
  assert.equal(response.body, '')
})

test('subscribes through subscription manager with all sources for self context', () => {
  const { plugin, subscriptions } = createHarness()

  plugin.start({ selfOrAll: 'Self', maxAge: 600 })

  assert.equal(subscriptions.length, 1)
  assert.deepEqual(subscriptions[0].subscription, {
    context: 'vessels.self',
    subscribe: [
      {
        path: '*'
      }
    ]
  })
})

test('subscribes through subscription manager for all contexts when configured', () => {
  const { plugin, subscriptions } = createHarness()

  plugin.start({ selfOrAll: 'All', maxAge: 600 })

  assert.equal(subscriptions.length, 1)
  assert.equal(subscriptions[0].subscription.context, '*')
  assert.equal(subscriptions[0].subscription.sourcePolicy, undefined)
})

test('subscribes twice and labels preferred state when all sources are configured', () => {
  const { plugin, renderMetrics, emitDelta, subscriptions } = createHarness()

  plugin.start({ selfOrAll: 'Self', maxAge: 600, sourcePolicy: 'all' })

  assert.equal(subscriptions.length, 2)
  assert.deepEqual(subscriptions[0].subscription, {
    context: 'vessels.self',
    subscribe: [
      {
        path: '*'
      }
    ]
  })
  assert.deepEqual(subscriptions[1].subscription, {
    context: 'vessels.self',
    sourcePolicy: 'all',
    subscribe: [
      {
        path: '*'
      }
    ]
  })

  emitDelta({
    context: 'vessels.self',
    updates: [
      {
        $source: 'nav.primary',
        timestamp: isoNow(),
        values: [{ path: 'navigation.speedOverGround', value: 3.14 }]
      }
    ]
  }, 0)

  emitDelta({
    context: 'vessels.self',
    updates: [
      {
        $source: 'nav.primary',
        timestamp: isoNow(1000),
        values: [{ path: 'navigation.speedOverGround', value: 3.15 }]
      },
      {
        $source: 'nav.backup',
        timestamp: isoNow(1000),
        values: [{ path: 'navigation.speedOverGround', value: 2.72 }]
      }
    ]
  }, 1)

  const response = renderMetrics()
  assert.match(response.body, /source="nav\.primary",signalk_path="navigation\.speedOverGround",preferred="true"\} 3\.14 /)
  assert.match(response.body, /source="nav\.backup",signalk_path="navigation\.speedOverGround",preferred="false"\} 2\.72 /)
  assert.doesNotMatch(response.body, /3\.15/)
  assert.equal(response.body.match(/^# HELP navigation_speedOverGround /gm).length, 1)
  assert.equal(response.body.match(/^# TYPE navigation_speedOverGround /gm).length, 1)
})

test('updates preferred label when all-source data arrives before preferred data', () => {
  const { plugin, renderMetrics, emitDelta } = createHarness()

  plugin.start({ selfOrAll: 'Self', maxAge: 600, sourcePolicy: 'all' })

  emitDelta({
    context: 'vessels.self',
    updates: [
      {
        $source: 'nav.primary',
        timestamp: isoNow(),
        values: [{ path: 'navigation.speedOverGround', value: 3.14 }]
      }
    ]
  }, 1)

  emitDelta({
    context: 'vessels.self',
    updates: [
      {
        $source: 'nav.primary',
        timestamp: isoNow(1000),
        values: [{ path: 'navigation.speedOverGround', value: 3.15 }]
      }
    ]
  }, 0)

  const response = renderMetrics()
  assert.match(response.body, /source="nav\.primary",signalk_path="navigation\.speedOverGround",preferred="true"\} 3\.15 /)
})

test('requires the Signal K subscription manager', () => {
  const { app, plugin } = createHarness()
  delete app.subscriptionmanager

  assert.throws(
    () => plugin.start({ selfOrAll: 'Self', maxAge: 600 }),
    /subscription manager is required/
  )
})
