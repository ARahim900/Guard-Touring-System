// Reads a position from what people paste: "23.5413, 58.6334" (Google Maps
// copies this when you press and hold on the map) or a Google Maps link.

const valid = (lat: number, lng: number): [number, number] | null =>
  Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0) ? [lat, lng] : null;

export function parseCoordinates(text: string): [number, number] | null {
  const input = decodeURIComponent(text.trim());
  if (!input) return null;
  // Exact place in a Google Maps link: ...!3d23.54!4d58.63
  const place = input.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  if (place) return valid(Number(place[1]), Number(place[2]));
  // Map centre or query in a link: @23.54,58.63,17z  ?q=23.54,58.63  ll=23.54,58.63
  const linked = input.match(/(?:@|[?&](?:q|query|ll|center|destination)=)(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/);
  if (linked) return valid(Number(linked[1]), Number(linked[2]));
  // Plain pair: "23.54, 58.63" or "23.54 58.63"
  const pair = input.match(/^(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)$/);
  return pair ? valid(Number(pair[1]), Number(pair[2])) : null;
}
