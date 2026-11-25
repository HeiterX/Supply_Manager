import {
  Injectable,
  PayloadTooLargeException,
  ServiceUnavailableException,
  StreamableFile,
} from '@nestjs/common';
import writeXlsxFile, { type SheetData } from 'write-excel-file/node';
import { reportTimeZone, type Format } from './discovery.dto.js';
import type { Cell } from './discovery.selections.js';

export type ExportTable = { headings: string[]; rows: Cell[][] };
const stamp = new Intl.DateTimeFormat('sv-SE', {
  timeZone: reportTimeZone,
  dateStyle: 'short',
  timeStyle: 'medium',
});
const maxExportTextBytes = 4 * 1024 * 1024;
const maxCellLength = 32767;
const maxConcurrentExports = 2;

export function csvCell(value: Cell) {
  if (value === null) return '';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'object' && !(value instanceof Date))
    return value.decimal.replace('.', ',');
  const raw = value instanceof Date ? stamp.format(value) : value;
  const safe = /^(?:[\t\n\r]|[\s\p{Cf}]*[=+\-@＝＋－＠])/u.test(raw)
    ? `'${raw}`
    : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function encodeCsv(table: ExportTable) {
  return Buffer.from(
    '\uFEFF' +
      [table.headings, ...table.rows]
        .map((row) => row.map(csvCell).join(';'))
        .join('\r\n') +
      '\r\n',
    'utf8',
  );
}

export async function encodeXlsx(table: ExportTable) {
  const data: SheetData = [
    table.headings.map((value) => ({
      value,
      type: String,
      fontWeight: 'bold',
    })),
    ...table.rows.map((row) =>
      row.map((value) => {
        if (value instanceof Date) {
          return {
            value: new Date(stamp.format(value).replace(' ', 'T') + 'Z'),
            type: Date,
            format: 'yyyy-mm-dd hh:mm:ss',
          };
        }
        if (value && typeof value === 'object') {
          const fraction = value.decimal.split('.')[1]?.length ?? 0;
          // Excel stores up to 15 significant digits. Preserve larger exact values as text.
          if (value.decimal.replace(/[.-]/g, '').length > 15)
            return { type: String, value: value.decimal };
          return {
            type: Number,
            value: Number(value.decimal),
            format: fraction ? `0.${'0'.repeat(fraction)}` : '0',
          };
        }
        return typeof value === 'string' ? { type: String, value } : value;
      }),
    ),
  ];
  return writeXlsxFile(data, {
    sheet: 'Данные',
    columns: table.headings.map((heading) => ({
      width: Math.max(16, heading.length + 4),
    })),
  }).toBuffer();
}

async function exportFile(table: ExportTable, name: string, format: Format) {
  let bytes = 0;
  for (const row of table.rows) {
    for (const cell of row) {
      if (typeof cell !== 'string') continue;
      bytes += Buffer.byteLength(cell, 'utf8');
      if (bytes > maxExportTextBytes || cell.length > maxCellLength) {
        throw new PayloadTooLargeException(
          'Превышен допустимый размер выгрузки. Уточните фильтры',
        );
      }
    }
  }
  const buffer = format === 'csv' ? encodeCsv(table) : await encodeXlsx(table);
  const date = stamp.format(new Date()).slice(0, 10);
  return new StreamableFile(buffer, {
    type:
      format === 'csv'
        ? 'text/csv; charset=utf-8'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    disposition: `attachment; filename="supply-manager-${name}-${date}.${format}"`,
    length: buffer.length,
  });
}

@Injectable()
export class ExportService {
  private active = 0;

  async create(name: string, format: Format, load: () => Promise<ExportTable>) {
    if (this.active >= maxConcurrentExports) {
      throw new ServiceUnavailableException(
        'Выполняются другие выгрузки. Повторите попытку позже',
      );
    }
    this.active++;
    try {
      return await exportFile(await load(), name, format);
    } finally {
      this.active--;
    }
  }
}
