/**
 * Menerbitkan skenario uji untuk example-consumer:
 *   1. normal     : poem.submitted v1 puisi A
 *   2. duplikat   : event yang sama persis dikirim ulang
 *   3. basi       : poem.revised v3 lalu v2 untuk puisi A (v2 harus diabaikan)
 *   4. sementara  : puisi B gagal sementara -> 3 kali retry -> DLQ
 *   5. permanen   : puisi C gagal permanen  -> langsung DLQ
 *
 * Jalankan di dalam container:
 *   docker compose exec example-consumer node scripts/kirim-contoh.js
 */
import { randomUUID } from 'node:crypto';
import { buatEvent, buatPublisher, hubungkan, buatLogger } from '@puisiapp/events';

const log = buatLogger('kirim-contoh');
const koneksi = await hubungkan({ log, keluarSaatPutus: false });
const publisher = await buatPublisher(koneksi);

const puisiA = `contoh-${randomUUID().slice(0, 8)}-A`;
const puisiB = `contoh-${randomUUID().slice(0, 8)}-B`;
const puisiC = `contoh-${randomUUID().slice(0, 8)}-C`;
const opsi = { producer: 'kirim-contoh' };

const normal = buatEvent('poem.submitted', puisiA, 1, { judul: 'Jendela yang Basah' }, opsi);
await publisher.terbitkan(normal);
await publisher.terbitkan(normal); // duplikat: event_id sama

await publisher.terbitkan(buatEvent('poem.revised', puisiA, 3, { judul: 'Jendela yang Basah (v3)' }, opsi));
await publisher.terbitkan(buatEvent('poem.revised', puisiA, 2, { judul: 'Jendela yang Basah (v2)' }, opsi));

await publisher.terbitkan(buatEvent('poem.submitted', puisiB, 1, { simulasi_gagal: 'sementara' }, opsi));
await publisher.terbitkan(buatEvent('poem.submitted', puisiC, 1, { simulasi_gagal: 'permanen' }, opsi));

console.log(JSON.stringify({ puisiA, puisiB, puisiC, event_duplikat: normal.event_id }, null, 2));
await publisher.tutup();
await koneksi.close();
