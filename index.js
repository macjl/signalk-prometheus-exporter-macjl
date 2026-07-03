/*
 * Copyright 2016 Teppo Kurki <teppo.kurki@iki.fi>
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

module.exports = function (app) {
  const selfContext = 'vessels.' + app.selfId
  let store = {}
  let maxAgeMs = 600000
  let allShip = 0
  let sourcePolicy = 'preferred'
  let preferredByPath = new Map()
  let lastPrune = 0

  let unsubscribes = []
  let shouldStore = function (path) {
    return true
  }

  const pruneIntervalMs = 30000

  function toPromKey (v) {
    return v.replace(/-|\./g, '_')
  }

  function escapeLabelValue (v) {
    return String(v)
      .replace(/\\/g, '\\\\')
      .replace(/\n/g, '\\n')
      .replace(/"/g, '\\"')
  }

  function toMetrics (store) {
    let r = ''
    const now = Date.now()
    pruneStore(store, now)
    const describedMetrics = new Set()
    for (const key in store) {
      const entry = store[key]
      const k = toPromKey(entry.path)
      if (!describedMetrics.has(k)) {
        describedMetrics.add(k)
        r += `# HELP ${k} ${k}\n`
        r += `# TYPE ${k} gauge\n`
      }

      let labels = `context="${escapeLabelValue(entry.context)}",source="${escapeLabelValue(entry.source)}",signalk_path="${escapeLabelValue(entry.signalkPath)}"`
      if (sourcePolicy === 'all') {
        const preferredSource = getPreferredSource(entry.context, entry.path)
        const preferred = preferredSource ? entry.source === preferredSource : entry.preferred === true
        labels += `,preferred="${preferred ? 'true' : 'false'}"`
      }
      if (entry.strValue) {
        labels += `,value_str="${escapeLabelValue(entry.strValue)}"`
      }

      r += `${k}{${labels}} ${entry.value} ${entry.timestamp}\n`
    }
    return r
  }
  function seriesKey (context, path, source) {
    return context + '\0' + path + '\0' + source
  }

  function pathKey (context, path) {
    return context + '\0' + path
  }

  function getPreferredSource (context, path) {
    const entry = preferredByPath.get(pathKey(context, path))
    return entry && entry.source
  }

  function updatePreferredSource (context, path, source, timestamp) {
    preferredByPath.set(pathKey(context, path), { source, timestamp })
  }

  function pruneStore (store, now) {
    for (const key in store) {
      if (now - store[key].timestamp > maxAgeMs) {
        delete store[key]
      }
    }
    for (const [key, entry] of preferredByPath) {
      if (now - entry.timestamp > maxAgeMs) {
        preferredByPath.delete(key)
      }
    }
  }

  function checkAndStore (path, signalkPath, entry, context, source, timestamp, store, preferred) {
    const stored = {
      path,
      signalkPath,
      value: entry.value,
      context,
      source,
      timestamp
    }
    if (typeof preferred === 'boolean') {
      stored.preferred = preferred
    }

    if (entry.type === 'number') {
      store[seriesKey(context, path, source)] = stored
    } else if (entry.type === 'string') {
      for (const key in store) {
        const existing = store[key]
        if (
          existing.path === path &&
          existing.context === context &&
          existing.source === source &&
          typeof existing.strValue !== 'undefined'
        ) {
          delete store[key]
        }
      }
      store[seriesKey(context, path, source) + '\0str\0' + entry.value] = {
        ...stored,
        value: 1,
        strValue: entry.value
      }
    }
  }
  function flattenJson (pathPrefix, obj, result) {
    result = result || {}
    if (typeof obj === 'number') {
      result[pathPrefix] = { type: 'number', value: obj }
    } else if (typeof obj === 'boolean') {
      result[pathPrefix] = { type: 'number', value: obj ? 1 : 0 }
    } else if (typeof obj === 'string') {
      const d = new Date(obj).getTime()
      if (isNaN(d)) {
        result[pathPrefix] = { type: 'string', value: obj }
      } else {
        result[pathPrefix] = { type: 'number', value: d }
      }
    } else if (typeof obj === 'object' && obj !== null) {
      for (const key in obj) {
        const newPrefix = pathPrefix ? pathPrefix + '.' + key : key
        flattenJson(newPrefix, obj[key], result)
      }
    }
    return result
  }
  function saveDelta (delta, checkShouldStore, store, allShip, preferredMode) {
    if (!delta.updates || delta.updates.length === 0) return
    const now = Date.now()
    if (now - lastPrune > pruneIntervalMs) {
      pruneStore(store, now)
      lastPrune = now
    }
    if (delta.context === 'vessels.self') {
      delta.context = selfContext
    }
    if (delta.updates && (delta.context === selfContext || allShip)) {
      delta.updates.forEach(update => {
        const context = delta.context
        const updateTimestamp = new Date(update.timestamp).getTime()
        const timestamp = Number.isFinite(updateTimestamp) ? updateTimestamp : now
        const source = update.$source
        if (update.values) {
          update.values.forEach(updateValue => {
            if (!updateValue || typeof updateValue.path !== 'string' || updateValue.path === '') {
              return
            }
            const flat = flattenJson(updateValue.path, updateValue.value)
            for (const path in flat) {
              if (checkShouldStore(path)) {
                let preferred
                let shouldStoreValue = true
                if (sourcePolicy === 'all') {
                  if (preferredMode) {
                    updatePreferredSource(context, path, source, timestamp)
                    preferred = true
                  } else {
                    const preferredSource = getPreferredSource(context, path)
                    shouldStoreValue = preferredSource !== source
                    preferred = false
                  }
                }
                if (shouldStoreValue) {
                  checkAndStore(path, updateValue.path, flat[path], context, source, timestamp, store, preferred)
                }
              }
            }
          })
        }
      })
    }
  }

  return {
    id: 'signalk-prometheus-exporter',
    name: 'Prometheus exporter for SignalK',
    description: 'Signal K server plugin exposes a end point for Prometheus to pull from',

    schema: {
      type: 'object',
      required: [],
      properties: {
        blackOrWhite: {
          type: 'string',
          title: 'Type of List',
          description:
            'With a blacklist, all numeric values except the ones in the list below will be stored in InfluxDB. With a whitelist, only the values in the list below will be stored.',
          default: 'Black',
          enum: ['White', 'Black']
        },
        blackOrWhitelist: {
          title: 'SignalK Paths',
          description:
            'A list of SignalK paths to be exluded or included based on selection above',
          type: 'array',
          items: {
            type: 'string',
            title: 'Path'
          }
        },
        selfOrAll: {
          type: 'string',
          title: 'Type of List',
          description:
            'With the Self option, only data from the local boat is exposed in Prometheus format. With the All option, data from all boats is exposed, with the boat identifier included in the context label.',
          default: 'Self',
          enum: ['Self', 'All']
        },
        maxAge: {
          type: 'number',
          title: 'Maximum data age (s)',
          description: 'Metrics older than this age (in seconds) are not exported. Default: 600 (10 minutes).',
          default: 600
        },
        sourcePolicy: {
          type: 'string',
          title: 'Sources to export',
          description: 'With preferred, only the Signal K preferred source is exported. With all, all sources are exported and metrics include a preferred label.',
          default: 'preferred',
          enum: ['preferred', 'all']
        }
      }
    },
    start: function (options) {
      shouldStore = function () {
        return true
      }

      if (
        typeof options.blackOrWhitelist !== 'undefined' &&
        typeof options.blackOrWhite !== 'undefined' &&
        options.blackOrWhitelist.length > 0
      ) {
        const obj = {}

        options.blackOrWhitelist.forEach(element => {
          obj[element] = true
        })

        if (options.blackOrWhite === 'White') {
          shouldStore = function (path) {
            return typeof obj[path] !== 'undefined'
          }
        } else {
          shouldStore = function (path) {
            return typeof obj[path] === 'undefined'
          }
        }
      }
      if (options.selfOrAll === 'All') {
        allShip = 1
      } else {
        allShip = 0
      }
      if (options.maxAge) {
        maxAgeMs = options.maxAge * 1000
      }
      sourcePolicy = options.sourcePolicy === 'all' ? 'all' : 'preferred'
      preferredByPath = new Map()
      lastPrune = 0

      const handlePreferredDelta = function (delta) {
        saveDelta(delta, shouldStore, store, allShip, true)
      }
      const handleAllDelta = function (delta) {
        saveDelta(delta, shouldStore, store, allShip, false)
      }
      if (!app.subscriptionmanager || typeof app.subscriptionmanager.subscribe !== 'function') {
        throw new Error('Signal K subscription manager is required')
      }
      const context = allShip ? '*' : 'vessels.self'
      const subscribe = [
        {
          path: '*'
        }
      ]
      app.subscriptionmanager.subscribe(
        {
          context,
          subscribe
        },
        unsubscribes,
        error => {
          if (app.error) {
            app.error('Prometheus exporter subscription error: ' + error)
          }
        },
        handlePreferredDelta
      )
      if (sourcePolicy === 'all') {
        app.subscriptionmanager.subscribe(
          {
            context,
            sourcePolicy: 'all',
            subscribe
          },
          unsubscribes,
          error => {
            if (app.error) {
              app.error('Prometheus exporter subscription error: ' + error)
            }
          },
          handleAllDelta
        )
      }
    },
    stop: function () {
      unsubscribes.forEach(f => f())
      unsubscribes = []
      shouldStore = function () {
        return true
      }
      store = {}
      preferredByPath = new Map()
      lastPrune = 0
    },
    signalKApiRoutes: function (router) {
      const metricsHandler = function (req, res, next) {
        res.type('text/plain; version=0.0.4; charset=utf-8')
        res.send(toMetrics(store))
      }
      router.get('/prometheus', metricsHandler)
      return router
    }
  }
}
