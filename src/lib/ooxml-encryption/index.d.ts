export declare function encryptWorkbook(
  xlsx: Uint8Array,
  password: string
): Promise<Uint8Array>;

export declare function decryptWorkbook(
  encrypted: Uint8Array,
  password: string
): Promise<Uint8Array>;
