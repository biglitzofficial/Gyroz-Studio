export function distanceMeters(from: { latitude: number; longitude: number }, to: { latitude: number; longitude: number }) {
  const earth = 6_371_000;
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitude = radians(to.latitude - from.latitude);
  const longitude = radians(to.longitude - from.longitude);
  const chord = Math.sin(latitude / 2) ** 2
    + Math.cos(radians(from.latitude)) * Math.cos(radians(to.latitude)) * Math.sin(longitude / 2) ** 2;
  return Math.round(earth * 2 * Math.atan2(Math.sqrt(chord), Math.sqrt(1 - chord)));
}

export function punchOutsideOffice(distance: number, radius: number, accuracy: number) {
  const credit = Math.min(Math.max(Number.isFinite(accuracy) ? accuracy : 0, 0), 40);
  return distance > radius + credit;
}
