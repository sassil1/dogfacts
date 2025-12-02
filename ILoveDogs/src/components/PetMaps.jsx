import { useEffect, useMemo, useState } from 'react'
import { MapContainer, TileLayer, Marker, Popup, CircleMarker, useMap } from 'react-leaflet'
import MarkerClusterGroup from 'react-leaflet-cluster'
import { HeatmapLayer } from 'react-leaflet-heatmap-layer-v3'
import L from 'leaflet'
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'

// Fix default icon paths under bundlers like Vite
L.Marker.prototype.options.icon = L.icon({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
})

const SOC_DATA_URL = 'https://data.montgomerycountymd.gov/resource/e54u-qx42.json?$limit=5000'

const DEFAULT_CENTER = [39.1547, -77.2405]
const DEFAULT_ZOOM = 10

const toRad = (d) => (d * Math.PI) / 180
function haversineKm(a, b) {
  const R = 6371
  const dLat = toRad(b[0] - a[0])
  const dLon = toRad(b[1] - a[1])
  const lat1 = toRad(a[0])
  const lat2 = toRad(b[0])
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

function getCoordsFromRecord(rec) {
  const candidates = ['intake_location', 'location', 'found_location']
  for (const k of candidates) {
    const v = rec[k]
    if (v && typeof v === 'object' && 'latitude' in v && 'longitude' in v) {
      const lat = parseFloat(v.latitude)
      const lng = parseFloat(v.longitude)
      if (Number.isFinite(lat) && Number.isFinite(lng)) return [lat, lng]
    }
  }
  return null
}

function bestAddress(rec) {
  return (
    rec.intake_location?.human_address ||
    rec.found_location?.human_address ||
    rec.intake_location ||
    rec.found_location ||
    rec.address ||
    rec.location_text ||
    null
  )
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const CACHE_KEY = 'geoCache_v1'

async function geocode(address) {
  if (!address) return null
  try {
    const cache = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}')
    if (cache[address]) return cache[address]
    await sleep(1100)
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(
      `${address}, Montgomery County, MD`,
    )}`
    const res = await fetch(url, { headers: { 'Accept-Language': 'en' } })
    if (!res.ok) return null
    const json = await res.json()
    if (!json?.length) return null
    const lat = parseFloat(json[0].lat)
    const lng = parseFloat(json[0].lon)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
    cache[address] = [lat, lng]
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache))
    return [lat, lng]
  } catch {
    return null
  }
}

function FitBounds({ points, pad = 0.1 }) {
  const map = useMap()
  useEffect(() => {
    if (!points?.length) return
    const lats = points.map((p) => p.lat)
    const lngs = points.map((p) => p.lng)
    const south = Math.min(...lats)
    const west = Math.min(...lngs)
    const north = Math.max(...lats)
    const east = Math.max(...lngs)
    if (
      Number.isFinite(south) &&
      Number.isFinite(west) &&
      Number.isFinite(north) &&
      Number.isFinite(east)
    ) {
      map.fitBounds(
        [
          [south, west],
          [north, east],
        ],
        { padding: [map.getSize().x * pad, map.getSize().y * pad] },
      )
    }
  }, [map, points, pad])
  return null
}

export default function PetMaps() {
  const [records, setRecords] = useState([])
  const [points, setPoints] = useState([])
  const [loading, setLoading] = useState(true)
  const [geoError, setGeoError] = useState(null)
  const [userPos, setUserPos] = useState(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(SOC_DATA_URL)
        const data = await res.json()
        if (!cancelled) setRecords(Array.isArray(data) ? data : [])
      } catch {
        if (!cancelled) setRecords([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!records.length) {
        setPoints([])
        setLoading(false)
        return
      }
      const out = []
      const MAX_GEOCODE = 150
      let geocoded = 0

      for (const rec of records) {
        let coords = getCoordsFromRecord(rec)
        if (!coords) {
          const addrSource = bestAddress(rec)
          if (addrSource && geocoded < MAX_GEOCODE) {
            const addr =
              typeof addrSource === 'string'
                ? addrSource
                : typeof addrSource === 'object' && addrSource.address
                ? `${addrSource.address} ${addrSource.city || ''} ${addrSource.state || ''} ${addrSource.zip || ''}`
                : null
            if (addr) {
              const g = await geocode(addr)
              if (g) {
                coords = g
                geocoded += 1
              }
            }
          }
        }
        if (coords) {
          const [lat, lng] = coords
          const photo = Array.isArray(rec.photo_links)
            ? rec.photo_links[0]
            : rec.photo_links
          out.push({
            lat,
            lng,
            rec,
            photo,
            name: rec.name || rec.animalid || 'Unknown',
            species: rec.species || 'PET',
            address:
              typeof rec.intake_location === 'string'
                ? rec.intake_location
                : rec.intake_location?.human_address || rec.found_location || '',
          })
        }
      }
      if (!cancelled) {
        setPoints(out)
        setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [records])

  useEffect(() => {
    if (!('geolocation' in navigator)) {
      setGeoError('Geolocation not available')
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => setUserPos([pos.coords.latitude, pos.coords.longitude]),
      (err) => setGeoError(err.message || 'Geolocation denied'),
    )
  }, [])

  const nearest = useMemo(() => {
    if (!userPos || !points.length) return []
    const withDist = points.map((p) => ({
      ...p,
      dist: haversineKm(userPos, [p.lat, p.lng]),
    }))
    withDist.sort((a, b) => a.dist - b.dist)
    return withDist.slice(0, 25)
  }, [userPos, points])

  const heatPoints = useMemo(() => points.map((p) => [p.lat, p.lng, 1]), [points])

  if (loading) return <p>Loading pets and locations…</p>
  if (!points.length) return <p>No mappable pets yet. Try reloading or allowing a few to geocode.</p>

  return (
    <div style={{ display: 'grid', gap: 24 }}>
      <section>
        <h2>Heatmap: Concentrations</h2>
        <MapContainer center={DEFAULT_CENTER} zoom={DEFAULT_ZOOM} style={{ height: 360, width: '100%' }}>
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap" />
          <HeatmapLayer
            fitBoundsOnLoad
            fitBoundsOnUpdate
            points={heatPoints}
            longitudeExtractor={(m) => m[1]}
            latitudeExtractor={(m) => m[0]}
            intensityExtractor={(m) => m[2]}
            radius={20}
            max={1}
          />
        </MapContainer>
      </section>

      <section>
        <h2>Clustered: Intake/Found Locations</h2>
        <MapContainer center={DEFAULT_CENTER} zoom={DEFAULT_ZOOM} style={{ height: 360, width: '100%' }}>
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap" />
          <FitBounds points={points} />
          <MarkerClusterGroup chunkedLoading>
            {points.map((p, i) => (
              <Marker key={i} position={[p.lat, p.lng]}>
                <Popup>
                  <div style={{ maxWidth: 240 }}>
                    <div style={{ fontWeight: 600 }}>
                      {p.name} ({p.species})
                    </div>
                    {p.photo ? (
                      <img src={p.photo} alt={p.name} style={{ width: '100%', margin: '6px 0' }} />
                    ) : null}
                    <div style={{ fontSize: 12 }}>{p.address}</div>
                  </div>
                </Popup>
              </Marker>
            ))}
          </MarkerClusterGroup>
        </MapContainer>
      </section>

      <section>
        <h2>Nearest Adoptable Pets</h2>
        {!userPos && (
          <p>{geoError ? `Location unavailable: ${geoError}` : 'Allow location to see nearest pets.'}</p>
        )}
        <MapContainer
          center={userPos || DEFAULT_CENTER}
          zoom={userPos ? 12 : DEFAULT_ZOOM}
          style={{ height: 360, width: '100%' }}
        >
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap" />
          {userPos ? (
            <>
              <FitBounds points={nearest.length ? nearest : points} />
              <CircleMarker center={userPos} radius={8} pathOptions={{ color: '#1e88e5' }} />
              {nearest.map((p, i) => (
                <Marker key={i} position={[p.lat, p.lng]}>
                  <Popup>
                    <div style={{ maxWidth: 240 }}>
                      <div style={{ fontWeight: 600 }}>
                        {p.name} ({p.species})
                      </div>
                      <div style={{ fontSize: 12 }}>{p.address}</div>
                      <div style={{ fontSize: 12, marginTop: 4 }}>
                        Distance: {p.dist.toFixed(1)} km
                      </div>
                      {p.photo ? (
                        <img src={p.photo} alt={p.name} style={{ width: '100%', marginTop: 6 }} />
                      ) : null}
                    </div>
                  </Popup>
                </Marker>
              ))}
            </>
          ) : null}
        </MapContainer>
      </section>
    </div>
  )
}


