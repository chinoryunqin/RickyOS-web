export const metalioFactoryLayout = 'metalio-eink4-factory-v1';

export const metalio = Object.freeze({
  board: 'metalio_eink4',
  label: 'Metalio E-Ink 4（普通版）',
  file: 'Metalio-E-Ink4',
  chip: { name: 'ESP32-S3', id: 9 },
  name: 'Metalio E-Ink 4',
  model: '普通版',
  screen: '480 × 800',
  note: ['原厂系统可从这里首次安装 RickyOS。', '装好后可从「设置 → 系统 → RickyOS 更新」升级。'],
});

// The ordinary model and Plus use the same vendor partition table.
// The app chip ID and exact project ID distinguish the two models.
const factoryTableSha256 = '6428c34dea4556ac826952221e9c99094c6963f21613b5db03e309f7a8d09ebb';
const factoryOtaOffset = 0xd000;
const factoryAppOffsets = [0x80000, 0x580000];

// Exact running images from the development and release bench. Use the
// ESP stub’s digest instead of transferring megabytes over serial.
const knownApps = [
  { size: 6002384, md5: 'b88ffc8553384d2ecf72fdf72d4a217f' },
  { size: 6005040, md5: '111ef28f16a8a416d74ae3845be60c58' },
  { size: 6005104, md5: '0ba1e00b3df840d669cd9235a798277a' },
];

export async function inspectMetalioFactory(table, read, { sha256, activeOffset }) {
  if (await sha256(table) !== factoryTableSha256) return null;
  const factoryOta = await read(factoryOtaOffset, 8192);
  if (factoryOta.length !== 8192) return null;
  let slot;
  try {
    // The factory bootloader falls back to ota_0 if both records are erased.
    slot = factoryOta.every(value => value === 255) || activeOffset(factoryOta) === 0x10000 ? 0 : 1;
  } catch {
    return null;
  }
  const app = await read(factoryAppOffsets[slot], 4096);
  if (app.length !== 4096) return null;
  const view = new DataView(app.buffer, app.byteOffset, app.byteLength);
  const project = new TextDecoder().decode(app.subarray(80, 112)).split('\0')[0];
  if (app[0] !== 0xe9 || app[1] < 1 || app[1] > 16 || view.getUint16(12, true) !== metalio.chip.id ||
      view.getUint32(28, true) < 256 || view.getUint32(32, true) !== 0xabcd5432 || project !== 'Metalio-E-Ink4')
    return null;
  return { factoryOta, factoryApp: app };
}

export async function inspectMetalio(table, ota, io, policy) {
  const factory = await inspectMetalioFactory(table, io.read, policy);
  if (factory) return { ...factory, kind: 'factory', layout: metalioFactoryLayout, board: metalio.board, table, ota };
  let offset;
  try {
    await policy.checkPartitions(table);
    offset = policy.activeOffset(ota);
  } catch {
    return null;
  }
  for (const { size, md5 } of knownApps) {
    if (await io.digest(offset, size) === md5) return { kind: 'upgrade', board: metalio.board, table, ota, offset };
  }
  return null;
}

export const metalioUnsupported = '未识别到支持的 Metalio E-Ink 4 普通版原厂系统或 RickyOS。请检查机型和当前系统。';
