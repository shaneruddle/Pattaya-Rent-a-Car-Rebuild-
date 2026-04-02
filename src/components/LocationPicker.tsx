import React, { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix for default marker icon in Leaflet with React
// @ts-ignore
import icon from 'leaflet/dist/images/marker-icon.png';
// @ts-ignore
import iconShadow from 'leaflet/dist/images/marker-shadow.png';

let DefaultIcon = L.icon({
    iconUrl: icon,
    shadowUrl: iconShadow,
    iconSize: [25, 41],
    iconAnchor: [12, 41]
});

L.Marker.prototype.options.icon = DefaultIcon;

const MapUpdater: React.FC<{ center: [number, number] }> = ({ center }) => {
  const map = useMap();
  useEffect(() => {
    map.setView(center);
    // Fix for Leaflet maps in modals/hidden containers
    setTimeout(() => {
      map.invalidateSize();
    }, 250);
  }, [center, map]);
  return null;
};

const OFFICE_LOCATION: [number, number] = [12.914909448882886, 100.86727314994509];

interface LocationPickerProps {
  location?: { lat: number; lng: number };
  onChange: (loc: { lat: number; lng: number }) => void;
  disabled?: boolean;
  height?: string;
}

export const LocationPicker: React.FC<LocationPickerProps> = ({ 
  location, 
  onChange, 
  disabled,
  height = "450px"
}) => {
  const containerRef = React.useRef<HTMLDivElement>(null);

  const MapEvents = () => {
    const map = useMap();

    useEffect(() => {
      if (!containerRef.current) return;

      const observer = new ResizeObserver(() => {
        // Use a small delay to ensure the DOM has settled
        setTimeout(() => {
          map.invalidateSize();
        }, 100);
      });

      observer.observe(containerRef.current);
      return () => observer.disconnect();
    }, [map]);

    useMapEvents({
      click(e) {
        if (!disabled) {
          onChange({ lat: e.latlng.lat, lng: e.latlng.lng });
        }
      },
    });
    return null;
  };

  const center: [number, number] = location ? [location.lat, location.lng] : OFFICE_LOCATION;

  return (
    <div 
      ref={containerRef}
      className="w-full rounded-lg overflow-hidden border border-gray-200 mt-2 z-0" 
      style={{ height }}
    >
      <MapContainer center={center} zoom={15} scrollWheelZoom={false} style={{ height: '100%', width: '100%' }}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <MapEvents />
        <MapUpdater center={center} />
        <Marker 
          position={location ? [location.lat, location.lng] : OFFICE_LOCATION} 
          draggable={!disabled}
          eventHandlers={{
            dragend: (e) => {
              const marker = e.target;
              const position = marker.getLatLng();
              onChange({ lat: position.lat, lng: position.lng });
            },
          }}
        />
      </MapContainer>
    </div>
  );
};
