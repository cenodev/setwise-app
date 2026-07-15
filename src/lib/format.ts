export function truncateAddress(address: string): string {
  if (address.length < 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function truncateDecimal(value: string, decimalPlaces: number): string {
  const [integer, fraction = ""] = value.split(".");
  if (!integer) return "0";
  if (decimalPlaces <= 0 || fraction.length === 0) return integer;
  return `${integer}.${fraction.slice(0, decimalPlaces)}`;
}
