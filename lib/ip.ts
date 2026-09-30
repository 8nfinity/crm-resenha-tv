/**
 * Comparação de segredos e verificação de faixa de IP.
 *
 * Vive fora do middleware.ts para poder ser testado. Só usa APIs disponíveis no
 * Edge Runtime — nada de node:crypto aqui.
 */

/** Comparação em tempo constante, para não vazar o tamanho do prefixo correto. */
export function secretsMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** "192.168.1.1" -> 3232235777. Null se não for IPv4 válido. */
export function ipv4ToInt(ip: string): number | null {
  const parts = ip.trim().split(".");
  if (parts.length !== 4) return null;

  let result = 0;
  for (const part of parts) {
    // A checagem de formato é estrita de propósito: "01" e "1e2" não podem
    // passar como octetos válidos.
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    result = (result << 8) | octet;
  }

  // >>> 0 força inteiro sem sinal: o shift do JS opera em 32 bits com sinal, e
  // qualquer IP acima de 127.x.x.x sairia negativo daqui.
  return result >>> 0;
}

export function ipInCidr(ip: string, cidr: string): boolean {
  const [range, bitsRaw] = cidr.split("/");
  if (bitsRaw === undefined) return false;

  const bits = Number(bitsRaw);
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;

  const ipInt = ipv4ToInt(ip);
  const rangeInt = ipv4ToInt(range);
  if (ipInt === null || rangeInt === null) return false;

  if (bits === 0) return true;
  const mask = (0xffffffff << (32 - bits)) >>> 0;
  return (ipInt & mask) === (rangeInt & mask);
}
