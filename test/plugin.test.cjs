const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')

const pluginFactory = require('../index')

function isoNow (offsetMs = 0) {
  return new Date(Date.now() + offsetMs).toISOString()
}

function createHarness () {
  const signalk = new EventEmitter()
  const subscriptionDeltas = new EventEmitter()
  const subscriptions = []
  const app = {
    selfId: 'urn:mrn:imo:mmsi:123456789',
    signalk,
    subscriptionmanager: {
      subscribe (subscription, unsubscribes, errorCallback, callback) {
        subscriptions.push({ subscription, errorCallback })
        const listener = delta => callback(delta)
        subscriptionDeltas.on('delta', listener)
        unsubscribes.push(() => subscriptionDeltas.removeListener('delta', listener))
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

  function emitDelta (delta) {
    subscriptionDeltas.emit('delta', delta)
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
  assert.equal(response.body, '')
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
    sourcePolicy: 'all',
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
  assert.equal(subscriptions[0].subscription.sourcePolicy, 'all')
})

test('requires the Signal K subscription manager', () => {
  const { app, plugin } = createHarness()
  delete app.subscriptionmanager

  assert.throws(
    () => plugin.start({ selfOrAll: 'Self', maxAge: 600 }),
    /subscription manager is required/
  )
})
