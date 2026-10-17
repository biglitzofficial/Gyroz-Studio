import { useEffect, useRef, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { readPosition } from "@/lib/studio";

export type OfficePin = { latitude: number; longitude: number };

type Hit = { label: string; latitude: number; longitude: number };

let mapsLoader: Promise<void> | null = null;

function loadGoogleMaps(key: string) {
  if (window.google?.maps?.Map) return Promise.resolve();
  if (!mapsLoader) {
    mapsLoader = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly`;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => {
        mapsLoader = null;
        reject(new Error("Google Maps did not load."));
      };
      document.head.appendChild(script);
    });
  }
  return mapsLoader;
}

export function OfficeMap({
  latitude,
  longitude,
  radius,
  onMove,
}: {
  latitude: number | null;
  longitude: number | null;
  radius: number;
  onMove: (pin: OfficePin) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markerRef = useRef<google.maps.Marker | null>(null);
  const circleRef = useRef<google.maps.Circle | null>(null);
  const onMoveRef = useRef(onMove);
  const chosen = useRef("");
  const hasPin = useRef(false);
  onMoveRef.current = onMove;
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [searchError, setSearchError] = useState("");
  const [locating, setLocating] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const host = box.current;
    if (!host) return;
    let cancelled = false;
    api.get("/maps/key")
      .then(async (response) => {
        const key = String(response.data.data.key ?? "");
        if (!key) throw new Error("Add a Google Maps API key to show the streets.");
        await loadGoogleMaps(key);
        if (cancelled || !box.current || mapRef.current) return;
        const map = new google.maps.Map(box.current, {
          center: { lat: 20.5937, lng: 78.9629 },
          zoom: 5,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          clickableIcons: false,
        });
        const marker = new google.maps.Marker({
          map,
          position: { lat: 20.5937, lng: 78.9629 },
          draggable: true,
          visible: false,
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 8,
            fillColor: "#FFD500",
            fillOpacity: 1,
            strokeColor: "#171717",
            strokeWeight: 2,
          },
        });
        const circle = new google.maps.Circle({
          map,
          center: { lat: 20.5937, lng: 78.9629 },
          radius: 100,
          strokeColor: "#171717",
          strokeWeight: 1,
          fillColor: "#FFD500",
          fillOpacity: 0,
        });
        marker.addListener("dragend", () => {
          const point = marker.getPosition();
          if (!point) return;
          onMoveRef.current({ latitude: point.lat(), longitude: point.lng() });
        });
        map.addListener("click", (event: google.maps.MapMouseEvent) => {
          if (!event.latLng) return;
          onMoveRef.current({ latitude: event.latLng.lat(), longitude: event.latLng.lng() });
        });
        mapRef.current = map;
        markerRef.current = marker;
        circleRef.current = circle;
        setReady(true);
      })
      .catch((error: unknown) => {
        if (!cancelled) setSearchError(error instanceof Error && !("isAxiosError" in error) ? error.message : errorMessage(error));
      });
    return () => {
      cancelled = true;
      markerRef.current?.setMap(null);
      circleRef.current?.setMap(null);
      mapRef.current = null;
      markerRef.current = null;
      circleRef.current = null;
      host.replaceChildren();
      setReady(false);
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const marker = markerRef.current;
    const circle = circleRef.current;
    if (!map || !marker || !circle || latitude == null || longitude == null) return;
    const point = { lat: latitude, lng: longitude };
    const here = marker.getPosition();
    const moved = !hasPin.current || !here || Math.abs(here.lat() - latitude) > 1e-7 || Math.abs(here.lng() - longitude) > 1e-7;
    hasPin.current = true;
    marker.setVisible(true);
    marker.setPosition(point);
    circle.setCenter(point);
    circle.setRadius(Number.isFinite(radius) && radius > 0 ? radius : 100);
    circle.setOptions({ fillOpacity: 0.28 });
    const zoom = map.getZoom() ?? 5;
    const bounds = map.getBounds();
    if (moved && (zoom < 14 || !bounds?.contains(point))) {
      map.setCenter(point);
      map.setZoom(Math.max(zoom, 16));
    }
  }, [latitude, longitude, radius, ready]);

  useEffect(() => {
    const text = query.trim();
    if (!ready || text.length < 3 || text === chosen.current) {
      if (text.length < 3) setHits([]);
      return;
    }
    const timer = window.setTimeout(() => {
      const geocoder = new google.maps.Geocoder();
      geocoder.geocode({ address: text, region: "in" }, (results, status) => {
        if (status !== google.maps.GeocoderStatus.OK || !results?.length) {
          setHits([]);
          setSearchError(status === google.maps.GeocoderStatus.ZERO_RESULTS ? "No place matched that search." : "The map search did not respond. Click the map instead.");
          return;
        }
        const next = results.slice(0, 5).flatMap((result) => {
          const location = result.geometry?.location;
          if (!location) return [];
          return [{ label: result.formatted_address, latitude: location.lat(), longitude: location.lng() }];
        });
        setHits(next);
        setSearchError(next.length ? "" : "No place matched that search.");
      });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [query, ready]);

  function choose(hit: Hit) {
    chosen.current = hit.label;
    setQuery(hit.label);
    setHits([]);
    setSearchError("");
    onMove({ latitude: hit.latitude, longitude: hit.longitude });
    mapRef.current?.setCenter({ lat: hit.latitude, lng: hit.longitude });
    mapRef.current?.setZoom(17);
  }

  async function useDevice() {
    setLocating(true);
    setSearchError("");
    try {
      const position = await readPosition();
      onMove({ latitude: position.latitude, longitude: position.longitude });
      mapRef.current?.setCenter({ lat: position.latitude, lng: position.longitude });
      mapRef.current?.setZoom(17);
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : "Location is not available. Search or click the map.");
    } finally {
      setLocating(false);
    }
  }

  return (
    <div className="px-4 pb-4">
      <div className="mb-3 flex flex-col gap-2 sm:flex-row">
        <input className="control" value={query} placeholder="Search for the studio" aria-label="Search for the studio" onChange={(event) => setQuery(event.target.value)} />
        <button className="btn btn-ink shrink-0" type="button" disabled={locating || !ready} onClick={() => void useDevice()}>{locating ? "Reading location" : "Use this device"}</button>
      </div>
      {hits.length ? (
        <ul className="mb-3 border border-line bg-white">
          {hits.map((hit) => (
            <li key={`${hit.latitude.toFixed(5)},${hit.longitude.toFixed(5)}`}>
              <button className="block w-full px-3 py-2 text-left text-sm hover:bg-[#f7f6f2]" type="button" onClick={() => choose(hit)}>{hit.label}</button>
            </li>
          ))}
        </ul>
      ) : null}
      {searchError ? <p className="mb-3 text-sm text-danger">{searchError}</p> : null}
      <div ref={box} className="office-map" />
      <p className="mt-2 text-sm text-muted">
        {latitude != null && longitude != null
          ? `Pin ${latitude.toFixed(5)}, ${longitude.toFixed(5)}. Drag the pin or click the map. The yellow circle is where a punch is accepted.`
          : "Search for the studio, use this device, or click the map to drop the pin."}
      </p>
    </div>
  );
}
