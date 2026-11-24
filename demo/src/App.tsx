import { useEffect, useRef, useState } from 'react'
import { Map, NavigationControl, setWorkerUrl } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { DotDensityLayer } from 'maplibre-gl-dot-density'
import './App.css'

import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'

setWorkerUrl(workerUrl)

const GROUPS = [
  { field: 'd_lths', label: '< HS', color: '#d73027' },
  { field: 'd_hs', label: 'HS', color: '#fc8d59' },
  { field: 'd_somecol', label: 'some col', color: '#fee090' },
  { field: 'd_ba', label: 'BA', color: '#91bfdb' },
  { field: 'd_grad', label: 'grad', color: '#4575b4' },
] as const

function App() {
  const mapRef = useRef<Map | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const layerRef = useRef(new DotDensityLayer({
    id: 'education-dots',
    source: {
      type: 'pmtiles',
      url: new URL(`${import.meta.env.BASE_URL}counties_edu.pmtiles`, window.location.origin).href,
    },
    'source-layer': 'counties',
    fields: GROUPS.map((g) => g.field),
    colors: GROUPS.map((g) => g.color),
    dotValue: 200,
    referenceZoom: 10,
    zoomExponent: 1,
  }))
  const [visible, setVisible] = useState(() => GROUPS.map(() => true))
  const [status, setStatus] = useState('Loading tiles…')

  function toggleGroup(index: number) {
    const next = !visible[index]
    setVisible((current) => current.map((on, i) => (i === index ? next : on)))
    layerRef.current.setGroupVisible(index, next)
  }

  useEffect(() => {
    let cancelled = false

    const map = new Map({
      container: containerRef.current!,
      style: 'https://tiles.openfreemap.org/styles/dark',
      center: [-98.5, 39.8],
      zoom: 4.2,
    })
    mapRef.current = map
    map.addControl(new NavigationControl(), 'top-right')

    map.on('error', (event) => {
      if (cancelled) return
      setStatus(event.error?.message ?? 'Map failed to load')
    })

    map.on('load', () => {
      const currentMap = mapRef.current
      if (!currentMap) return
      currentMap.addLayer(layerRef.current)
    })

    map.on('render', () => {
      if (cancelled) return
      const info = layerRef.current.getDebugInfo()
      if (!info) return
      setStatus(
        `z ${map.getZoom().toFixed(2)}  k ${info.peoplePerDot?.toFixed(0)} people/dot  ` +
        `ready ${info.ready}  loading ${info.loading}  ` +
        `drawn ${info.drawn}  empty ${info.empty}  aborted ${info.aborted}`,
      )
    })

    return () => {
      cancelled = true
      mapRef.current?.remove()
      mapRef.current = null
    }
  }, [])

  return (
    <>
      <div ref={containerRef} id="map" />
      <aside id="panel">
        <h1>Educational attainment</h1>
        <p id="note">Population age 25 and older. Click a swatch to hide it.</p>
        <div id="legend">
          {GROUPS.map((item, index) => (
            <button
              type="button"
              key={item.field}
              className={visible[index] ? undefined : 'off'}
              onClick={() => toggleGroup(index)}
            >
              <span className="swatch" style={{ background: item.color }} />
              {item.label}
            </button>
          ))}
        </div>
        <p id="status">{status}</p>
      </aside>
    </>
  )
}

export default App
