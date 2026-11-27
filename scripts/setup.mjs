// Baja los modelos a public/models y copia los motores WASM a public/wasm.
// Solo hace falta correrlo una vez: después todo funciona sin internet.
import { createWriteStream, existsSync, mkdirSync, cpSync, statSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const models = join(root, 'public', 'models');
const MP = 'https://storage.googleapis.com/mediapipe-models';
const HF = 'https://huggingface.co';

const FILES = [
  ['face_landmarker.task', `${MP}/face_landmarker/face_landmarker/float16/1/face_landmarker.task`],
  ['hand_landmarker.task', `${MP}/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`],
  ['anime_hand.onnx', `${HF}/deepghs/anime_hand_detection/resolve/main/hand_detect_v1.0_n/model.onnx`],
  ['anime_eye.onnx', `${HF}/deepghs/anime_eye_detection/resolve/main/eye_detect_v1.0_n/model.onnx`],
  ['vitpose-animal.onnx', `${HF}/JunkyByte/easy_ViTPose/resolve/main/onnx/apt36k/vitpose-s-apt36k.onnx`],
  ['partes-cuerpo.onnx', `${HF}/Xenova/segformer_b2_clothes/resolve/main/onnx/model_quantized.onnx`],
  ['partes-cara.onnx', `${HF}/Xenova/face-parsing/resolve/main/onnx/model_quantized.onnx`],
  ['dw-ll_ucoco_384.onnx', `${HF}/yzd-v/DWPose/resolve/main/dw-ll_ucoco_384.onnx`],
  ['instanthmr-medium.onnx', `${HF}/momolesang/InstantHMR/resolve/main/instanthmr-medium.onnx`],
  ['mhr-body.onnx', `${HF}/momolesang/InstantHMR/resolve/main/mhr-body.onnx`],
  ['isnet-anime_1024.onnx', `${HF}/jellybox/isnet-anime/resolve/main/isnet-anime_1024.onnx`],
  ['line-art.onnx', `${HF}/rocca/informative-drawings-line-art-onnx/resolve/main/model.onnx`],
  ['efficientdet_lite2.tflite', `${MP}/object_detector/efficientdet_lite2/float16/1/efficientdet_lite2.tflite`],
  ['anime_face.onnx', `${HF}/deepghs/anime_face_detection/resolve/main/face_detect_v1.4_s/model.onnx`],
  ['anime_person.onnx', `${HF}/deepghs/anime_person_detection/resolve/main/person_detect_v1.3_s/model.onnx`],
  ['real_face.onnx', `${HF}/deepghs/real_face_detection/resolve/main/face_detect_v0_s_yv11/model.onnx`],
  ['anime_real.onnx', `${HF}/deepghs/anime_real_cls/resolve/main/mobilenetv3_v1.4_dist/model.onnx`],
  ...['config.json', 'preprocessor_config.json', 'onnx/model_quantized.onnx']
    .map((f) => [`onnx-community/depth-anything-v2-small/${f}`, `${HF}/onnx-community/depth-anything-v2-small/resolve/main/${f}`]),
  ...['config.json', 'preprocessor_config.json', 'onnx/vision_encoder.onnx', 'onnx/prompt_encoder_mask_decoder.onnx']
    .map((f) => [`Xenova/slimsam-77-uniform/${f}`, `${HF}/Xenova/slimsam-77-uniform/resolve/main/${f}`]),
];

/** RTMPose solo se publica dentro de un .zip: se saca el modelo sin dejar el resto. */
async function fetchFromZip(rel, url, suffix) {
  const dest = join(models, rel);
  if (existsSync(dest) && statSync(dest).size > 0) return console.log(`  listo   ${rel}`);
  process.stdout.write(`  bajando ${rel} ... `);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`${res.status} al bajar ${url}`);
  const zip = Buffer.from(await res.arrayBuffer());
  let end = zip.length - 22;
  while (end >= 0 && zip.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error(`${url} no es un .zip`);
  let at = zip.readUInt32LE(end + 16);
  const count = zip.readUInt16LE(end + 10);
  for (let i = 0; i < count; i++) {
    const method = zip.readUInt16LE(at + 10);
    const size = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const name = zip.toString('utf8', at + 46, at + 46 + nameLength);
    if (name.endsWith(suffix)) {
      const local = zip.readUInt32LE(at + 42);
      const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      const raw = zip.subarray(start, start + size);
      writeFileSync(dest, method === 8 ? inflateRawSync(raw) : raw);
      return console.log(`${(statSync(dest).size / 1e6).toFixed(1)} MB`);
    }
    at += 46 + nameLength + zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32);
  }
  throw new Error(`${suffix} no viene en ${url}`);
}

async function fetchTo(rel, url) {
  const dest = join(models, rel);
  if (existsSync(dest) && statSync(dest).size > 0) return console.log(`  listo   ${rel}`);
  mkdirSync(dirname(dest), { recursive: true });
  process.stdout.write(`  bajando ${rel} ... `);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`${res.status} al bajar ${url}`);
  const tmp = `${dest}.part`;
  await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));
  renameSync(tmp, dest);
  console.log(`${(statSync(dest).size / 1e6).toFixed(1)} MB`);
}

/** Las caras de la malla viajan como metadato del modelo: se sacan a un archivo aparte. */
function extractFaces() {
  const dest = join(models, 'mhr-faces.bin');
  if (existsSync(dest)) return;
  const onnx = readFileSync(join(models, 'mhr-body.onnx'));
  let at = onnx.indexOf('mesh_faces') + 'mesh_faces'.length + 1;
  let length = 0;
  for (let shift = 0; ; shift += 7) {
    const b = onnx[at++];
    length |= (b & 127) << shift;
    if (b < 128) break;
  }
  writeFileSync(dest, Buffer.from(onnx.subarray(at, at + length).toString('latin1'), 'base64'));
  console.log('  caras de la malla listas');
}

function copyWasm() {
  const out = join(root, 'public', 'wasm');
  rmSync(out, { recursive: true, force: true });
  mkdirSync(join(out, 'mediapipe'), { recursive: true });
  mkdirSync(join(out, 'ort'), { recursive: true });
  cpSync(join(root, 'node_modules/@mediapipe/tasks-vision/wasm'), join(out, 'mediapipe'), { recursive: true });
  const ort = join(root, 'node_modules/onnxruntime-web/dist');
  for (const f of readdirSync(ort)) {
    if (/^ort-wasm-simd-threaded\.(asyncify|jsep)\.(wasm|mjs)$/.test(f)) cpSync(join(ort, f), join(out, 'ort', f));
  }
  console.log('  motores WASM copiados');
}

console.log('Masu · preparando modelos');
for (const [rel, url] of FILES) await fetchTo(rel, url);
await fetchFromZip('rtmpose-hand.onnx', 'https://download.openmmlab.com/mmpose/v1/projects/rtmposev1/onnx_sdk/rtmpose-m_simcc-hand5_pt-aic-coco_210e-256x256-74fb594_20230320.zip', 'end2end.onnx');
extractFaces();
copyWasm();
console.log('Listo.');
