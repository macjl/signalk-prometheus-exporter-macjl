const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')

const pluginFactory = require('../index')

function isoNow (offsetMs = 0) {
  return new Date(Date.now() + offsetMs).toISOString()
}

function createHarness () {
  const signalk = new EventEmitter()
  const app = {
    selfId: 'urn:mrn:imo:mmsi:123456789',
    signalk
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

  return { app, plugin, renderMetrics, signalk }
}

test('exports numeric and string values for self context', () => {
  const { plugin, renderMetrics, signalk } = createHarness()

  plugin.start({ selfOrAll: 'Self', maxAge: 600 })

  signalk.emit('delta', {
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
  const { plugin, renderMetrics, signalk } = createHarness()

  plugin.start({ selfOrAll: 'Self', maxAge: 600 })

  signalk.emit('delta', {
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
  const { plugin, renderMetrics, signalk } = createHarness()

  plugin.start({ selfOrAll: 'All', maxAge: 600 })

  signalk.emit('delta', {
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
  const { plugin, renderMetrics, signalk } = createHarness()

  plugin.start({
    selfOrAll: 'Self',
    blackOrWhite: 'White',
    blackOrWhitelist: ['navigation.speedOverGround']
  })

  signalk.emit('delta', {
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
  const { plugin, renderMetrics, signalk } = createHarness()

  plugin.start({ selfOrAll: 'Self', maxAge: 600 })

  signalk.emit('delta', {
    context: 'vessels.self',
    updates: [
      {
        $source: 'derived-data',
        timestamp: isoNow(),
        values: [{ path: 'environment.mode', value: 'night' }]
      }
    ]
  })

  signalk.emit('delta', {
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
  const { plugin, renderMetrics, signalk } = createHarness()

  plugin.start({ selfOrAll: 'Self', maxAge: 600 })

  signalk.emit('delta', {
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
  const { plugin, renderMetrics, signalk } = createHarness()

  plugin.start({ selfOrAll: 'Self', maxAge: 600 })

  signalk.emit('delta', {
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
  const { plugin, renderMetrics, signalk } = createHarness()

  plugin.start({ selfOrAll: 'Self', maxAge: 600 })
  plugin.stop()

  signalk.emit('delta', {
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
